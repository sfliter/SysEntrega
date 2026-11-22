import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Etapa,
  Perfil,
  Prisma,
  StatusAgendamento,
  StatusUnidade,
  TipoAtor,
} from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Ator, Contexto, UsuarioLogado } from '../comum/contexto';
import { ETAPAS, etapasVisiveis } from '../comum/fluxo';
import { NotificacoesService } from '../comum/notificacoes.service';
import * as regras from '../comum/regras';
import { dataHoraBR, nomeAbreviado, tokenAleatorio } from '../comum/util';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { rotuloUnidade, UnidadesService } from '../unidades/unidades.service';

export interface PropostaDto {
  opcoes: string[];
  local?: string;
  observacao?: string;
}

const ABERTOS = [StatusAgendamento.PROPOSTO, StatusAgendamento.CONFIRMADO];

@Injectable()
export class AgendamentosService {
  constructor(
    private prisma: PrismaService,
    private auditoria: AuditoriaService,
    private unidades: UnidadesService,
    private notificacoes: NotificacoesService,
  ) {}

  private minimoDeOpcoes() {
    return Math.max(Number(process.env.AGENDAMENTO_MIN_OPCOES) || 1, 1);
  }

  private validarOpcoes(opcoes: string[]): Date[] {
    const datas = [...new Set(opcoes)].map((o) => new Date(o));
    if (datas.some((d) => Number.isNaN(d.getTime()))) {
      throw new BadRequestException('Horário inválido');
    }
    if (datas.some((d) => d.getTime() < Date.now())) {
      throw new BadRequestException('Os horários oferecidos precisam estar no futuro');
    }
    const minimo = this.minimoDeOpcoes();
    if (datas.length < minimo) {
      throw new BadRequestException(
        `Ofereça ao menos ${minimo} opção(ões) de horário diferentes`,
      );
    }
    return datas.sort((a, b) => a.getTime() - b.getTime());
  }

  private async criarProposta(tx: Tx, unidadeId: string, dto: PropostaDto, ctx: Contexto) {
    const unidade = await this.unidades.obter(unidadeId, ctx.usuario, tx);
    this.unidades.exigir(regras.podeProporHorarios(ctx.usuario, unidade));
    const cfg = ETAPAS[unidade.etapa];
    if (cfg.recebedor === null && !unidade.clienteId) {
      throw new BadRequestException(
        'Vincule o cliente à unidade antes de agendar a vistoria com ele',
      );
    }
    const datas = this.validarOpcoes(dto.opcoes);
    const aberto = await tx.agendamento.findFirst({
      where: { unidadeId, etapa: unidade.etapa, status: { in: ABERTOS } },
    });
    if (aberto) {
      throw new BadRequestException(
        'Já existe um agendamento em aberto para esta unidade. Cancele-o ou reagende.',
      );
    }
    const agendamento = await tx.agendamento.create({
      data: {
        unidadeId,
        etapa: unidade.etapa,
        local: dto.local?.trim() || null,
        observacao: dto.observacao?.trim() || null,
        propostoPorId: ctx.usuario.sub,
        propostoPorPerfil: ctx.usuario.perfil,
        tokenCliente: cfg.recebedor === null ? tokenAleatorio() : null,
        opcoes: { create: datas.map((inicio) => ({ inicio })) },
      },
      include: { opcoes: true },
    });
    await this.auditoria.registrar(
      {
        acao: 'AGENDAMENTO_PROPOSTO',
        descricao: `Horários oferecidos para ${cfg.nomeVistoria.toLowerCase()} da unidade ${rotuloUnidade(unidade)}: ${datas.map(dataHoraBR).join(' · ')}`,
        entidade: 'Agendamento',
        entidadeId: agendamento.id,
        unidadeId,
        etapa: unidade.etapa,
        ator: ctx.ator,
        dados: {
          opcoes: datas.map((d) => d.toISOString()),
          local: agendamento.local,
          observacao: agendamento.observacao,
        },
      },
      tx,
    );
    return agendamento;
  }

  // Entre empresas, quem escolhe o horário é a outra parte: ela é avisada
  private avisarProposta(ag: { unidadeId: string; etapa: Etapa; propostoPorPerfil: Perfil }) {
    const cfg = ETAPAS[ag.etapa];
    if (cfg.recebedor === null) return;
    const outros = [cfg.cedente, cfg.recebedor].filter((p) => p !== ag.propostoPorPerfil);
    this.notificacoes
      .avisar(ag.unidadeId, ag.etapa, outros, 'Horários de vistoria oferecidos', 'Foram oferecidos horários para a vistoria. Escolha um deles para confirmar.')
      .catch(() => undefined);
  }

  async propor(unidadeId: string, dto: PropostaDto, ctx: Contexto) {
    const ag = await this.prisma.$transaction(async (tx) => {
      await this.unidades.travar(unidadeId, tx);
      return this.criarProposta(tx, unidadeId, dto, ctx);
    });
    this.avisarProposta(ag);
    return ag;
  }

  private async aplicarConfirmacao(
    tx: Tx,
    agendamentoId: string,
    opcaoId: string,
    ator: Ator,
    extra: {
      confirmadoPorId?: string;
      peloCliente: boolean;
      observacao?: string;
    },
  ) {
    const ag = await tx.agendamento.findUnique({
      where: { id: agendamentoId },
      include: { opcoes: true, unidade: true },
    });
    if (!ag || ag.status !== StatusAgendamento.PROPOSTO) {
      throw new BadRequestException('Este agendamento não está mais aguardando confirmação');
    }
    const opcao = ag.opcoes.find((o) => o.id === opcaoId);
    if (!opcao) throw new BadRequestException('Horário não pertence a este agendamento');
    if (opcao.inicio.getTime() < Date.now()) {
      throw new BadRequestException('Este horário já passou. Peça novas opções.');
    }
    if (
      ag.unidade.etapa !== ag.etapa ||
      ag.unidade.status !== StatusUnidade.AGUARDANDO_AGENDAMENTO
    ) {
      throw new BadRequestException('A unidade não está aguardando agendamento');
    }
    await tx.opcaoHorario.update({ where: { id: opcaoId }, data: { escolhida: true } });
    const confirmado = await tx.agendamento.update({
      where: { id: ag.id },
      data: {
        status: StatusAgendamento.CONFIRMADO,
        dataHora: opcao.inicio,
        confirmadoPorId: extra.confirmadoPorId ?? null,
        confirmadoPeloCliente: extra.peloCliente,
        confirmadoEm: new Date(),
      },
      include: { opcoes: true },
    });
    const cfg = ETAPAS[ag.etapa];
    const emNomeDoCliente = cfg.recebedor === null && !extra.peloCliente;
    await this.unidades.mudarEstado(
      tx,
      ag.unidade,
      { status: StatusUnidade.VISTORIA_AGENDADA },
      {
        acao: 'AGENDAMENTO_CONFIRMADO',
        descricao:
          `${cfg.nomeVistoria} da unidade ${rotuloUnidade(ag.unidade)} confirmada para ${dataHoraBR(opcao.inicio)}` +
          (extra.peloCliente ? ' pelo cliente, no link de agendamento' : '') +
          (emNomeDoCliente ? ' — registrada pelo Relacionamento em nome do cliente' : ''),
        ator,
        entidade: 'Agendamento',
        entidadeId: ag.id,
        dados: {
          dataHora: opcao.inicio.toISOString(),
          local: ag.local,
          emNomeDoCliente,
          observacao: extra.observacao ?? null,
        },
      },
    );
    return confirmado;
  }

  confirmar(id: string, dto: { opcaoId: string; observacao?: string }, ctx: Contexto) {
    return this.prisma.$transaction(async (tx) => {
      const ag = await tx.agendamento.findUnique({ where: { id } });
      if (!ag) throw new NotFoundException('Agendamento não encontrado');
      await this.unidades.travar(ag.unidadeId, tx);
      await this.unidades.obter(ag.unidadeId, ctx.usuario, tx);
      this.unidades.exigir(
        regras.podeConfirmarAgendamento(ctx.usuario, ag),
        'A escolha do horário cabe à outra parte',
      );
      if (ETAPAS[ag.etapa].recebedor === null && !dto.observacao?.trim()) {
        throw new BadRequestException(
          'Registre como o cliente confirmou o horário (telefone, WhatsApp, e-mail...)',
        );
      }
      return this.aplicarConfirmacao(tx, id, dto.opcaoId, ctx.ator, {
        confirmadoPorId: ctx.usuario.sub,
        peloCliente: false,
        observacao: dto.observacao?.trim(),
      });
    });
  }

  private async aplicarCancelamento(
    tx: Tx,
    agendamentoId: string,
    motivo: string,
    ator: Ator,
  ) {
    const ag = await tx.agendamento.findUnique({
      where: { id: agendamentoId },
      include: { unidade: true },
    });
    if (!ag || !ABERTOS.includes(ag.status as any)) {
      throw new BadRequestException('Este agendamento não está mais em aberto');
    }
    const cancelado = await tx.agendamento.update({
      where: { id: ag.id },
      data: {
        status: StatusAgendamento.CANCELADO,
        motivoCancelamento: motivo,
        canceladoEm: new Date(),
      },
    });
    const quando = ag.dataHora ? ` de ${dataHoraBR(ag.dataHora)}` : '';
    const evento = {
      acao: 'AGENDAMENTO_CANCELADO',
      descricao: `Agendamento${quando} da unidade ${rotuloUnidade(ag.unidade)} cancelado: ${motivo}`,
      ator,
      entidade: 'Agendamento',
      entidadeId: ag.id,
      dados: { motivo, dataHora: ag.dataHora?.toISOString() ?? null },
    };
    // Só volta a unidade se era este agendamento que a segurava como agendada
    if (
      ag.status === StatusAgendamento.CONFIRMADO &&
      ag.unidade.etapa === ag.etapa &&
      ag.unidade.status === StatusUnidade.VISTORIA_AGENDADA
    ) {
      await this.unidades.mudarEstado(
        tx,
        ag.unidade,
        { status: StatusUnidade.AGUARDANDO_AGENDAMENTO },
        evento,
      );
    } else {
      await this.auditoria.registrar(
        { ...evento, unidadeId: ag.unidadeId, etapa: ag.etapa },
        tx,
      );
    }
    return cancelado;
  }

  cancelar(id: string, motivo: string, ctx: Contexto) {
    return this.prisma.$transaction(async (tx) => {
      const ag = await tx.agendamento.findUnique({ where: { id } });
      if (!ag) throw new NotFoundException('Agendamento não encontrado');
      await this.unidades.travar(ag.unidadeId, tx);
      await this.unidades.obter(ag.unidadeId, ctx.usuario, tx);
      this.unidades.exigir(regras.podeCancelarAgendamento(ctx.usuario, ag));
      return this.aplicarCancelamento(tx, id, motivo, ctx.ator);
    });
  }

  // Cancela o agendamento atual e oferece novos horários, de uma vez
  async reagendar(id: string, dto: PropostaDto & { motivo: string }, ctx: Contexto) {
    const novo = await this.prisma.$transaction(async (tx) => {
      const ag = await tx.agendamento.findUnique({ where: { id } });
      if (!ag) throw new NotFoundException('Agendamento não encontrado');
      await this.unidades.travar(ag.unidadeId, tx);
      await this.unidades.obter(ag.unidadeId, ctx.usuario, tx);
      this.unidades.exigir(regras.podeCancelarAgendamento(ctx.usuario, ag));
      await this.aplicarCancelamento(tx, id, `Reagendamento: ${dto.motivo}`, ctx.ator);
      return this.criarProposta(tx, ag.unidadeId, dto, ctx);
    });
    this.avisarProposta(novo);
    return novo;
  }

  async agenda(
    u: UsuarioLogado,
    f: { de?: Date; ate?: Date; etapa?: Etapa; status?: StatusAgendamento },
  ) {
    const etapas = etapasVisiveis(u.perfil);
    const where: Prisma.AgendamentoWhereInput = {
      unidade: this.unidades.escopo(u),
      etapa: f.etapa && etapas.includes(f.etapa) ? f.etapa : { in: etapas },
      status: f.status ?? { in: [...ABERTOS, StatusAgendamento.REALIZADO] },
    };
    if (f.de || f.ate) {
      // Confirmados pela data marcada; propostos por qualquer opção no período
      const periodo = { gte: f.de, lte: f.ate };
      where.OR = [
        { dataHora: periodo },
        { status: StatusAgendamento.PROPOSTO, opcoes: { some: { inicio: periodo } } },
      ];
    }
    const lista = await this.prisma.agendamento.findMany({
      where,
      include: {
        opcoes: { orderBy: { inicio: 'asc' } },
        unidade: {
          include: {
            empreendimento: { select: { nome: true, codigo: true } },
            cliente: { select: { nome: true } },
          },
        },
      },
      orderBy: [{ dataHora: 'asc' }, { criadoEm: 'asc' }],
      take: 1000,
    });
    return lista.map((ag) => ({
      ...ag,
      tokenCliente: undefined,
      unidade: {
        ...ag.unidade,
        cliente: u.perfil === Perfil.CONSTRUTORA ? null : ag.unidade.cliente,
      },
      podeConfirmar: regras.podeConfirmarAgendamento(u, ag),
      podeCancelar: regras.podeCancelarAgendamento(u, ag),
    }));
  }

  // ---------- link público do cliente ----------

  private async porToken(token: string, tx: Tx = this.prisma) {
    const ag = await tx.agendamento.findUnique({
      where: { tokenCliente: token },
      include: {
        opcoes: { orderBy: { inicio: 'asc' } },
        unidade: { include: { empreendimento: true, cliente: true } },
      },
    });
    if (!ag) throw new NotFoundException('Link de agendamento inválido');
    return ag;
  }

  private atorCliente(
    ag: { unidade: { cliente: { id: string; nome: string } | null } },
    origem: { ip: string | null; userAgent: string | null },
  ): Ator {
    return {
      tipo: TipoAtor.CLIENTE,
      id: ag.unidade.cliente?.id,
      nome: ag.unidade.cliente?.nome ?? 'Cliente',
      perfil: 'CLIENTE',
      ...origem,
    };
  }

  async publicoObter(token: string) {
    const ag = await this.porToken(token);
    return {
      status: ag.status,
      dataHora: ag.dataHora,
      local: ag.local,
      observacao: ag.observacao,
      empreendimento: ag.unidade.empreendimento.nome,
      endereco: ag.unidade.empreendimento.endereco,
      unidade: rotuloUnidade(ag.unidade),
      cliente: ag.unidade.cliente ? nomeAbreviado(ag.unidade.cliente.nome) : null,
      opcoes: ag.opcoes.map((o) => ({
        id: o.id,
        inicio: o.inicio,
        escolhida: o.escolhida,
        disponivel: o.inicio.getTime() > Date.now(),
      })),
    };
  }

  publicoConfirmar(
    token: string,
    opcaoId: string,
    origem: { ip: string | null; userAgent: string | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const previa = await this.porToken(token, tx);
      await this.unidades.travar(previa.unidadeId, tx);
      const ag = await this.porToken(token, tx);
      await this.aplicarConfirmacao(tx, ag.id, opcaoId, this.atorCliente(ag, origem), {
        peloCliente: true,
      });
      return { ok: true };
    });
  }

  // O cliente não pode em nenhum dos horários: devolve ao Relacionamento
  publicoRecusar(
    token: string,
    motivo: string,
    origem: { ip: string | null; userAgent: string | null },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const previa = await this.porToken(token, tx);
      await this.unidades.travar(previa.unidadeId, tx);
      const ag = await this.porToken(token, tx);
      await this.aplicarCancelamento(
        tx,
        ag.id,
        `Cliente pediu outros horários: ${motivo}`,
        this.atorCliente(ag, origem),
      );
      return { ok: true };
    });
  }
}
