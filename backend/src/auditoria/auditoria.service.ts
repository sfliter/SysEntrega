import { Injectable } from '@nestjs/common';
import { Etapa, Prisma } from '@prisma/client';
import { Ator } from '../comum/contexto';
import { jsonCanonico, sha256 } from '../comum/util';
import { PrismaService, Tx } from '../prisma/prisma.service';

export interface NovoEvento {
  acao: string;
  descricao: string;
  entidade: string;
  entidadeId?: string | null;
  unidadeId?: string | null;
  etapa?: Etapa | null;
  ator: Ator;
  statusAnterior?: string | null;
  statusNovo?: string | null;
  dados?: Record<string, unknown> | null;
}

const HASH_GENESE = '0'.repeat(64);
// Chave do advisory lock que serializa as inserções na trilha
const TRAVA_AUDITORIA = 730114;

// Os campos que entram no hash de cada evento, em forma canônica
function conteudoDoEvento(e: {
  criadoEm: Date;
  acao: string;
  descricao: string;
  entidade: string;
  entidadeId: string | null;
  unidadeId: string | null;
  etapa: string | null;
  atorTipo: string;
  atorId: string | null;
  atorNome: string;
  atorPerfil: string | null;
  organizacao: string | null;
  ip: string | null;
  userAgent: string | null;
  statusAnterior: string | null;
  statusNovo: string | null;
  dados: unknown;
  hashAnterior: string;
}): string {
  return jsonCanonico({
    criadoEm: e.criadoEm.toISOString(),
    acao: e.acao,
    descricao: e.descricao,
    entidade: e.entidade,
    entidadeId: e.entidadeId,
    unidadeId: e.unidadeId,
    etapa: e.etapa,
    atorTipo: e.atorTipo,
    atorId: e.atorId,
    atorNome: e.atorNome,
    atorPerfil: e.atorPerfil,
    organizacao: e.organizacao,
    ip: e.ip,
    userAgent: e.userAgent,
    statusAnterior: e.statusAnterior,
    statusNovo: e.statusNovo,
    dados: e.dados ?? null,
    hashAnterior: e.hashAnterior,
  });
}

@Injectable()
export class AuditoriaService {
  constructor(private prisma: PrismaService) {}

  // Registra um evento. Passe a transação da operação (tx) para que o evento
  // e a mudança que ele descreve sejam gravados juntos — ou nenhum dos dois.
  async registrar(evento: NovoEvento, tx?: Tx): Promise<void> {
    if (!tx) {
      await this.prisma.$transaction((t) => this.inserir(evento, t));
      return;
    }
    await this.inserir(evento, tx);
  }

  private async inserir(evento: NovoEvento, tx: Tx) {
    // Uma inserção por vez: cada evento precisa do hash do anterior. A trava
    // dura até o fim da transação.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${TRAVA_AUDITORIA})`;
    const ultimo = await tx.eventoAuditoria.findFirst({
      orderBy: { seq: 'desc' },
      select: { hash: true },
    });
    const base = {
      // Milissegundos: é a precisão que o banco guarda, e o hash depende dela
      criadoEm: new Date(),
      acao: evento.acao,
      descricao: evento.descricao,
      entidade: evento.entidade,
      entidadeId: evento.entidadeId ?? null,
      unidadeId: evento.unidadeId ?? null,
      etapa: evento.etapa ?? null,
      atorTipo: evento.ator.tipo,
      atorId: evento.ator.id ?? null,
      atorNome: evento.ator.nome,
      atorPerfil: evento.ator.perfil ?? null,
      organizacao: evento.ator.organizacao ?? null,
      ip: evento.ator.ip ?? null,
      userAgent: evento.ator.userAgent ?? null,
      statusAnterior: evento.statusAnterior ?? null,
      statusNovo: evento.statusNovo ?? null,
      // Passa pelo JSON para ficar igual ao que o banco devolve na conferência
      dados: evento.dados ? JSON.parse(JSON.stringify(evento.dados)) : null,
      hashAnterior: ultimo?.hash ?? HASH_GENESE,
    };
    await tx.eventoAuditoria.create({
      data: {
        ...base,
        dados: base.dados ?? Prisma.JsonNull,
        hash: sha256(conteudoDoEvento(base)),
      },
    });
  }

  async listar(filtro: {
    unidadeId?: string;
    acao?: string;
    atorId?: string;
    entidade?: string;
    etapas?: Etapa[];
    de?: Date;
    ate?: Date;
    busca?: string;
    pagina?: number;
    porPagina?: number;
    ordem?: 'asc' | 'desc';
  }) {
    const where: Prisma.EventoAuditoriaWhereInput = {
      unidadeId: filtro.unidadeId,
      acao: filtro.acao,
      atorId: filtro.atorId,
      entidade: filtro.entidade,
      criadoEm:
        filtro.de || filtro.ate ? { gte: filtro.de, lte: filtro.ate } : undefined,
    };
    const e: Prisma.EventoAuditoriaWhereInput[] = [];
    if (filtro.etapas) {
      e.push({ OR: [{ etapa: { in: filtro.etapas } }, { etapa: null }] });
    }
    if (filtro.busca) {
      e.push({
        OR: [
          { descricao: { contains: filtro.busca, mode: 'insensitive' } },
          { atorNome: { contains: filtro.busca, mode: 'insensitive' } },
        ],
      });
    }
    if (e.length) where.AND = e;
    const porPagina = Math.min(filtro.porPagina ?? 50, 5000);
    const pagina = Math.max(filtro.pagina ?? 1, 1);
    const [total, eventos] = await Promise.all([
      this.prisma.eventoAuditoria.count({ where }),
      this.prisma.eventoAuditoria.findMany({
        where,
        orderBy: { seq: filtro.ordem ?? 'desc' },
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }),
    ]);
    return { total, pagina, porPagina, eventos };
  }

  async acoesDistintas(): Promise<string[]> {
    const linhas = await this.prisma.eventoAuditoria.findMany({
      distinct: ['acao'],
      select: { acao: true },
      orderBy: { acao: 'asc' },
    });
    return linhas.map((l) => l.acao);
  }

  // Refaz a cadeia de hashes do início ao fim. Qualquer evento alterado,
  // removido ou inserido fora de ordem quebra a cadeia a partir dele.
  async verificarIntegridade() {
    let hashAnterior = HASH_GENESE;
    let conferidos = 0;
    let cursor = 0;
    for (;;) {
      const lote = await this.prisma.eventoAuditoria.findMany({
        where: { seq: { gt: cursor } },
        orderBy: { seq: 'asc' },
        take: 1000,
      });
      if (lote.length === 0) break;
      for (const ev of lote) {
        const esperado = sha256(conteudoDoEvento({ ...ev, hashAnterior }));
        if (ev.hashAnterior !== hashAnterior || ev.hash !== esperado) {
          return {
            integra: false,
            conferidos,
            primeiroEventoInvalido: ev.seq,
            ultimoHash: hashAnterior,
          };
        }
        hashAnterior = ev.hash;
        conferidos++;
        cursor = ev.seq;
      }
    }
    return {
      integra: true,
      conferidos,
      primeiroEventoInvalido: null,
      ultimoHash: hashAnterior,
    };
  }
}
