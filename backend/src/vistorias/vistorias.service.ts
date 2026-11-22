import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ResultadoItem,
  ResultadoVistoria,
  StatusAgendamento,
  StatusUnidade,
  StatusVistoria,
} from '@prisma/client';
import { AssinaturasService } from '../assinaturas/assinaturas.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { Contexto, UsuarioLogado } from '../comum/contexto';
import { ETAPAS, etapasVisiveis, statusAposLiberacao } from '../comum/fluxo';
import * as regras from '../comum/regras';
import { sha256 } from '../comum/util';
import {
  ROTULO_RESULTADO_ITEM,
  ROTULO_RESULTADO_VISTORIA,
} from '../documentos/termo';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { rotuloUnidade, UnidadesService } from '../unidades/unidades.service';
import { ArmazenamentoService } from './armazenamento.service';

const MAX_FOTOS_POR_ITEM = 12;

// Confere pelo conteúdo (e não pelo nome ou pelo tipo declarado) que o
// arquivo é mesmo uma imagem JPEG ou PNG.
function tipoDaImagem(b: Buffer): { mime: string; ext: string } | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  return null;
}

@Injectable()
export class VistoriasService {
  constructor(
    private prisma: PrismaService,
    private auditoria: AuditoriaService,
    private unidades: UnidadesService,
    private armazenamento: ArmazenamentoService,
    private assinaturas: AssinaturasService,
  ) {}

  iniciar(unidadeId: string, ctx: Contexto) {
    return this.prisma.$transaction(async (tx) => {
      await this.unidades.travar(unidadeId, tx);
      const unidade = await this.unidades.obter(unidadeId, ctx.usuario, tx);
      this.unidades.exigir(regras.podeIniciarVistoria(ctx.usuario, unidade));
      const cfg = ETAPAS[unidade.etapa];

      const pauta = await tx.modeloItem.findMany({
        where: { etapa: unidade.etapa, ativo: true },
        orderBy: [{ ordem: 'asc' }, { ambiente: 'asc' }],
      });
      if (pauta.length === 0) {
        throw new BadRequestException(
          `Não há itens cadastrados na pauta desta etapa (${cfg.rotulo}). Peça ao administrador para cadastrá-los.`,
        );
      }
      const agendamento = await tx.agendamento.findFirst({
        where: { unidadeId, etapa: unidade.etapa, status: StatusAgendamento.CONFIRMADO },
      });
      if (agendamento) {
        await tx.agendamento.update({
          where: { id: agendamento.id },
          data: { status: StatusAgendamento.REALIZADO },
        });
      }
      // A pauta é copiada: mudanças futuras nela não alteram esta vistoria
      const vistoria = await tx.vistoria.create({
        data: {
          unidadeId,
          etapa: unidade.etapa,
          agendamentoId: agendamento?.id,
          vistoriadorId: ctx.usuario.sub,
          vistoriadorNome: ctx.usuario.nome,
          itens: {
            create: pauta.map((p, i) => ({
              ambiente: p.ambiente,
              descricao: p.descricao,
              ordem: i,
            })),
          },
        },
      });
      await this.unidades.mudarEstado(
        tx,
        unidade,
        { status: StatusUnidade.EM_VISTORIA },
        {
          acao: 'VISTORIA_INICIADA',
          descricao: `${cfg.nomeVistoria} da unidade ${rotuloUnidade(unidade)} iniciada por ${ctx.usuario.nome} (${pauta.length} itens)`,
          ator: ctx.ator,
          entidade: 'Vistoria',
          entidadeId: vistoria.id,
          dados: { itens: pauta.length, agendamentoId: agendamento?.id ?? null },
        },
      );
      return vistoria;
    });
  }

  // Carrega a vistoria conferindo que o usuário alcança a unidade e a etapa
  private async carregar(id: string, u: UsuarioLogado, tx: Tx = this.prisma) {
    const vistoria = await tx.vistoria.findUnique({ where: { id } });
    if (!vistoria || !etapasVisiveis(u.perfil).includes(vistoria.etapa)) {
      throw new NotFoundException('Vistoria não encontrada');
    }
    const unidade = await this.unidades.obter(vistoria.unidadeId, u, tx);
    return { vistoria, unidade };
  }

  private exigirEmAndamento(vistoria: { status: StatusVistoria }) {
    if (vistoria.status !== StatusVistoria.EM_ANDAMENTO) {
      throw new BadRequestException('Esta vistoria já foi encerrada');
    }
  }

  async obter(id: string, u: UsuarioLogado) {
    const { vistoria, unidade } = await this.carregar(id, u);
    const itens = await this.prisma.vistoriaItem.findMany({
      where: { vistoriaId: id },
      orderBy: { ordem: 'asc' },
      include: {
        fotos: {
          orderBy: { criadoEm: 'asc' },
          select: { id: true, nomeOriginal: true, tamanho: true, criadoEm: true },
        },
      },
    });
    const cfg = ETAPAS[vistoria.etapa];
    return {
      ...vistoria,
      nome: cfg.nomeVistoria,
      etapaRotulo: cfg.rotulo,
      comCliente: cfg.recebedor === null,
      unidade: {
        id: unidade.id,
        rotulo: rotuloUnidade(unidade),
        empreendimento: unidade.empreendimento.nome,
      },
      podeConduzir:
        vistoria.status === StatusVistoria.EM_ANDAMENTO &&
        regras.podeConduzirVistoria(u, vistoria.etapa),
      itens,
    };
  }

  async marcarItem(
    vistoriaId: string,
    itemId: string,
    dto: { resultado?: ResultadoItem | null; observacao?: string },
    ctx: Contexto,
  ) {
    const { vistoria } = await this.carregar(vistoriaId, ctx.usuario);
    this.exigirEmAndamento(vistoria);
    this.unidades.exigir(regras.podeConduzirVistoria(ctx.usuario, vistoria.etapa));
    const item = await this.prisma.vistoriaItem.findFirst({
      where: { id: itemId, vistoriaId },
    });
    if (!item) throw new NotFoundException('Item não encontrado');

    const resultado = dto.resultado === undefined ? item.resultado : dto.resultado;
    const observacao =
      dto.observacao === undefined ? item.observacao : dto.observacao.trim() || null;
    if (resultado === item.resultado && observacao === item.observacao) return item;

    return this.prisma.$transaction(async (tx) => {
      const atualizado = await tx.vistoriaItem.update({
        where: { id: itemId },
        data: { resultado, observacao },
      });
      await this.auditoria.registrar(
        {
          acao: 'VISTORIA_ITEM_AVALIADO',
          descricao: `${item.ambiente} · ${item.descricao}: ${resultado ? ROTULO_RESULTADO_ITEM[resultado] : 'sem avaliação'}${observacao ? ` — ${observacao}` : ''}`,
          entidade: 'VistoriaItem',
          entidadeId: itemId,
          unidadeId: vistoria.unidadeId,
          etapa: vistoria.etapa,
          ator: ctx.ator,
          dados: {
            antes: { resultado: item.resultado, observacao: item.observacao },
            depois: { resultado, observacao },
          },
        },
        tx,
      );
      return atualizado;
    });
  }

  async adicionarFotos(
    vistoriaId: string,
    itemId: string,
    arquivos: Express.Multer.File[],
    ctx: Contexto,
  ) {
    const { vistoria } = await this.carregar(vistoriaId, ctx.usuario);
    this.exigirEmAndamento(vistoria);
    this.unidades.exigir(regras.podeConduzirVistoria(ctx.usuario, vistoria.etapa));
    const item = await this.prisma.vistoriaItem.findFirst({
      where: { id: itemId, vistoriaId },
      include: { _count: { select: { fotos: true } } },
    });
    if (!item) throw new NotFoundException('Item não encontrado');
    if (!arquivos?.length) throw new BadRequestException('Nenhuma foto enviada');
    const hashes = arquivos.map((a) => sha256(a.buffer));
    const jaGravadas = await this.prisma.foto.count({
      where: { vistoriaItemId: itemId, sha256: { in: hashes } },
    });
    if (item._count.fotos + arquivos.length - jaGravadas > MAX_FOTOS_POR_ITEM) {
      throw new BadRequestException(`Limite de ${MAX_FOTOS_POR_ITEM} fotos por item`);
    }
    const tipos = arquivos.map((a) => tipoDaImagem(a.buffer));
    if (tipos.some((t) => !t)) {
      throw new BadRequestException('Envie apenas imagens JPEG ou PNG');
    }

    const criadas: { id: string }[] = [];
    for (let i = 0; i < arquivos.length; i++) {
      const arquivo = arquivos[i];
      const tipo = tipos[i]!;
      const hash = sha256(arquivo.buffer);
      // O celular reenvia a foto quando não sabe se o envio anterior chegou
      // (sinal caiu no meio). A mesma foto no mesmo item não é gravada de novo.
      const repetida = await this.prisma.foto.findFirst({
        where: { vistoriaItemId: itemId, sha256: hash },
        select: { id: true, nomeOriginal: true, tamanho: true, criadoEm: true },
      });
      if (repetida) {
        criadas.push(repetida);
        continue;
      }
      const chave = await this.armazenamento.salvar('fotos', tipo.ext, arquivo.buffer);
      const foto = await this.prisma.$transaction(async (tx) => {
        const f = await tx.foto.create({
          data: {
            vistoriaItemId: itemId,
            arquivo: chave,
            nomeOriginal: (arquivo.originalname || 'foto').slice(0, 120),
            mime: tipo.mime,
            tamanho: arquivo.size,
            sha256: hash,
            enviadaPorId: ctx.usuario.sub,
          },
          select: { id: true, nomeOriginal: true, tamanho: true, criadoEm: true },
        });
        await this.auditoria.registrar(
          {
            acao: 'VISTORIA_FOTO_ADICIONADA',
            descricao: `Foto adicionada em ${item.ambiente} · ${item.descricao}`,
            entidade: 'Foto',
            entidadeId: f.id,
            unidadeId: vistoria.unidadeId,
            etapa: vistoria.etapa,
            ator: ctx.ator,
            dados: { sha256: hash, tamanho: arquivo.size },
          },
          tx,
        );
        return f;
      });
      criadas.push(foto);
    }
    return criadas;
  }

  private async carregarFoto(fotoId: string, u: UsuarioLogado) {
    const foto = await this.prisma.foto.findUnique({
      where: { id: fotoId },
      include: { vistoriaItem: true },
    });
    if (!foto) throw new NotFoundException('Foto não encontrada');
    const { vistoria } = await this.carregar(foto.vistoriaItem.vistoriaId, u);
    return { foto, vistoria };
  }

  async lerFoto(fotoId: string, u: UsuarioLogado) {
    const { foto } = await this.carregarFoto(fotoId, u);
    return { mime: foto.mime, conteudo: await this.armazenamento.ler(foto.arquivo) };
  }

  async removerFoto(fotoId: string, ctx: Contexto) {
    const { foto, vistoria } = await this.carregarFoto(fotoId, ctx.usuario);
    this.exigirEmAndamento(vistoria);
    this.unidades.exigir(regras.podeConduzirVistoria(ctx.usuario, vistoria.etapa));
    await this.prisma.$transaction(async (tx) => {
      await tx.foto.delete({ where: { id: fotoId } });
      await this.auditoria.registrar(
        {
          acao: 'VISTORIA_FOTO_REMOVIDA',
          descricao: `Foto removida de ${foto.vistoriaItem.ambiente} · ${foto.vistoriaItem.descricao}`,
          entidade: 'Foto',
          entidadeId: fotoId,
          unidadeId: vistoria.unidadeId,
          etapa: vistoria.etapa,
          ator: ctx.ator,
          dados: { sha256: foto.sha256 },
        },
        tx,
      );
    });
    await this.armazenamento.remover(foto.arquivo);
    return { ok: true };
  }

  async concluir(
    id: string,
    dto: { observacoes?: string; acompanhante?: string },
    ctx: Contexto,
  ) {
    const previa = await this.carregar(id, ctx.usuario);
    const resultado = await this.prisma.$transaction(
      async (tx) => {
        await this.unidades.travar(previa.vistoria.unidadeId, tx);
        const { vistoria, unidade } = await this.carregar(id, ctx.usuario, tx);
        this.exigirEmAndamento(vistoria);
        this.unidades.exigir(regras.podeConduzirVistoria(ctx.usuario, vistoria.etapa));
        const cfg = ETAPAS[vistoria.etapa];

        const itens = await tx.vistoriaItem.findMany({
          where: { vistoriaId: id },
          orderBy: { ordem: 'asc' },
        });
        const semAvaliacao = itens.filter((i) => !i.resultado);
        if (semAvaliacao.length) {
          throw new BadRequestException(
            `Faltam ${semAvaliacao.length} item(ns) para avaliar. Primeiro: ${semAvaliacao[0].ambiente} · ${semAvaliacao[0].descricao}`,
          );
        }
        const semJustificativa = itens.find(
          (i) =>
            (i.resultado === ResultadoItem.NAO_CONFORME || i.resultado === ResultadoItem.RESSALVA) &&
            !i.observacao,
        );
        if (semJustificativa) {
          throw new BadRequestException(
            `Descreva o problema em "${semJustificativa.ambiente} · ${semJustificativa.descricao}": itens não conformes ou com ressalva exigem observação.`,
          );
        }
        if (itens.every((i) => i.resultado === ResultadoItem.NAO_SE_APLICA)) {
          throw new BadRequestException('Nenhum item aplicável foi avaliado');
        }
        const acompanhante = dto.acompanhante?.trim() || null;
        if (cfg.recebedor !== null && cfg.exigeAgendamento && !acompanhante) {
          throw new BadRequestException(
            `Informe quem acompanhou a vistoria pela ${cfg.parteCedente === 'CONSTRUTORA' ? 'construtora' : 'outra parte'}`,
          );
        }

        const naoConformes = itens.filter((i) => i.resultado === ResultadoItem.NAO_CONFORME);
        const ressalvas = itens.filter((i) => i.resultado === ResultadoItem.RESSALVA);
        const resultadoGeral = naoConformes.length
          ? ResultadoVistoria.REPROVADA
          : ressalvas.length
            ? ResultadoVistoria.APROVADA_COM_RESSALVAS
            : ResultadoVistoria.APROVADA;

        await tx.vistoria.update({
          where: { id },
          data: {
            status: StatusVistoria.CONCLUIDA,
            resultado: resultadoGeral,
            observacoes: dto.observacoes?.trim() || null,
            acompanhante,
            concluidaEm: new Date(),
          },
        });
        const resumo = {
          resultado: resultadoGeral,
          conformes: itens.filter((i) => i.resultado === ResultadoItem.CONFORME).length,
          ressalvas: ressalvas.length,
          naoConformes: naoConformes.length,
          naoSeAplica: itens.filter((i) => i.resultado === ResultadoItem.NAO_SE_APLICA).length,
          acompanhante,
          observacoes: dto.observacoes?.trim() || null,
        };
        const evento = {
          acao: 'VISTORIA_CONCLUIDA',
          ator: ctx.ator,
          entidade: 'Vistoria',
          entidadeId: id,
          dados: resumo,
        };

        if (resultadoGeral === ResultadoVistoria.REPROVADA) {
          await tx.pendencia.createMany({
            data: naoConformes.map((i) => ({
              unidadeId: unidade.id,
              etapa: vistoria.etapa,
              vistoriaId: id,
              vistoriaItemId: i.id,
              descricao: `${i.ambiente} · ${i.descricao}: ${i.observacao}`,
            })),
          });
          await this.unidades.mudarEstado(
            tx,
            unidade,
            { status: StatusUnidade.COM_PENDENCIAS },
            {
              ...evento,
              descricao: `${cfg.nomeVistoria} da unidade ${rotuloUnidade(unidade)} REPROVADA: ${naoConformes.length} item(ns) não conforme(s) viraram pendências`,
            },
          );
          return { resultado: resultadoGeral, envelopeId: null, protocolo: null };
        }

        await this.unidades.mudarEstado(
          tx,
          unidade,
          { status: StatusUnidade.AGUARDANDO_ASSINATURA },
          {
            ...evento,
            descricao: `${cfg.nomeVistoria} da unidade ${rotuloUnidade(unidade)} concluída: ${ROTULO_RESULTADO_VISTORIA[resultadoGeral]}`,
          },
        );
        const termo = await this.assinaturas.emitir(tx, id, ctx.ator);
        return { resultado: resultadoGeral, ...termo };
      },
      // Montar o PDF com as fotos pode passar dos 5s padrão
      { timeout: 60000, maxWait: 10000 },
    );
    if (resultado.envelopeId) await this.assinaturas.aposEmitir(resultado.envelopeId);
    return resultado;
  }

  // Vistoria aberta por engano, ou que não pôde acontecer: a unidade volta a
  // aguardar agendamento (ou conferência).
  cancelar(id: string, motivo: string, ctx: Contexto) {
    return this.prisma.$transaction(async (tx) => {
      const previa = await this.carregar(id, ctx.usuario, tx);
      await this.unidades.travar(previa.vistoria.unidadeId, tx);
      const { vistoria, unidade } = await this.carregar(id, ctx.usuario, tx);
      this.exigirEmAndamento(vistoria);
      this.unidades.exigir(regras.podeConduzirVistoria(ctx.usuario, vistoria.etapa));
      await tx.vistoria.update({
        where: { id },
        data: { status: StatusVistoria.CANCELADA, observacoes: motivo, concluidaEm: new Date() },
      });
      await this.unidades.mudarEstado(
        tx,
        unidade,
        { status: statusAposLiberacao(unidade.etapa) },
        {
          acao: 'VISTORIA_CANCELADA',
          descricao: `${ETAPAS[vistoria.etapa].nomeVistoria} da unidade ${rotuloUnidade(unidade)} cancelada: ${motivo}`,
          ator: ctx.ator,
          entidade: 'Vistoria',
          entidadeId: id,
          dados: { motivo },
        },
      );
      return { ok: true };
    });
  }
}
