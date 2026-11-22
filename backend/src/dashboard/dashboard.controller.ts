import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  Etapa,
  Perfil,
  StatusAgendamento,
  StatusEnvelope,
  StatusPendencia,
  StatusSignatario,
  StatusUnidade,
} from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Contexto, Ctx } from '../comum/contexto';
import {
  ETAPAS,
  etapasVisiveis,
  ORDEM_ETAPAS,
  perfilDaParte,
  situacaoVisivel,
} from '../comum/fluxo';
import * as regras from '../comum/regras';
import { PrismaService } from '../prisma/prisma.service';
import { rotuloUnidade, UnidadesService } from '../unidades/unidades.service';

// Dashboard de acompanhamento. Cada perfil vê os empreendimentos e as
// unidades que lhe cabem, sempre com a situação que pode ver: incorporadora,
// central de relacionamento, auditor e administrador acompanham tudo; a
// construtora acompanha as suas obras até a unidade ser recebida.
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DashboardController {
  constructor(
    private prisma: PrismaService,
    private unidades: UnidadesService,
  ) {}

  // Número do último registro da trilha. A tela pergunta por ele a cada
  // poucos segundos e só recarrega os dados quando ele muda — é o que mantém
  // o dashboard "ao vivo" sem pesar no servidor.
  @Get('versao')
  async versao() {
    const ultimo = await this.prisma.eventoAuditoria.findFirst({
      orderBy: { seq: 'desc' },
      select: { seq: true },
    });
    return { versao: ultimo?.seq ?? 0 };
  }

  @Get()
  async resumo(@Ctx() ctx: Contexto) {
    const u = ctx.usuario;
    const escopo = this.unidades.escopo(u);
    const etapas = etapasVisiveis(u.perfil);

    const [todas, proximos, assinaturas, ultimo] = await Promise.all([
      this.prisma.unidade.findMany({
        where: escopo,
        include: {
          empreendimento: {
            select: { id: true, nome: true, codigo: true, construtora: { select: { nome: true } } },
          },
          agendamentos: {
            where: { status: StatusAgendamento.PROPOSTO },
            select: { id: true, status: true, etapa: true, propostoPorPerfil: true },
          },
          _count: {
            select: {
              pendencias: { where: { status: StatusPendencia.ABERTA, etapa: { in: etapas } } },
            },
          },
        },
        orderBy: [{ empreendimento: { nome: 'asc' } }, { bloco: 'asc' }, { numero: 'asc' }],
        take: 5000,
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
      this.prisma.eventoAuditoria.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true } }),
    ]);

    // Cada unidade com a situação que este perfil pode ver
    const vistas = todas.map((un) => ({ un, v: situacaoVisivel(u.perfil, un) }));
    const emAndamento = vistas.filter(
      ({ un, v }) => !v.encerradaParaPerfil && un.status !== StatusUnidade.ENTREGUE,
    );
    const encerradas = vistas.filter(({ v }) => v.encerradaParaPerfil).length;
    const entregues = vistas.filter(
      ({ un, v }) => !v.encerradaParaPerfil && un.status === StatusUnidade.ENTREGUE,
    ).length;

    // ---- o que está parado esperando este usuário agir
    const fila: { unidadeId: string; unidade: string; empreendimento: string; acao: string; desde: Date }[] = [];
    for (const { un } of emAndamento) {
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

    // ---- por empreendimento: os números e o espelho de unidades
    const porEmpreendimento = new Map<string, (typeof vistas)[number][]>();
    for (const item of vistas) {
      const lista = porEmpreendimento.get(item.un.empreendimentoId) ?? [];
      lista.push(item);
      porEmpreendimento.set(item.un.empreendimentoId, lista);
    }
    const empreendimentos = [...porEmpreendimento.values()].map((lista) => {
      const emp = lista[0].un.empreendimento;
      const andando = lista.filter(({ un, v }) => !v.encerradaParaPerfil && un.status !== StatusUnidade.ENTREGUE);
      return {
        id: emp.id,
        codigo: emp.codigo,
        nome: emp.nome,
        construtora: emp.construtora.nome,
        total: lista.length,
        porEtapa: ORDEM_ETAPAS.filter((e) => etapas.includes(e)).map((etapa) => ({
          etapa,
          ordem: ETAPAS[etapa].ordem,
          total: andando.filter(({ v }) => v.etapa === etapa).length,
        })),
        // Para a construtora, "concluídas" são as já recebidas pela
        // incorporadora; para os demais, as entregues ao cliente.
        concluidas: lista.length - andando.length,
        pendenciasAbertas: lista.reduce((s, { un }) => s + un._count.pendencias, 0),
        unidades: lista.map(({ un, v }) => ({
          id: un.id,
          bloco: un.bloco,
          numero: un.numero,
          andar: un.andar,
          etapa: v.etapa,
          status: v.status,
          pendenciasAbertas: un._count.pendencias,
        })),
      };
    });

    // ---- últimas movimentações (mudanças de situação)
    const idsVisiveis = u.perfil === Perfil.CONSTRUTORA ? todas.map((un) => un.id) : undefined;
    const eventos = await this.prisma.eventoAuditoria.findMany({
      where: {
        unidadeId: idsVisiveis ? { in: idsVisiveis } : { not: null },
        statusNovo: { not: null },
        ...(u.perfil === Perfil.CONSTRUTORA ? { etapa: Etapa.CONSTRUTORA_INCORPORADORA } : {}),
      },
      orderBy: { seq: 'desc' },
      take: 8,
    });
    const porId = new Map(todas.map((un) => [un.id, un]));

    return {
      versao: ultimo?.seq ?? 0,
      etapas: ORDEM_ETAPAS.filter((e) => etapas.includes(e)).map((etapa) => {
        const daEtapa = emAndamento.filter(({ v }) => v.etapa === etapa);
        const status = [...new Set(daEtapa.map(({ v }) => v.status))];
        return {
          etapa,
          ordem: ETAPAS[etapa].ordem,
          rotulo: ETAPAS[etapa].rotulo,
          total: daEtapa.length,
          porStatus: status.map((s) => ({ status: s, total: daEtapa.filter(({ v }) => v.status === s).length })),
        };
      }),
      totalUnidades: vistas.length,
      emAndamento: emAndamento.length,
      entregues,
      // só para a construtora: unidades já recebidas pela incorporadora
      recebidas: u.perfil === Perfil.CONSTRUTORA ? encerradas : null,
      pendenciasAbertas: vistas.reduce((s, { un }) => s + un._count.pendencias, 0),
      empreendimentos,
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
      movimentacoes: eventos.map((e) => {
        const un = e.unidadeId ? porId.get(e.unidadeId) : undefined;
        return {
          seq: e.seq,
          criadoEm: e.criadoEm,
          unidadeId: e.unidadeId,
          unidade: un ? rotuloUnidade(un) : null,
          empreendimento: un?.empreendimento.nome ?? null,
          descricao: e.descricao,
          quem: e.atorNome,
          statusNovo: e.statusNovo,
        };
      }),
    };
  }
}
