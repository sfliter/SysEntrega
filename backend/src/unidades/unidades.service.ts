import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Etapa,
  Perfil,
  Prisma,
  StatusPendencia,
  StatusUnidade,
  Unidade,
} from '@prisma/client';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { NotificacoesService } from '../comum/notificacoes.service';
import { Ator, Contexto, UsuarioLogado } from '../comum/contexto';
import {
  ETAPAS,
  etapasVisiveis,
  rotuloEstado,
  statusAposLiberacao,
  statusDeEntrada,
} from '../comum/fluxo';
import * as regras from '../comum/regras';
import { PrismaService, Tx } from '../prisma/prisma.service';

export function rotuloUnidade(u: { bloco: string; numero: string }) {
  return u.bloco ? `${u.bloco} · ${u.numero}` : u.numero;
}

@Injectable()
export class UnidadesService {
  constructor(
    private prisma: PrismaService,
    private auditoria: AuditoriaService,
    private notificacoes: NotificacoesService,
  ) {}

  // A construtora só vê as unidades das obras dela
  escopo(u: UsuarioLogado): Prisma.UnidadeWhereInput {
    if (u.perfil === Perfil.CONSTRUTORA) {
      return {
        empreendimento: { construtoraId: u.organizacaoId ?? '__sem_organizacao__' },
      };
    }
    return {};
  }

  // Busca a unidade respeitando o escopo: fora dele, é como se não existisse
  async obter(id: string, u: UsuarioLogado, tx: Tx = this.prisma) {
    const unidade = await tx.unidade.findFirst({
      where: { id, ...this.escopo(u) },
      include: { empreendimento: true, cliente: true },
    });
    if (!unidade) throw new NotFoundException('Unidade não encontrada');
    return unidade;
  }

  // Trava a linha da unidade até o fim da transação: duas ações simultâneas
  // sobre a mesma unidade passam a acontecer uma depois da outra.
  async travar(id: string, tx: Tx) {
    await tx.$executeRaw`SELECT id FROM "Unidade" WHERE id = ${id} FOR UPDATE`;
  }

  exigir(condicao: boolean, mensagem = 'Ação não permitida para o seu perfil neste momento') {
    if (!condicao) throw new ForbiddenException(mensagem);
  }

  // Único ponto que muda (etapa, status) de uma unidade — sempre com o
  // evento de auditoria correspondente, na mesma transação.
  async mudarEstado(
    tx: Tx,
    unidade: Unidade,
    novo: { etapa?: Etapa; status: StatusUnidade; liberadaPorId?: string | null },
    evento: {
      acao: string;
      descricao: string;
      ator: Ator;
      entidade?: string;
      entidadeId?: string;
      dados?: Record<string, unknown>;
    },
  ) {
    const etapa = novo.etapa ?? unidade.etapa;
    const atualizada = await tx.unidade.update({
      where: { id: unidade.id },
      data: {
        etapa,
        status: novo.status,
        ...(novo.liberadaPorId !== undefined
          ? { liberadaPorId: novo.liberadaPorId }
          : {}),
      },
    });
    await this.auditoria.registrar(
      {
        acao: evento.acao,
        descricao: evento.descricao,
        entidade: evento.entidade ?? 'Unidade',
        entidadeId: evento.entidadeId ?? unidade.id,
        unidadeId: unidade.id,
        // O evento pertence à etapa em que a ação aconteceu
        etapa: unidade.etapa,
        ator: evento.ator,
        statusAnterior: rotuloEstado(unidade.etapa, unidade.status),
        statusNovo: rotuloEstado(etapa, novo.status),
        dados: evento.dados,
      },
      tx,
    );
    this.notificacoes.aoMudarEstado(unidade.id, etapa, novo.status);
    return atualizada;
  }

  // Termo assinado por todos: a unidade passa para a próxima etapa, ou é
  // dada como entregue se esta era a última.
  async concluirEtapa(tx: Tx, unidade: Unidade, ator: Ator, protocolo: string) {
    const cfg = ETAPAS[unidade.etapa];
    if (!cfg.proxima) {
      return this.mudarEstado(
        tx,
        unidade,
        { status: StatusUnidade.ENTREGUE },
        {
          acao: 'UNIDADE_ENTREGUE',
          descricao: `Termo ${protocolo} assinado por todas as partes: unidade entregue ao cliente`,
          ator,
          dados: { protocolo },
        },
      );
    }
    return this.mudarEstado(
      tx,
      unidade,
      {
        etapa: cfg.proxima,
        status: statusDeEntrada(cfg.proxima),
        liberadaPorId: null,
      },
      {
        acao: 'ETAPA_CONCLUIDA',
        descricao: `Termo ${protocolo} assinado por todas as partes: etapa "${cfg.rotulo}" concluída`,
        ator,
        dados: { protocolo, proximaEtapa: cfg.proxima },
      },
    );
  }

  async listar(
    u: UsuarioLogado,
    f: {
      empreendimentoId?: string;
      etapa?: Etapa;
      status?: StatusUnidade;
      busca?: string;
    },
  ) {
    const where: Prisma.UnidadeWhereInput = {
      ...this.escopo(u),
      empreendimentoId: f.empreendimentoId,
      etapa: f.etapa,
      status: f.status,
    };
    if (f.busca) {
      const busca = f.busca.trim();
      where.OR = [
        { numero: { contains: busca, mode: 'insensitive' } },
        { bloco: { contains: busca, mode: 'insensitive' } },
        ...(u.perfil === Perfil.CONSTRUTORA
          ? []
          : [{ cliente: { nome: { contains: busca, mode: 'insensitive' as const } } }]),
      ];
    }
    const unidades = await this.prisma.unidade.findMany({
      where,
      include: {
        empreendimento: { select: { id: true, nome: true, codigo: true } },
        cliente: { select: { id: true, nome: true } },
        _count: {
          select: { pendencias: { where: { status: StatusPendencia.ABERTA } } },
        },
      },
      orderBy: [
        { empreendimento: { nome: 'asc' } },
        { bloco: 'asc' },
        { numero: 'asc' },
      ],
      take: 2000,
    });
    return unidades.map((un) => ({
      ...un,
      cliente: u.perfil === Perfil.CONSTRUTORA ? null : un.cliente,
      pendenciasAbertas: un._count.pendencias,
      _count: undefined,
    }));
  }

  async detalhe(id: string, u: UsuarioLogado) {
    const unidade = await this.obter(id, u);
    const etapas = etapasVisiveis(u.perfil);
    const [agendamentos, vistorias, pendencias, documentos] = await Promise.all([
      this.prisma.agendamento.findMany({
        where: { unidadeId: id, etapa: { in: etapas } },
        include: { opcoes: { orderBy: { inicio: 'asc' } } },
        orderBy: { criadoEm: 'desc' },
      }),
      this.prisma.vistoria.findMany({
        where: { unidadeId: id, etapa: { in: etapas } },
        include: { _count: { select: { itens: true } } },
        orderBy: { iniciadaEm: 'desc' },
      }),
      this.prisma.pendencia.findMany({
        where: { unidadeId: id, etapa: { in: etapas } },
        orderBy: [{ status: 'asc' }, { criadoEm: 'asc' }],
      }),
      this.prisma.documento.findMany({
        where: { unidadeId: id, etapa: { in: etapas } },
        include: {
          envelope: { include: { signatarios: { orderBy: { ordem: 'asc' } } } },
        },
        orderBy: { criadoEm: 'desc' },
      }),
    ]);

    const relacionamento =
      u.perfil === Perfil.RELACIONAMENTO || u.perfil === Perfil.ADMINISTRADOR;
    const cfg = ETAPAS[unidade.etapa];
    return {
      unidade: {
        ...unidade,
        cliente: u.perfil === Perfil.CONSTRUTORA ? null : unidade.cliente,
      },
      etapa: { ...cfg, chave: unidade.etapa },
      permissoes: {
        liberar: regras.podeLiberar(u, unidade),
        proporHorarios: regras.podeProporHorarios(u, unidade),
        iniciarVistoria: regras.podeIniciarVistoria(u, unidade),
        resolverPendencias: regras.podeResolverPendencias(u, unidade),
        editar: regras.podeCadastrarUnidades(u),
        anotar: u.perfil !== Perfil.AUDITOR && etapas.includes(unidade.etapa),
        vincularCliente:
          regras.podeGerirClientes(u) && unidade.status !== StatusUnidade.ENTREGUE,
      },
      agendamentos: agendamentos.map((ag) => ({
        ...ag,
        // O link do cliente só interessa a quem fala com ele
        tokenCliente: relacionamento ? ag.tokenCliente : null,
        podeConfirmar: regras.podeConfirmarAgendamento(u, ag),
        podeCancelar: regras.podeCancelarAgendamento(u, ag),
      })),
      vistorias: vistorias.map((v) => ({
        ...v,
        totalItens: v._count.itens,
        _count: undefined,
        podeConduzir: regras.podeConduzirVistoria(u, v.etapa),
      })),
      pendencias,
      documentos: documentos.map((d) => ({
        id: d.id,
        etapa: d.etapa,
        tipo: d.tipo,
        protocolo: d.protocolo,
        titulo: d.titulo,
        sha256: d.sha256,
        sha256Assinado: d.sha256Assinado,
        assinado: !!d.arquivoAssinado,
        criadoEm: d.criadoEm,
        envelope: d.envelope && {
          id: d.envelope.id,
          provedor: d.envelope.provedor,
          status: d.envelope.status,
          concluidoEm: d.envelope.concluidoEm,
          signatarios: d.envelope.signatarios.map((s) => ({
            id: s.id,
            parte: s.parte,
            nome: s.nome,
            email: relacionamento || s.parte !== 'CLIENTE' ? s.email : null,
            status: s.status,
            metodo: s.metodo,
            assinadoEm: s.assinadoEm,
            motivoRecusa: s.motivoRecusa,
            urlAssinatura: s.urlAssinatura,
            // Link de assinatura do cliente: para o Relacionamento repassar
            token: relacionamento && s.status === 'PENDENTE' ? s.token : null,
            podeAssinar: regras.podeAssinar(u, s, d.envelope!),
          })),
        },
      })),
    };
  }

  async historico(id: string, u: UsuarioLogado) {
    await this.obter(id, u);
    const { eventos } = await this.auditoria.listar({
      unidadeId: id,
      etapas: u.perfil === Perfil.CONSTRUTORA ? etapasVisiveis(u.perfil) : undefined,
      porPagina: 2000,
      ordem: 'asc',
    });
    // A origem técnica (IP, navegador) fica na trilha completa, não aqui
    return eventos.map((e) => ({
      seq: e.seq,
      criadoEm: e.criadoEm,
      acao: e.acao,
      descricao: e.descricao,
      etapa: e.etapa,
      atorTipo: e.atorTipo,
      atorNome: e.atorNome,
      atorPerfil: e.atorPerfil,
      organizacao: e.organizacao,
      statusAnterior: e.statusAnterior,
      statusNovo: e.statusNovo,
    }));
  }

  // Anotação livre no histórico da unidade (combinados, ocorrências, avisos).
  // Vai para a trilha de auditoria: não pode ser editada nem apagada.
  async anotar(id: string, texto: string, ctx: Contexto) {
    const unidade = await this.obter(id, ctx.usuario);
    this.exigir(
      etapasVisiveis(ctx.usuario.perfil).includes(unidade.etapa),
      'A unidade já passou da etapa em que a sua empresa participa',
    );
    await this.auditoria.registrar({
      acao: 'ANOTACAO',
      descricao: texto,
      entidade: 'Unidade',
      entidadeId: id,
      unidadeId: id,
      etapa: unidade.etapa,
      ator: ctx.ator,
    });
    return { ok: true };
  }

  async criar(
    dto: {
      empreendimentoId: string;
      bloco?: string;
      numeros: string[];
      andar?: string;
      tipologia?: string;
    },
    ctx: Contexto,
  ) {
    this.exigir(regras.podeCadastrarUnidades(ctx.usuario));
    const emp = await this.prisma.empreendimento.findUnique({
      where: { id: dto.empreendimentoId },
    });
    if (!emp) throw new BadRequestException('Empreendimento não encontrado');
    const bloco = (dto.bloco ?? '').trim();
    const numeros = [...new Set(dto.numeros.map((n) => n.trim()).filter(Boolean))];
    if (numeros.length === 0) throw new BadRequestException('Informe ao menos uma unidade');

    return this.prisma.$transaction(async (tx) => {
      const existentes = await tx.unidade.findMany({
        where: { empreendimentoId: emp.id, bloco, numero: { in: numeros } },
        select: { numero: true },
      });
      if (existentes.length) {
        throw new ConflictException(
          `Já cadastradas neste empreendimento/bloco: ${existentes.map((e) => e.numero).join(', ')}`,
        );
      }
      const criadas: Unidade[] = [];
      for (const numero of numeros) {
        const un = await tx.unidade.create({
          data: {
            empreendimentoId: emp.id,
            bloco,
            numero,
            andar: dto.andar?.trim() || null,
            tipologia: dto.tipologia?.trim() || null,
          },
        });
        await this.auditoria.registrar(
          {
            acao: 'UNIDADE_CADASTRADA',
            descricao: `Unidade ${rotuloUnidade(un)} cadastrada em ${emp.nome}`,
            entidade: 'Unidade',
            entidadeId: un.id,
            unidadeId: un.id,
            etapa: un.etapa,
            ator: ctx.ator,
            statusNovo: rotuloEstado(un.etapa, un.status),
            dados: { empreendimento: emp.codigo, bloco, numero },
          },
          tx,
        );
        criadas.push(un);
      }
      return criadas;
    });
  }

  async atualizar(
    id: string,
    dto: { andar?: string; tipologia?: string; clienteId?: string | null },
    ctx: Contexto,
  ) {
    const u = ctx.usuario;
    const unidade = await this.obter(id, u);
    const data: Prisma.UnidadeUncheckedUpdateInput = {};
    const mudancas: Record<string, unknown> = {};

    if (dto.andar !== undefined || dto.tipologia !== undefined) {
      this.exigir(regras.podeCadastrarUnidades(u));
      if (dto.andar !== undefined) data.andar = dto.andar.trim() || null;
      if (dto.tipologia !== undefined) data.tipologia = dto.tipologia.trim() || null;
      mudancas.antes = { andar: unidade.andar, tipologia: unidade.tipologia };
      mudancas.depois = { andar: data.andar, tipologia: data.tipologia };
    }

    let descricao = `Dados da unidade ${rotuloUnidade(unidade)} atualizados`;
    let acao = 'UNIDADE_ATUALIZADA';
    if (dto.clienteId !== undefined && dto.clienteId !== unidade.clienteId) {
      this.exigir(regras.podeGerirClientes(u));
      if (unidade.status === StatusUnidade.ENTREGUE) {
        throw new BadRequestException('Unidade já entregue: o cliente não pode mais ser alterado');
      }
      // Com o termo do cliente em andamento, trocar o titular invalidaria o
      // que já foi combinado ou assinado.
      if (
        unidade.etapa === Etapa.RELACIONAMENTO_CLIENTE &&
        unidade.status !== StatusUnidade.AGUARDANDO_AGENDAMENTO
      ) {
        throw new BadRequestException(
          'Há agendamento, vistoria ou termo em andamento com o cliente atual. Cancele-os antes de trocar o titular.',
        );
      }
      let nomeNovo = 'nenhum';
      if (dto.clienteId) {
        const cliente = await this.prisma.cliente.findUnique({
          where: { id: dto.clienteId },
        });
        if (!cliente) throw new BadRequestException('Cliente não encontrado');
        nomeNovo = cliente.nome;
      }
      data.clienteId = dto.clienteId;
      acao = 'CLIENTE_VINCULADO';
      descricao = dto.clienteId
        ? `Cliente ${nomeNovo} vinculado à unidade ${rotuloUnidade(unidade)}`
        : `Cliente desvinculado da unidade ${rotuloUnidade(unidade)}`;
      mudancas.clienteAnterior = unidade.cliente?.nome ?? null;
      mudancas.clienteNovo = dto.clienteId ? nomeNovo : null;
    }
    if (Object.keys(data).length === 0) return unidade;

    return this.prisma.$transaction(async (tx) => {
      const atualizada = await tx.unidade.update({ where: { id }, data });
      await this.auditoria.registrar(
        {
          acao,
          descricao,
          entidade: 'Unidade',
          entidadeId: id,
          unidadeId: id,
          // Vínculo de cliente não aparece para a construtora
          etapa:
            acao === 'CLIENTE_VINCULADO'
              ? Etapa.RELACIONAMENTO_CLIENTE
              : unidade.etapa,
          ator: ctx.ator,
          dados: mudancas,
        },
        tx,
      );
      return atualizada;
    });
  }

  // Quem entrega libera a unidade para a etapa (ou a reapresenta depois de
  // sanar as pendências).
  async liberar(id: string, observacao: string | undefined, ctx: Contexto) {
    return this.prisma.$transaction(async (tx) => {
      await this.travar(id, tx);
      const unidade = await this.obter(id, ctx.usuario, tx);
      const cfg = ETAPAS[unidade.etapa];

      if (unidade.status === StatusUnidade.COM_PENDENCIAS) {
        this.exigir(regras.podeResolverPendencias(ctx.usuario, unidade));
        const abertas = await tx.pendencia.count({
          where: { unidadeId: id, etapa: unidade.etapa, status: StatusPendencia.ABERTA },
        });
        if (abertas > 0) {
          throw new BadRequestException(
            `Ainda há ${abertas} pendência(s) em aberto. Registre a resolução de cada uma antes de reapresentar a unidade.`,
          );
        }
        return this.mudarEstado(
          tx,
          unidade,
          { status: statusAposLiberacao(unidade.etapa) },
          {
            acao: 'UNIDADE_REAPRESENTADA',
            descricao: `Pendências sanadas: unidade ${rotuloUnidade(unidade)} reapresentada para ${cfg.nomeVistoria.toLowerCase()}`,
            ator: ctx.ator,
            dados: { observacao: observacao ?? null },
          },
        );
      }

      this.exigir(regras.podeLiberar(ctx.usuario, unidade));
      return this.mudarEstado(
        tx,
        unidade,
        {
          status: statusAposLiberacao(unidade.etapa),
          liberadaPorId: ctx.usuario.sub,
        },
        {
          acao: 'UNIDADE_LIBERADA',
          descricao: `Unidade ${rotuloUnidade(unidade)} liberada na etapa "${cfg.rotulo}"`,
          ator: ctx.ator,
          dados: { observacao: observacao ?? null },
        },
      );
    });
  }

  async resolverPendencia(pendenciaId: string, resolucao: string, ctx: Contexto) {
    return this.prisma.$transaction(async (tx) => {
      const pendencia = await tx.pendencia.findUnique({ where: { id: pendenciaId } });
      if (!pendencia) throw new NotFoundException('Pendência não encontrada');
      await this.travar(pendencia.unidadeId, tx);
      const unidade = await this.obter(pendencia.unidadeId, ctx.usuario, tx);
      if (pendencia.etapa !== unidade.etapa) {
        throw new BadRequestException('Pendência de uma etapa já encerrada');
      }
      this.exigir(regras.podeResolverPendencias(ctx.usuario, unidade));
      if (pendencia.status === StatusPendencia.RESOLVIDA) {
        throw new BadRequestException('Pendência já resolvida');
      }
      const atualizada = await tx.pendencia.update({
        where: { id: pendenciaId },
        data: {
          status: StatusPendencia.RESOLVIDA,
          resolucao,
          resolvidaPorId: ctx.usuario.sub,
          resolvidaPorNome: ctx.usuario.nome,
          resolvidaEm: new Date(),
        },
      });
      await this.auditoria.registrar(
        {
          acao: 'PENDENCIA_RESOLVIDA',
          descricao: `Pendência resolvida: ${pendencia.descricao}`,
          entidade: 'Pendencia',
          entidadeId: pendenciaId,
          unidadeId: unidade.id,
          etapa: unidade.etapa,
          ator: ctx.ator,
          dados: { resolucao },
        },
        tx,
      );
      return atualizada;
    });
  }
}
