import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  Perfil,
  StatusAgendamento,
  StatusEnvelope,
  StatusSignatario,
  StatusUnidade,
} from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Contexto, Ctx } from '../comum/contexto';
import { ETAPAS, etapasVisiveis, ORDEM_ETAPAS, perfilDaParte } from '../comum/fluxo';
import * as regras from '../comum/regras';
import { PrismaService } from '../prisma/prisma.service';
import { rotuloUnidade, UnidadesService } from '../unidades/unidades.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(
    private prisma: PrismaService,
    private unidades: UnidadesService,
  ) {}

  @Get()
  async resumo(@Ctx() ctx: Contexto) {
    const u = ctx.usuario;
    const escopo = this.unidades.escopo(u);
    const etapas = etapasVisiveis(u.perfil);

    const [contagens, unidades, proximos, assinaturas] = await Promise.all([
      this.prisma.unidade.groupBy({
        by: ['etapa', 'status'],
        where: escopo,
        _count: { _all: true },
      }),
      this.prisma.unidade.findMany({
        where: { ...escopo, status: { not: StatusUnidade.ENTREGUE } },
        include: {
          empreendimento: { select: { nome: true } },
          agendamentos: {
            where: { status: StatusAgendamento.PROPOSTO },
            select: { id: true, status: true, etapa: true, propostoPorPerfil: true },
          },
        },
        orderBy: { atualizadoEm: 'asc' },
        take: 2000,
      }),
      this.prisma.agendamento.findMany({
        where: {
          unidade: escopo,
          etapa: { in: etapas },
          status: StatusAgendamento.CONFIRMADO,
          dataHora: { gte: new Date(Date.now() - 12 * 3600_000) },
        },
        include: {
          unidade: { include: { empreendimento: { select: { nome: true } } } },
        },
        orderBy: { dataHora: 'asc' },
        take: 8,
      }),
      this.prisma.signatario.findMany({
        where: {
          status: StatusSignatario.PENDENTE,
          envelope: {
            status: StatusEnvelope.PENDENTE,
            documento: { unidade: escopo, etapa: { in: etapas } },
          },
        },
        include: {
          envelope: {
            include: {
              documento: {
                include: { unidade: { include: { empreendimento: { select: { nome: true } } } } },
              },
            },
          },
        },
        take: 500,
      }),
    ]);

    // O que está parado esperando este usuário agir
    const fila: { unidadeId: string; unidade: string; empreendimento: string; acao: string; desde: Date }[] = [];
    for (const un of unidades) {
      if (!etapas.includes(un.etapa)) continue;
      const base = {
        unidadeId: un.id,
        unidade: rotuloUnidade(un),
        empreendimento: un.empreendimento.nome,
        desde: un.atualizadoEm,
      };
      const proposta = un.agendamentos.find((a) => a.etapa === un.etapa);
      if (regras.podeLiberar(u, un)) fila.push({ ...base, acao: 'Liberar a unidade' });
      else if (proposta && u.perfil !== Perfil.ADMINISTRADOR && regras.podeConfirmarAgendamento(u, proposta)) {
        fila.push({
          ...base,
          acao: ETAPAS[un.etapa].recebedor === null ? 'Aguardando o cliente escolher o horário' : 'Escolher o horário da vistoria',
        });
      } else if (!proposta && regras.podeProporHorarios(u, un)) fila.push({ ...base, acao: 'Oferecer horários de vistoria' });
      else if (regras.podeIniciarVistoria(u, un)) fila.push({ ...base, acao: `Iniciar ${ETAPAS[un.etapa].nomeVistoria.toLowerCase()}` });
      else if (un.status === StatusUnidade.EM_VISTORIA && regras.podeConduzirVistoria(u, un.etapa)) fila.push({ ...base, acao: 'Concluir a vistoria em andamento' });
      else if (regras.podeResolverPendencias(u, un)) fila.push({ ...base, acao: 'Sanar pendências' });
    }
    for (const s of assinaturas) {
      const doc = s.envelope.documento;
      if (perfilDaParte(s.parte) === u.perfil) {
        fila.push({
          unidadeId: doc.unidadeId,
          unidade: rotuloUnidade(doc.unidade),
          empreendimento: doc.unidade.empreendimento.nome,
          acao: `Assinar o termo ${doc.protocolo}`,
          desde: s.envelope.criadoEm,
        });
      }
    }
    fila.sort((a, b) => a.desde.getTime() - b.desde.getTime());

    return {
      etapas: ORDEM_ETAPAS.map((etapa) => ({
        etapa,
        ordem: ETAPAS[etapa].ordem,
        rotulo: ETAPAS[etapa].rotulo,
        visivel: etapas.includes(etapa),
        total: contagens
          .filter((c) => c.etapa === etapa && c.status !== StatusUnidade.ENTREGUE)
          .reduce((s, c) => s + c._count._all, 0),
        porStatus: contagens
          .filter((c) => c.etapa === etapa && c.status !== StatusUnidade.ENTREGUE)
          .map((c) => ({ status: c.status, total: c._count._all })),
      })),
      totalUnidades: contagens.reduce((s, c) => s + c._count._all, 0),
      entregues: contagens
        .filter((c) => c.status === StatusUnidade.ENTREGUE)
        .reduce((s, c) => s + c._count._all, 0),
      fila: fila.slice(0, 100),
      proximosAgendamentos: proximos.map((a) => ({
        id: a.id,
        unidadeId: a.unidadeId,
        unidade: rotuloUnidade(a.unidade),
        empreendimento: a.unidade.empreendimento.nome,
        etapa: a.etapa,
        dataHora: a.dataHora,
        local: a.local,
      })),
    };
  }
}
