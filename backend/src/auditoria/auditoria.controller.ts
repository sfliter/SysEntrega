import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Perfil } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Perfis } from '../auth/roles.decorator';
import { Contexto, Ctx } from '../comum/contexto';
import { AuditoriaService } from './auditoria.service';

function filtroDaQuery(q: Record<string, string>) {
  return {
    unidadeId: q.unidadeId || undefined,
    acao: q.acao || undefined,
    atorId: q.atorId || undefined,
    entidade: q.entidade || undefined,
    busca: q.busca || undefined,
    de: q.de ? new Date(q.de) : undefined,
    ate: q.ate ? new Date(q.ate) : undefined,
  };
}

function celulaCsv(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // Planilhas executam células que começam com = + - @: neutraliza
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

// Trilha completa: só Administrador e Auditor. O histórico de cada unidade,
// visível aos demais perfis, sai por /unidades/:id/historico.
@Controller('auditoria')
@UseGuards(JwtAuthGuard, RolesGuard)
@Perfis(Perfil.ADMINISTRADOR)
export class AuditoriaController {
  constructor(private auditoria: AuditoriaService) {}

  @Get()
  listar(@Query() q: Record<string, string>) {
    return this.auditoria.listar({
      ...filtroDaQuery(q),
      pagina: Number(q.pagina) || 1,
      porPagina: Number(q.porPagina) || 50,
    });
  }

  @Get('acoes')
  async acoes() {
    return this.auditoria.acoesDistintas();
  }

  @Get('verificar')
  async verificar(@Ctx() ctx: Contexto) {
    const resultado = await this.auditoria.verificarIntegridade();
    await this.auditoria.registrar({
      acao: 'AUDITORIA_VERIFICADA',
      descricao: resultado.integra
        ? `Integridade da trilha conferida: ${resultado.conferidos} eventos íntegros`
        : `Integridade da trilha conferida: cadeia quebrada no evento #${resultado.primeiroEventoInvalido}`,
      entidade: 'Auditoria',
      ator: ctx.ator,
      dados: resultado,
    });
    return resultado;
  }

  @Get('exportar.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="auditoria.csv"')
  async exportar(@Query() q: Record<string, string>, @Ctx() ctx: Contexto) {
    const { eventos, total } = await this.auditoria.listar({
      ...filtroDaQuery(q),
      porPagina: 5000,
      ordem: 'asc',
    });
    await this.auditoria.registrar({
      acao: 'AUDITORIA_EXPORTADA',
      descricao: `Trilha de auditoria exportada em CSV (${eventos.length} de ${total} eventos)`,
      entidade: 'Auditoria',
      ator: ctx.ator,
      dados: { filtro: q },
    });
    const cabecalho = [
      'seq', 'dataHora', 'acao', 'descricao', 'entidade', 'entidadeId',
      'unidadeId', 'etapa', 'atorTipo', 'atorNome', 'atorPerfil',
      'organizacao', 'ip', 'statusAnterior', 'statusNovo', 'hash',
    ];
    const linhas = eventos.map((e) =>
      [
        e.seq, e.criadoEm.toISOString(), e.acao, e.descricao, e.entidade,
        e.entidadeId, e.unidadeId, e.etapa, e.atorTipo, e.atorNome,
        e.atorPerfil, e.organizacao, e.ip, e.statusAnterior, e.statusNovo,
        e.hash,
      ]
        .map(celulaCsv)
        .join(';'),
    );
    // BOM: o Excel abre em UTF-8
    return '﻿' + [cabecalho.join(';'), ...linhas].join('\r\n');
  }
}
