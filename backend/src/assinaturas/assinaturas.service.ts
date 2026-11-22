import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  MetodoAssinatura,
  ParteSignataria,
  Prisma,
  ProvedorAssinatura,
  StatusEnvelope,
  StatusPendencia,
  StatusSignatario,
  StatusUnidade,
  TipoAtor,
  TipoOrganizacao,
} from '@prisma/client';
import { timingSafeEqual } from 'crypto';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthService } from '../auth/auth.service';
import { Ator, ATOR_SISTEMA, Contexto } from '../comum/contexto';
import {
  ETAPAS,
  etapasVisiveis,
  ROTULO_PARTE,
  statusAposLiberacao,
} from '../comum/fluxo';
import * as regras from '../comum/regras';
import {
  codigoNumerico,
  mascararEmail,
  nomeAbreviado,
  novoProtocolo,
  sha256,
  tokenAleatorio,
} from '../comum/util';
import { TermoPdfService } from '../documentos/termo-pdf.service';
import {
  AssinaturaTermo,
  ConteudoTermo,
  DECLARACOES,
  ParteTermo,
} from '../documentos/termo';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { rotuloUnidade, UnidadesService } from '../unidades/unidades.service';
import { ArmazenamentoService } from '../vistorias/armazenamento.service';
import { EnvioService } from './envio.service';
import { SituacaoExterna } from './provedor';
import { EventoRsfSigner, RsfSignerProvedor } from './rsf-signer.provedor';

type Origem = { ip: string | null; userAgent: string | null };

interface Evidencia {
  metodo: MetodoAssinatura;
  nome: string;
  cpf?: string | null;
  usuarioId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  localizacao?: string | null;
  assinaturaImagem?: string | null;
  assinadoEm?: Date;
}

const IMAGEM_PNG = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;

@Injectable()
export class AssinaturasService {
  private log = new Logger('Assinaturas');

  constructor(
    private prisma: PrismaService,
    private auditoria: AuditoriaService,
    private unidades: UnidadesService,
    private pdf: TermoPdfService,
    private armazenamento: ArmazenamentoService,
    private envio: EnvioService,
    private rsfSigner: RsfSignerProvedor,
    private auth: AuthService,
  ) {}

  provedorPadrao(): ProvedorAssinatura {
    return (process.env.ASSINATURA_PROVEDOR || '').toLowerCase() === 'rsf-signer'
      ? ProvedorAssinatura.RSF_SIGNER
      : ProvedorAssinatura.INTERNO;
  }

  private minutosDoCodigo() {
    return Number(process.env.CODIGO_MINUTOS) || 15;
  }

  private tentativasDoCodigo() {
    return Number(process.env.CODIGO_TENTATIVAS) || 5;
  }

  private validarImagem(imagem?: string | null): string | null {
    if (!imagem) return null;
    if (imagem.length > 400_000 || !IMAGEM_PNG.test(imagem)) {
      throw new BadRequestException('Imagem de assinatura inválida');
    }
    return imagem;
  }

  // ------------------------------------------------------------------
  // Emissão do termo (chamada na conclusão de uma vistoria aprovada)
  // ------------------------------------------------------------------

  async emitir(tx: Tx, vistoriaId: string, ator: Ator) {
    const vistoria = await tx.vistoria.findUniqueOrThrow({
      where: { id: vistoriaId },
      include: {
        agendamento: true,
        itens: { orderBy: { ordem: 'asc' }, include: { fotos: { orderBy: { criadoEm: 'asc' } } } },
        unidade: {
          include: {
            cliente: true,
            empreendimento: { include: { construtora: true, incorporadora: true } },
          },
        },
      },
    });
    const { unidade } = vistoria;
    const cfg = ETAPAS[vistoria.etapa];
    const emp = unidade.empreendimento;

    const vistoriador = await tx.usuario.findUnique({
      where: { id: vistoria.vistoriadorId },
      include: { organizacao: true },
    });
    const liberou = unidade.liberadaPorId
      ? await tx.usuario.findUnique({ where: { id: unidade.liberadaPorId } })
      : null;
    const central =
      vistoriador?.organizacao?.tipo === TipoOrganizacao.CENTRAL_RELACIONAMENTO
        ? vistoriador.organizacao
        : await tx.organizacao.findFirst({
            where: { tipo: TipoOrganizacao.CENTRAL_RELACIONAMENTO, ativo: true },
            orderBy: { criadoEm: 'asc' },
          });

    // Quem se espera que assine por cada parte: quem liberou a unidade assina
    // por quem entrega; quem vistoriou, por quem recebe. Na etapa do cliente,
    // o Relacionamento (que vistoriou) entrega e o cliente recebe.
    const cedenteUsuario = cfg.recebedor === null ? vistoriador : liberou;
    const recebedorUsuario = cfg.recebedor === null ? null : vistoriador;

    const dadosDaParte = (
      parte: ParteSignataria,
      representante: string | null,
    ): ParteTermo => {
      const rotulo = ROTULO_PARTE[parte];
      switch (parte) {
        case ParteSignataria.CONSTRUTORA:
          return { parte: rotulo, nome: emp.construtora.nome, documento: emp.construtora.cnpj, representante };
        case ParteSignataria.INCORPORADORA:
          return {
            parte: rotulo,
            nome: emp.incorporadora?.nome ?? 'Incorporadora',
            documento: emp.incorporadora?.cnpj ?? null,
            representante,
          };
        case ParteSignataria.RELACIONAMENTO:
          return {
            parte: rotulo,
            nome: central?.nome ?? 'Central de Relacionamento',
            documento: central?.cnpj ?? null,
            representante,
          };
        default:
          return {
            parte: rotulo,
            nome: unidade.cliente?.nome ?? 'Cliente',
            documento: unidade.cliente?.cpfCnpj ?? null,
            representante: null,
          };
      }
    };

    if (cfg.recebedor === null && !unidade.cliente) {
      throw new BadRequestException('A unidade não tem cliente vinculado para assinar o termo');
    }

    const sanadas = await tx.pendencia.findMany({
      where: { unidadeId: unidade.id, etapa: vistoria.etapa, status: StatusPendencia.RESOLVIDA },
      orderBy: { criadoEm: 'asc' },
    });
    const aplicaveis = vistoria.itens.filter((i) => i.resultado !== 'NAO_SE_APLICA');

    // Protocolo único: em caso (raríssimo) de colisão, sorteia outro
    let protocolo = novoProtocolo();
    while (await tx.documento.findUnique({ where: { protocolo } })) {
      protocolo = novoProtocolo();
    }

    const conteudo: ConteudoTermo = {
      protocolo,
      titulo: cfg.tituloDocumento,
      tipo: cfg.tipoDocumento,
      etapa: cfg.rotulo,
      emitidoEm: new Date().toISOString(),
      empreendimento: { nome: emp.nome, codigo: emp.codigo, endereco: emp.endereco },
      unidade: {
        bloco: unidade.bloco,
        numero: unidade.numero,
        andar: unidade.andar,
        tipologia: unidade.tipologia,
      },
      cedente: dadosDaParte(cfg.parteCedente, cedenteUsuario?.nome ?? null),
      recebedor: dadosDaParte(cfg.parteRecebedora, recebedorUsuario?.nome ?? null),
      vistoria: {
        nome: cfg.nomeVistoria,
        agendadaPara: vistoria.agendamento?.dataHora?.toISOString() ?? null,
        iniciadaEm: vistoria.iniciadaEm.toISOString(),
        concluidaEm: (vistoria.concluidaEm ?? new Date()).toISOString(),
        vistoriador: vistoria.vistoriadorNome,
        acompanhante: vistoria.acompanhante,
        resultado: vistoria.resultado ?? '',
        observacoes: vistoria.observacoes,
        conformes: aplicaveis.filter((i) => i.resultado === 'CONFORME' || i.resultado === 'RESSALVA').length,
        aplicaveis: aplicaveis.length,
      },
      itens: vistoria.itens.map((i) => ({
        ambiente: i.ambiente,
        descricao: i.descricao,
        resultado: i.resultado ?? '',
        observacao: i.observacao,
        fotos: i.fotos.map((f) => f.arquivo),
      })),
      pendenciasSanadas: sanadas.map((p) => ({
        descricao: p.descricao,
        resolucao: p.resolucao ?? '',
        resolvidaPor: p.resolvidaPorNome ?? '',
        resolvidaEm: (p.resolvidaEm ?? p.criadoEm).toISOString(),
      })),
      declaracao: DECLARACOES[cfg.tipoDocumento],
    };

    const pdf = await this.pdf.gerar(conteudo);
    const arquivo = await this.armazenamento.salvar('termos', 'pdf', pdf);
    const provedor = this.provedorPadrao();

    const documento = await tx.documento.create({
      data: {
        unidadeId: unidade.id,
        etapa: vistoria.etapa,
        vistoriaId: vistoria.id,
        tipo: cfg.tipoDocumento,
        protocolo,
        titulo: cfg.tituloDocumento,
        conteudo: conteudo as unknown as Prisma.InputJsonValue,
        arquivo,
        sha256: sha256(pdf),
        tamanho: pdf.length,
        envelope: {
          create: {
            provedor,
            signatarios: {
              create: [
                {
                  parte: cfg.parteCedente,
                  ordem: 1,
                  nome: cedenteUsuario?.nome ?? ROTULO_PARTE[cfg.parteCedente],
                  cpf: cedenteUsuario?.cpf ?? null,
                  email: cedenteUsuario?.email ?? null,
                  usuarioId: cedenteUsuario?.id ?? null,
                },
                cfg.recebedor === null
                  ? {
                      parte: ParteSignataria.CLIENTE,
                      ordem: 2,
                      nome: unidade.cliente!.nome,
                      cpf: unidade.cliente!.cpfCnpj,
                      email: unidade.cliente!.email,
                      clienteId: unidade.cliente!.id,
                      // Link público só existe quando é o SysEntrega que colhe
                      token: provedor === ProvedorAssinatura.INTERNO ? tokenAleatorio() : null,
                    }
                  : {
                      parte: cfg.parteRecebedora,
                      ordem: 2,
                      nome: recebedorUsuario?.nome ?? ROTULO_PARTE[cfg.parteRecebedora],
                      cpf: recebedorUsuario?.cpf ?? null,
                      email: recebedorUsuario?.email ?? null,
                      usuarioId: recebedorUsuario?.id ?? null,
                    },
              ],
            },
          },
        },
      },
      include: { envelope: true },
    });

    await this.auditoria.registrar(
      {
        acao: 'TERMO_EMITIDO',
        descricao: `${cfg.tituloDocumento} emitido com o protocolo ${protocolo}, aguardando assinatura das partes`,
        entidade: 'Documento',
        entidadeId: documento.id,
        unidadeId: unidade.id,
        etapa: vistoria.etapa,
        ator,
        dados: { protocolo, sha256: documento.sha256, provedor, vistoriaId },
      },
      tx,
    );
    return { documentoId: documento.id, envelopeId: documento.envelope!.id, protocolo };
  }

  // Depois que a emissão foi gravada: avisa quem precisa assinar. Nada aqui
  // desfaz a emissão — se falhar, fica registrado e pode ser refeito.
  async aposEmitir(envelopeId: string) {
    const env = await this.prisma.envelope.findUnique({
      where: { id: envelopeId },
      include: { documento: { include: { unidade: true } }, signatarios: true },
    });
    if (!env) return;
    if (env.provedor === ProvedorAssinatura.RSF_SIGNER) {
      await this.enviarAoRsfSigner(envelopeId, ATOR_SISTEMA).catch(() => undefined);
      return;
    }
    const cliente = env.signatarios.find((s) => s.token && s.email);
    const site = (process.env.APP_URL || '').replace(/\/$/, '');
    if (cliente && site) {
      const enviado = await this.envio.enviarLink(
        cliente.email!,
        `Termo ${env.documento.protocolo} aguardando sua assinatura`,
        `Olá, ${cliente.nome.split(' ')[0]}.\n\nO ${env.documento.titulo} da sua unidade está pronto para assinatura.\n\n` +
          `Leia e assine em: ${site}/assinar/${cliente.token}\n\nRSF · SysEntrega`,
      );
      if (enviado) {
        await this.auditoria.registrar({
          acao: 'LINK_ASSINATURA_ENVIADO',
          descricao: `Link de assinatura do termo ${env.documento.protocolo} enviado ao e-mail do cliente (${mascararEmail(cliente.email!)})`,
          entidade: 'Signatario',
          entidadeId: cliente.id,
          unidadeId: env.documento.unidadeId,
          etapa: env.documento.etapa,
          ator: ATOR_SISTEMA,
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Núcleo: registrar assinatura / recusa, venha de onde vier
  // ------------------------------------------------------------------

  private async carregar(tx: Tx, signatarioId: string) {
    const sig = await tx.signatario.findUnique({
      where: { id: signatarioId },
      include: {
        envelope: { include: { documento: { include: { unidade: true } } } },
      },
    });
    if (!sig) throw new NotFoundException('Signatário não encontrado');
    return sig;
  }

  private exigirPendente(sig: Awaited<ReturnType<AssinaturasService['carregar']>>) {
    const { envelope } = sig;
    const { unidade } = envelope.documento;
    if (envelope.status !== StatusEnvelope.PENDENTE || sig.status !== StatusSignatario.PENDENTE) {
      throw new BadRequestException('Este termo não está mais aguardando esta assinatura');
    }
    if (
      unidade.etapa !== envelope.documento.etapa ||
      unidade.status !== StatusUnidade.AGUARDANDO_ASSINATURA
    ) {
      throw new BadRequestException('A unidade não está aguardando assinatura deste termo');
    }
  }

  async registrarAssinatura(tx: Tx, signatarioId: string, ev: Evidencia, ator: Ator, extra?: Record<string, unknown>) {
    const sig = await this.carregar(tx, signatarioId);
    // Repetição do mesmo aviso (webhook reenviado, duplo clique): nada a fazer
    if (sig.status === StatusSignatario.ASSINADO) return;
    this.exigirPendente(sig);
    const { envelope } = sig;
    const { documento } = envelope;

    await tx.signatario.update({
      where: { id: sig.id },
      data: {
        status: StatusSignatario.ASSINADO,
        metodo: ev.metodo,
        nome: ev.nome,
        cpf: ev.cpf ?? sig.cpf,
        usuarioId: ev.usuarioId ?? sig.usuarioId,
        assinadoEm: ev.assinadoEm ?? new Date(),
        ip: ev.ip ?? null,
        userAgent: ev.userAgent ?? null,
        localizacao: ev.localizacao ?? null,
        assinaturaImagem: ev.assinaturaImagem ?? null,
        codigoHash: null,
        codigoExpiraEm: null,
      },
    });
    await this.auditoria.registrar(
      {
        acao: 'TERMO_ASSINADO',
        descricao: `${ev.nome} assinou o termo ${documento.protocolo} pela parte ${ROTULO_PARTE[sig.parte]}`,
        entidade: 'Signatario',
        entidadeId: sig.id,
        unidadeId: documento.unidadeId,
        etapa: documento.etapa,
        ator,
        dados: {
          protocolo: documento.protocolo,
          sha256: documento.sha256,
          metodo: ev.metodo,
          localizacao: ev.localizacao ?? null,
          comRubrica: !!ev.assinaturaImagem,
          ...extra,
        },
      },
      tx,
    );

    const pendentes = await tx.signatario.count({
      where: { envelopeId: envelope.id, status: { not: StatusSignatario.ASSINADO } },
    });
    if (pendentes === 0) await this.concluir(tx, envelope.id, ator);
  }

  private async concluir(tx: Tx, envelopeId: string, ator: Ator) {
    const env = await tx.envelope.findUniqueOrThrow({
      where: { id: envelopeId },
      include: {
        documento: { include: { unidade: true } },
        signatarios: { orderBy: { ordem: 'asc' } },
      },
    });
    const assinaturas: AssinaturaTermo[] = env.signatarios.map((s) => ({
      parte: ROTULO_PARTE[s.parte],
      nome: s.nome,
      cpf: s.cpf,
      // Código que só apareceu no log do servidor não prova nada: o termo diz isso
      metodo: s.codigoCanal === 'ensaio' ? 'ENSAIO' : (s.metodo ?? ''),
      assinadoEm: (s.assinadoEm ?? new Date()).toISOString(),
      ip: s.ip,
      userAgent: s.userAgent,
      localizacao: s.localizacao,
      assinaturaImagem: s.assinaturaImagem,
    }));
    const pdf = await this.pdf.gerar(env.documento.conteudo as unknown as ConteudoTermo, {
      sha256Original: env.documento.sha256,
      assinaturas,
    });
    const arquivoAssinado = await this.armazenamento.salvar('termos', 'pdf', pdf);
    await tx.documento.update({
      where: { id: env.documentoId },
      data: { arquivoAssinado, sha256Assinado: sha256(pdf) },
    });
    await tx.envelope.update({
      where: { id: env.id },
      data: { status: StatusEnvelope.CONCLUIDO, concluidoEm: new Date() },
    });
    await this.unidades.concluirEtapa(tx, env.documento.unidade, ator, env.documento.protocolo);
  }

  async registrarRecusa(tx: Tx, signatarioId: string, motivo: string, ator: Ator, nome?: string) {
    const sig = await this.carregar(tx, signatarioId);
    if (sig.status === StatusSignatario.RECUSADO) return;
    this.exigirPendente(sig);
    const { documento } = sig.envelope;
    const quem = nome ?? sig.nome;

    await tx.signatario.update({
      where: { id: sig.id },
      data: {
        status: StatusSignatario.RECUSADO,
        nome: quem,
        motivoRecusa: motivo,
        ip: ator.ip ?? null,
        userAgent: ator.userAgent ?? null,
        codigoHash: null,
        codigoExpiraEm: null,
      },
    });
    await tx.envelope.update({
      where: { id: sig.envelopeId },
      data: { status: StatusEnvelope.RECUSADO },
    });
    await tx.pendencia.create({
      data: {
        unidadeId: documento.unidadeId,
        etapa: documento.etapa,
        vistoriaId: documento.vistoriaId,
        descricao: `Assinatura do termo ${documento.protocolo} recusada por ${quem} (${ROTULO_PARTE[sig.parte]}): ${motivo}`,
      },
    });
    await this.unidades.mudarEstado(
      tx,
      documento.unidade,
      { status: StatusUnidade.COM_PENDENCIAS },
      {
        acao: 'TERMO_RECUSADO',
        descricao: `${quem} (${ROTULO_PARTE[sig.parte]}) recusou assinar o termo ${documento.protocolo}: ${motivo}`,
        ator,
        entidade: 'Signatario',
        entidadeId: sig.id,
        dados: { protocolo: documento.protocolo, motivo },
      },
    );
  }

  // ------------------------------------------------------------------
  // Usuário autenticado (construtora, incorporadora, relacionamento)
  // ------------------------------------------------------------------

  private async prepararUsuario(signatarioId: string, ctx: Contexto) {
    const sig = await this.carregar(this.prisma, signatarioId);
    // Escopo: a construtora só alcança termos das obras dela
    await this.unidades.obter(sig.envelope.documento.unidadeId, ctx.usuario);
    if (!regras.podeAssinar(ctx.usuario, sig, sig.envelope)) {
      throw new ForbiddenException(
        sig.envelope.provedor === ProvedorAssinatura.RSF_SIGNER
          ? 'Este termo é assinado pelo rsf-signer'
          : 'Esta assinatura cabe a outra parte',
      );
    }
    return sig;
  }

  async assinarComoUsuario(
    signatarioId: string,
    dto: { senha: string; assinaturaImagem?: string; localizacao?: string },
    ctx: Contexto,
  ) {
    const sig = await this.prepararUsuario(signatarioId, ctx);
    const imagem = this.validarImagem(dto.assinaturaImagem);
    if (!(await this.auth.conferirSenha(ctx.usuario.sub, dto.senha))) {
      await this.auditoria.registrar({
        acao: 'ASSINATURA_SENHA_INCORRETA',
        descricao: `Senha incorreta ao tentar assinar o termo ${sig.envelope.documento.protocolo}`,
        entidade: 'Signatario',
        entidadeId: sig.id,
        unidadeId: sig.envelope.documento.unidadeId,
        etapa: sig.envelope.documento.etapa,
        ator: ctx.ator,
      });
      throw new ForbiddenException('Senha incorreta');
    }
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: ctx.usuario.sub },
    });
    await this.prisma.$transaction(
      async (tx) => {
        await this.unidades.travar(sig.envelope.documento.unidadeId, tx);
        await this.registrarAssinatura(
          tx,
          sig.id,
          {
            metodo: MetodoAssinatura.SESSAO_AUTENTICADA,
            nome: ctx.usuario.nome,
            cpf: usuario.cpf,
            usuarioId: usuario.id,
            ip: ctx.ip,
            userAgent: ctx.userAgent,
            localizacao: dto.localizacao?.slice(0, 80) ?? null,
            assinaturaImagem: imagem,
          },
          ctx.ator,
        );
      },
      { timeout: 30000 },
    );
    return { ok: true };
  }

  async recusarComoUsuario(signatarioId: string, motivo: string, ctx: Contexto) {
    const sig = await this.prepararUsuario(signatarioId, ctx);
    await this.prisma.$transaction(async (tx) => {
      await this.unidades.travar(sig.envelope.documento.unidadeId, tx);
      await this.registrarRecusa(tx, sig.id, motivo, ctx.ator, ctx.usuario.nome);
    });
    return { ok: true };
  }

  // Quem conduziu a vistoria pode anular um termo ainda não concluído (erro
  // na vistoria, dados errados). A unidade volta para nova vistoria.
  async cancelarEnvelope(envelopeId: string, motivo: string, ctx: Contexto) {
    const env = await this.prisma.envelope.findUnique({
      where: { id: envelopeId },
      include: { documento: true },
    });
    if (!env) throw new NotFoundException('Termo não encontrado');
    await this.unidades.obter(env.documento.unidadeId, ctx.usuario);
    this.unidades.exigir(regras.podeConduzirVistoria(ctx.usuario, env.documento.etapa));

    await this.prisma.$transaction(async (tx) => {
      await this.unidades.travar(env.documento.unidadeId, tx);
      const atual = await tx.envelope.findUniqueOrThrow({
        where: { id: envelopeId },
        include: { documento: { include: { unidade: true } } },
      });
      const { unidade } = atual.documento;
      if (
        atual.status !== StatusEnvelope.PENDENTE ||
        unidade.etapa !== atual.documento.etapa ||
        unidade.status !== StatusUnidade.AGUARDANDO_ASSINATURA
      ) {
        throw new BadRequestException('Só é possível anular um termo que ainda aguarda assinaturas');
      }
      await tx.envelope.update({
        where: { id: envelopeId },
        data: { status: StatusEnvelope.CANCELADO },
      });
      await this.unidades.mudarEstado(
        tx,
        unidade,
        { status: statusAposLiberacao(unidade.etapa) },
        {
          acao: 'TERMO_ANULADO',
          descricao: `Termo ${atual.documento.protocolo} anulado antes da conclusão das assinaturas: ${motivo}`,
          ator: ctx.ator,
          entidade: 'Envelope',
          entidadeId: envelopeId,
          dados: { protocolo: atual.documento.protocolo, motivo },
        },
      );
    });

    if (env.provedor === ProvedorAssinatura.RSF_SIGNER && env.idExterno) {
      try {
        await this.rsfSigner.cancelar(env.idExterno, motivo);
      } catch (erro) {
        await this.auditoria.registrar({
          acao: 'RSF_SIGNER_FALHA',
          descricao: `Termo ${env.documento.protocolo} anulado aqui, mas o cancelamento no rsf-signer falhou: ${(erro as Error).message}`,
          entidade: 'Envelope',
          entidadeId: envelopeId,
          unidadeId: env.documento.unidadeId,
          etapa: env.documento.etapa,
          ator: ATOR_SISTEMA,
        });
      }
    }
    return { ok: true };
  }

  // ------------------------------------------------------------------
  // Download do termo
  // ------------------------------------------------------------------

  async baixar(documentoId: string, versao: 'original' | 'assinado', ctx: Contexto) {
    const doc = await this.prisma.documento.findUnique({ where: { id: documentoId } });
    if (!doc || !etapasVisiveis(ctx.usuario.perfil).includes(doc.etapa)) {
      throw new NotFoundException('Documento não encontrado');
    }
    await this.unidades.obter(doc.unidadeId, ctx.usuario);
    const chave = versao === 'assinado' ? doc.arquivoAssinado : doc.arquivo;
    if (!chave) throw new NotFoundException('O termo ainda não foi assinado por todas as partes');
    await this.auditoria.registrar({
      acao: 'DOCUMENTO_BAIXADO',
      descricao: `Termo ${doc.protocolo} (${versao}) baixado`,
      entidade: 'Documento',
      entidadeId: doc.id,
      unidadeId: doc.unidadeId,
      etapa: doc.etapa,
      ator: ctx.ator,
    });
    return {
      nome: `${doc.protocolo}${versao === 'assinado' ? '-assinado' : ''}.pdf`,
      pdf: await this.armazenamento.ler(chave),
    };
  }

  // ------------------------------------------------------------------
  // Cliente, pelo link público (sem login)
  // ------------------------------------------------------------------

  private async porToken(token: string, tx: Tx = this.prisma) {
    const sig = await tx.signatario.findUnique({
      where: { token },
      include: {
        envelope: {
          include: {
            documento: {
              include: { unidade: { include: { empreendimento: true } }, vistoria: true },
            },
          },
        },
      },
    });
    if (!sig) throw new NotFoundException('Link de assinatura inválido');
    return sig;
  }

  private atorCliente(sig: { clienteId: string | null; nome: string }, origem: Origem): Ator {
    return {
      tipo: TipoAtor.CLIENTE,
      id: sig.clienteId,
      nome: sig.nome,
      perfil: 'CLIENTE',
      ...origem,
    };
  }

  async publicoObter(token: string) {
    const sig = await this.porToken(token);
    const { documento } = sig.envelope;
    const pendente =
      sig.status === StatusSignatario.PENDENTE &&
      sig.envelope.status === StatusEnvelope.PENDENTE;
    return {
      protocolo: documento.protocolo,
      titulo: documento.titulo,
      empreendimento: documento.unidade.empreendimento.nome,
      unidade: rotuloUnidade(documento.unidade),
      resultadoVistoria: documento.vistoria?.resultado ?? null,
      nome: nomeAbreviado(sig.nome),
      email: sig.email ? mascararEmail(sig.email) : null,
      status: sig.status,
      statusEnvelope: sig.envelope.status,
      assinadoEm: sig.assinadoEm,
      pendente,
      temAssinado: !!documento.arquivoAssinado,
      codigoEnviado: pendente && !!sig.codigoHash && !!sig.codigoExpiraEm && sig.codigoExpiraEm > new Date(),
      sha256: documento.sha256,
    };
  }

  async publicoDocumento(token: string, origem: Origem) {
    const sig = await this.porToken(token);
    const { documento } = sig.envelope;
    await this.auditoria.registrar({
      acao: 'DOCUMENTO_BAIXADO',
      descricao: `Termo ${documento.protocolo} aberto pelo cliente no link de assinatura`,
      entidade: 'Documento',
      entidadeId: documento.id,
      unidadeId: documento.unidadeId,
      etapa: documento.etapa,
      ator: this.atorCliente(sig, origem),
    });
    return {
      nome: `${documento.protocolo}.pdf`,
      pdf: await this.armazenamento.ler(documento.arquivoAssinado ?? documento.arquivo),
    };
  }

  private hashDoCodigo(signatarioId: string, codigo: string) {
    return sha256(`${signatarioId}:${codigo}`);
  }

  async publicoEnviarCodigo(token: string, origem: Origem) {
    const sig = await this.porToken(token);
    this.exigirPendente(sig);
    if (!sig.email) {
      throw new BadRequestException(
        'Não há e-mail cadastrado para envio do código. Fale com a Central de Relacionamento.',
      );
    }
    if (sig.codigoEnviadoEm && Date.now() - sig.codigoEnviadoEm.getTime() < 60_000) {
      throw new HttpException(
        'Aguarde um minuto antes de pedir um novo código',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const codigo = codigoNumerico(6);
    const minutos = this.minutosDoCodigo();
    const { ensaio } = await this.envio.enviarCodigo(sig.email, codigo, {
      protocolo: sig.envelope.documento.protocolo,
      minutos,
    });
    // Só o hash do código fica no banco
    await this.prisma.signatario.update({
      where: { id: sig.id },
      data: {
        codigoHash: this.hashDoCodigo(sig.id, codigo),
        codigoExpiraEm: new Date(Date.now() + minutos * 60_000),
        codigoTentativas: 0,
        codigoEnviadoEm: new Date(),
        codigoCanal: ensaio ? 'ensaio' : 'email',
      },
    });
    await this.auditoria.registrar({
      acao: 'CODIGO_ASSINATURA_ENVIADO',
      descricao: ensaio
        ? `ENSAIO: código de assinatura do termo ${sig.envelope.documento.protocolo} escrito no log do servidor (não foi enviado ao titular — sem valor de assinatura)`
        : `Código de assinatura do termo ${sig.envelope.documento.protocolo} enviado para ${mascararEmail(sig.email)}`,
      entidade: 'Signatario',
      entidadeId: sig.id,
      unidadeId: sig.envelope.documento.unidadeId,
      etapa: sig.envelope.documento.etapa,
      ator: this.atorCliente(sig, origem),
      dados: { ensaio, validadeMinutos: minutos },
    });
    return { enviadoPara: mascararEmail(sig.email), validadeMinutos: minutos, ensaio };
  }

  async publicoAssinar(
    token: string,
    dto: { codigo: string; assinaturaImagem?: string; localizacao?: string },
    origem: Origem,
  ) {
    const sig = await this.porToken(token);
    this.exigirPendente(sig);
    const imagem = this.validarImagem(dto.assinaturaImagem);
    const ator = this.atorCliente(sig, origem);
    const { documento } = sig.envelope;

    if (!sig.codigoHash || !sig.codigoExpiraEm || sig.codigoExpiraEm < new Date()) {
      throw new BadRequestException('Código expirado ou não solicitado. Peça um novo código.');
    }
    // Conta a tentativa antes de conferir: duas tentativas simultâneas não
    // passam do limite.
    const { codigoTentativas } = await this.prisma.signatario.update({
      where: { id: sig.id },
      data: { codigoTentativas: { increment: 1 } },
    });
    if (codigoTentativas > this.tentativasDoCodigo()) {
      await this.prisma.signatario.update({
        where: { id: sig.id },
        data: { codigoHash: null, codigoExpiraEm: null },
      });
      throw new BadRequestException('Muitas tentativas. Peça um novo código.');
    }
    const esperado = Buffer.from(sig.codigoHash, 'hex');
    const recebido = Buffer.from(this.hashDoCodigo(sig.id, dto.codigo.trim()), 'hex');
    if (!timingSafeEqual(esperado, recebido)) {
      await this.auditoria.registrar({
        acao: 'CODIGO_ASSINATURA_INCORRETO',
        descricao: `Código incorreto na assinatura do termo ${documento.protocolo} (tentativa ${codigoTentativas} de ${this.tentativasDoCodigo()})`,
        entidade: 'Signatario',
        entidadeId: sig.id,
        unidadeId: documento.unidadeId,
        etapa: documento.etapa,
        ator,
      });
      throw new BadRequestException('Código incorreto');
    }

    await this.prisma.$transaction(
      async (tx) => {
        await this.unidades.travar(documento.unidadeId, tx);
        await this.registrarAssinatura(
          tx,
          sig.id,
          {
            metodo: MetodoAssinatura.CODIGO_USO_UNICO,
            nome: sig.nome,
            cpf: sig.cpf,
            ip: origem.ip,
            userAgent: origem.userAgent,
            localizacao: dto.localizacao?.slice(0, 80) ?? null,
            assinaturaImagem: imagem,
          },
          ator,
          { canalDoCodigo: sig.codigoCanal, ensaio: sig.codigoCanal === 'ensaio' },
        );
      },
      { timeout: 30000 },
    );
    return { ok: true };
  }

  async publicoRecusar(token: string, motivo: string, origem: Origem) {
    const sig = await this.porToken(token);
    await this.prisma.$transaction(async (tx) => {
      await this.unidades.travar(sig.envelope.documento.unidadeId, tx);
      await this.registrarRecusa(tx, sig.id, motivo, this.atorCliente(sig, origem));
    });
    return { ok: true };
  }

  // Conferência pública do termo pelo protocolo: só o que confirma o
  // documento. Nada de CPF, e-mail ou IP.
  async publicoVerificar(protocolo: string, hash?: string) {
    const doc = await this.prisma.documento.findUnique({
      where: { protocolo: protocolo.trim().toUpperCase() },
      include: {
        unidade: { include: { empreendimento: true } },
        envelope: { include: { signatarios: { orderBy: { ordem: 'asc' } } } },
      },
    });
    if (!doc) throw new NotFoundException('Protocolo não encontrado');
    const informado = hash?.trim().toLowerCase();
    return {
      protocolo: doc.protocolo,
      titulo: doc.titulo,
      empreendimento: doc.unidade.empreendimento.nome,
      unidade: rotuloUnidade(doc.unidade),
      emitidoEm: doc.criadoEm,
      situacao: doc.envelope?.status ?? null,
      concluidoEm: doc.envelope?.concluidoEm ?? null,
      sha256: doc.sha256,
      sha256Assinado: doc.sha256Assinado,
      // Compara o hash do arquivo que a pessoa tem em mãos
      confere: !informado
        ? null
        : informado === doc.sha256
          ? 'ORIGINAL'
          : informado === doc.sha256Assinado
            ? 'ASSINADO'
            : 'DIFERENTE',
      signatarios: (doc.envelope?.signatarios ?? []).map((s) => ({
        parte: ROTULO_PARTE[s.parte],
        nome: nomeAbreviado(s.nome),
        status: s.status,
        assinadoEm: s.assinadoEm,
      })),
    };
  }

  // ------------------------------------------------------------------
  // rsf-signer
  // ------------------------------------------------------------------

  // Envia o termo ao rsf-signer. Chamado logo após a emissão e, se falhar,
  // de novo pelo botão "Reenviar ao rsf-signer".
  async enviarAoRsfSigner(envelopeId: string, ator: Ator) {
    const env = await this.prisma.envelope.findUnique({
      where: { id: envelopeId },
      include: {
        documento: { include: { unidade: { include: { empreendimento: true } } } },
        signatarios: { orderBy: { ordem: 'asc' } },
      },
    });
    if (!env || env.provedor !== ProvedorAssinatura.RSF_SIGNER) {
      throw new BadRequestException('Este termo não é assinado pelo rsf-signer');
    }
    if (env.status !== StatusEnvelope.PENDENTE || env.idExterno) {
      throw new BadRequestException('Este termo já foi enviado ao rsf-signer');
    }
    const { documento } = env;
    const base = { entidade: 'Envelope', entidadeId: env.id, unidadeId: documento.unidadeId, etapa: documento.etapa };
    try {
      const site = (process.env.APP_URL || '').replace(/\/$/, '');
      const externo = await this.rsfSigner.criarEnvelope({
        referencia: documento.protocolo,
        titulo: documento.titulo,
        pdf: await this.armazenamento.ler(documento.arquivo),
        sha256: documento.sha256,
        webhookUrl: `${site}/api/assinaturas/webhooks/rsf-signer`,
        metadados: {
          sistema: 'sysentrega',
          empreendimento: documento.unidade.empreendimento.codigo,
          unidade: rotuloUnidade(documento.unidade),
          etapa: documento.etapa,
        },
        signatarios: env.signatarios.map((s) => ({
          referencia: s.id,
          parte: s.parte,
          nome: s.nome,
          email: s.email,
          cpf: s.cpf,
          ordem: s.ordem,
        })),
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.envelope.update({ where: { id: env.id }, data: { idExterno: externo.id } });
        for (const s of externo.signatarios) {
          await tx.signatario.updateMany({
            where: { id: s.referencia, envelopeId: env.id },
            data: { idExterno: s.id, urlAssinatura: s.urlAssinatura },
          });
        }
        await this.auditoria.registrar(
          {
            ...base,
            acao: 'RSF_SIGNER_ENVIADO',
            descricao: `Termo ${documento.protocolo} enviado ao rsf-signer para coleta das assinaturas`,
            ator,
            dados: { idExterno: externo.id },
          },
          tx,
        );
      });
      return { ok: true };
    } catch (erro) {
      this.log.error(`Envio ao rsf-signer falhou: ${(erro as Error).message}`);
      await this.auditoria.registrar({
        ...base,
        acao: 'RSF_SIGNER_FALHA',
        descricao: `Falha ao enviar o termo ${documento.protocolo} ao rsf-signer: ${(erro as Error).message}`.slice(0, 500),
        ator,
      });
      throw erro;
    }
  }

  private atorRsfSigner(origem?: Origem): Ator {
    return { tipo: TipoAtor.INTEGRACAO, nome: 'rsf-signer', ...origem };
  }

  // Aplica aqui o que o rsf-signer diz sobre o envelope. Serve ao webhook e à
  // sincronização manual; repetir não tem efeito.
  private async aplicarSituacao(envelopeId: string, situacao: SituacaoExterna, ator: Ator) {
    const env = await this.prisma.envelope.findUniqueOrThrow({
      where: { id: envelopeId },
      include: { documento: true, signatarios: true },
    });
    await this.prisma.$transaction(
      async (tx) => {
        await this.unidades.travar(env.documento.unidadeId, tx);
        for (const externo of situacao.signatarios) {
          const local = env.signatarios.find((s) => s.id === externo.referencia);
          if (!local || local.status !== StatusSignatario.PENDENTE) continue;
          if (externo.status === 'ASSINADO') {
            await this.registrarAssinatura(
              tx,
              local.id,
              {
                metodo: MetodoAssinatura.RSF_SIGNER,
                nome: externo.nome || local.nome,
                cpf: externo.cpf,
                ip: externo.ip,
                userAgent: externo.userAgent,
                assinadoEm: externo.assinadoEm ? new Date(externo.assinadoEm) : undefined,
              },
              ator,
            );
          } else if (externo.status === 'RECUSADO') {
            await this.registrarRecusa(
              tx,
              local.id,
              externo.motivoRecusa || 'Recusado no rsf-signer',
              ator,
              externo.nome || undefined,
            );
            return;
          }
        }
        if (situacao.status === 'CANCELADO') {
          const atual = await tx.envelope.findUniqueOrThrow({
            where: { id: envelopeId },
            include: { documento: { include: { unidade: true } } },
          });
          if (atual.status === StatusEnvelope.PENDENTE) {
            await tx.envelope.update({
              where: { id: envelopeId },
              data: { status: StatusEnvelope.CANCELADO },
            });
            const { unidade } = atual.documento;
            if (
              unidade.etapa === atual.documento.etapa &&
              unidade.status === StatusUnidade.AGUARDANDO_ASSINATURA
            ) {
              await this.unidades.mudarEstado(
                tx,
                unidade,
                { status: statusAposLiberacao(unidade.etapa) },
                {
                  acao: 'TERMO_ANULADO',
                  descricao: `Termo ${atual.documento.protocolo} cancelado no rsf-signer`,
                  ator,
                  entidade: 'Envelope',
                  entidadeId: envelopeId,
                },
              );
            }
          }
        }
      },
      { timeout: 30000 },
    );
    await this.guardarAssinadoDoRsfSigner(envelopeId);
  }

  // Concluído lá: guarda aqui o PDF assinado que o rsf-signer produziu
  private async guardarAssinadoDoRsfSigner(envelopeId: string) {
    const env = await this.prisma.envelope.findUnique({
      where: { id: envelopeId },
      include: { documento: true },
    });
    if (!env || env.status !== StatusEnvelope.CONCLUIDO || !env.idExterno) return;
    try {
      const pdf = await this.rsfSigner.baixarAssinado(env.idExterno);
      if (!pdf) return;
      const hash = sha256(pdf);
      if (hash === env.documento.sha256Assinado) return;
      const arquivoAssinado = await this.armazenamento.salvar('termos', 'pdf', pdf);
      await this.prisma.$transaction(async (tx) => {
        await tx.documento.update({
          where: { id: env.documentoId },
          data: { arquivoAssinado, sha256Assinado: hash },
        });
        await this.auditoria.registrar(
          {
            acao: 'DOCUMENTO_ASSINADO_RECEBIDO',
            descricao: `PDF assinado do termo ${env.documento.protocolo} recebido do rsf-signer`,
            entidade: 'Documento',
            entidadeId: env.documentoId,
            unidadeId: env.documento.unidadeId,
            etapa: env.documento.etapa,
            ator: this.atorRsfSigner(),
            dados: { sha256Assinado: hash },
          },
          tx,
        );
      });
    } catch (erro) {
      this.log.warn(`PDF assinado do rsf-signer indisponível: ${(erro as Error).message}`);
    }
  }

  private async envelopeExterno(idExterno: string) {
    const env = await this.prisma.envelope.findFirst({
      where: { provedor: ProvedorAssinatura.RSF_SIGNER, idExterno },
    });
    if (!env) throw new NotFoundException('Envelope desconhecido');
    return env;
  }

  async receberWebhookRsfSigner(evento: EventoRsfSigner, origem: Origem) {
    if (!evento?.envelopeId || !evento.evento) {
      throw new BadRequestException('Evento inválido');
    }
    const env = await this.envelopeExterno(String(evento.envelopeId));
    const ator = this.atorRsfSigner(origem);
    let situacao: SituacaoExterna;
    switch (evento.evento) {
      case 'signatario.assinou':
      case 'signatario.recusou':
        if (!evento.signatario?.referencia) throw new BadRequestException('Signatário não informado');
        situacao = {
          status: 'PENDENTE',
          signatarios: [
            {
              referencia: String(evento.signatario.referencia),
              status: evento.evento === 'signatario.assinou' ? 'ASSINADO' : 'RECUSADO',
              nome: evento.signatario.nome,
              cpf: evento.signatario.cpf,
              assinadoEm: evento.signatario.assinadoEm ?? evento.ocorridoEm,
              ip: evento.signatario.ip,
              userAgent: evento.signatario.userAgent,
              motivoRecusa: evento.signatario.motivo,
            },
          ],
        };
        break;
      case 'envelope.cancelado':
        situacao = { status: 'CANCELADO', signatarios: [] };
        break;
      case 'envelope.concluido':
        // Busca a situação completa: cobre avisos de assinatura que se perderam
        situacao = await this.rsfSigner.consultar(env.idExterno!);
        break;
      default:
        return { ok: true, ignorado: true };
    }
    await this.aplicarSituacao(env.id, situacao, ator);
    return { ok: true };
  }

  // Para quando um webhook não chegou: pergunta ao rsf-signer como está
  async sincronizar(envelopeId: string, ctx: Contexto) {
    const env = await this.prisma.envelope.findUnique({
      where: { id: envelopeId },
      include: { documento: true },
    });
    if (!env) throw new NotFoundException('Termo não encontrado');
    await this.unidades.obter(env.documento.unidadeId, ctx.usuario);
    if (env.provedor !== ProvedorAssinatura.RSF_SIGNER || !env.idExterno) {
      throw new BadRequestException('Este termo não está no rsf-signer');
    }
    const situacao = await this.rsfSigner.consultar(env.idExterno);
    await this.aplicarSituacao(env.id, situacao, this.atorRsfSigner());
    return { ok: true, status: situacao.status };
  }

  async reenviar(envelopeId: string, ctx: Contexto) {
    const env = await this.prisma.envelope.findUnique({
      where: { id: envelopeId },
      include: { documento: true },
    });
    if (!env) throw new NotFoundException('Termo não encontrado');
    await this.unidades.obter(env.documento.unidadeId, ctx.usuario);
    this.unidades.exigir(regras.podeConduzirVistoria(ctx.usuario, env.documento.etapa));
    return this.enviarAoRsfSigner(envelopeId, ctx.ator);
  }
}
