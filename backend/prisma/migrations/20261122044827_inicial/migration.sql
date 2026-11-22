-- CreateEnum
CREATE TYPE "Perfil" AS ENUM ('ADMINISTRADOR', 'CONSTRUTORA', 'INCORPORADORA', 'RELACIONAMENTO', 'AUDITOR');

-- CreateEnum
CREATE TYPE "TipoOrganizacao" AS ENUM ('CONSTRUTORA', 'INCORPORADORA', 'CENTRAL_RELACIONAMENTO');

-- CreateEnum
CREATE TYPE "Etapa" AS ENUM ('CONSTRUTORA_INCORPORADORA', 'INCORPORADORA_RELACIONAMENTO', 'RELACIONAMENTO_CLIENTE');

-- CreateEnum
CREATE TYPE "StatusUnidade" AS ENUM ('AGUARDANDO_LIBERACAO', 'AGUARDANDO_AGENDAMENTO', 'VISTORIA_AGENDADA', 'AGUARDANDO_CONFERENCIA', 'EM_VISTORIA', 'COM_PENDENCIAS', 'AGUARDANDO_ASSINATURA', 'ENTREGUE');

-- CreateEnum
CREATE TYPE "StatusAgendamento" AS ENUM ('PROPOSTO', 'CONFIRMADO', 'CANCELADO', 'REALIZADO');

-- CreateEnum
CREATE TYPE "StatusVistoria" AS ENUM ('EM_ANDAMENTO', 'CONCLUIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "ResultadoVistoria" AS ENUM ('APROVADA', 'APROVADA_COM_RESSALVAS', 'REPROVADA');

-- CreateEnum
CREATE TYPE "ResultadoItem" AS ENUM ('CONFORME', 'RESSALVA', 'NAO_CONFORME', 'NAO_SE_APLICA');

-- CreateEnum
CREATE TYPE "StatusPendencia" AS ENUM ('ABERTA', 'RESOLVIDA');

-- CreateEnum
CREATE TYPE "TipoDocumento" AS ENUM ('TERMO_RECEBIMENTO', 'TERMO_REPASSE', 'TERMO_ENTREGA');

-- CreateEnum
CREATE TYPE "ProvedorAssinatura" AS ENUM ('INTERNO', 'RSF_SIGNER');

-- CreateEnum
CREATE TYPE "StatusEnvelope" AS ENUM ('PENDENTE', 'CONCLUIDO', 'RECUSADO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "ParteSignataria" AS ENUM ('CONSTRUTORA', 'INCORPORADORA', 'RELACIONAMENTO', 'CLIENTE');

-- CreateEnum
CREATE TYPE "StatusSignatario" AS ENUM ('PENDENTE', 'ASSINADO', 'RECUSADO');

-- CreateEnum
CREATE TYPE "MetodoAssinatura" AS ENUM ('SESSAO_AUTENTICADA', 'CODIGO_USO_UNICO', 'RSF_SIGNER');

-- CreateEnum
CREATE TYPE "TipoAtor" AS ENUM ('USUARIO', 'CLIENTE', 'SISTEMA', 'INTEGRACAO');

-- CreateTable
CREATE TABLE "Organizacao" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cnpj" TEXT,
    "tipo" "TipoOrganizacao" NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organizacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cpf" TEXT,
    "senhaHash" TEXT NOT NULL,
    "perfil" "Perfil" NOT NULL,
    "organizacaoId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Empreendimento" (
    "id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "endereco" TEXT,
    "construtoraId" TEXT NOT NULL,
    "incorporadoraId" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Empreendimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cliente" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cpfCnpj" TEXT NOT NULL,
    "email" TEXT,
    "telefone" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unidade" (
    "id" TEXT NOT NULL,
    "empreendimentoId" TEXT NOT NULL,
    "bloco" TEXT NOT NULL DEFAULT '',
    "numero" TEXT NOT NULL,
    "andar" TEXT,
    "tipologia" TEXT,
    "clienteId" TEXT,
    "etapa" "Etapa" NOT NULL DEFAULT 'CONSTRUTORA_INCORPORADORA',
    "status" "StatusUnidade" NOT NULL DEFAULT 'AGUARDANDO_LIBERACAO',
    "liberadaPorId" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agendamento" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "etapa" "Etapa" NOT NULL,
    "status" "StatusAgendamento" NOT NULL DEFAULT 'PROPOSTO',
    "dataHora" TIMESTAMP(3),
    "local" TEXT,
    "observacao" TEXT,
    "propostoPorId" TEXT NOT NULL,
    "propostoPorPerfil" "Perfil" NOT NULL,
    "confirmadoPorId" TEXT,
    "confirmadoPeloCliente" BOOLEAN NOT NULL DEFAULT false,
    "confirmadoEm" TIMESTAMP(3),
    "motivoCancelamento" TEXT,
    "canceladoEm" TIMESTAMP(3),
    "tokenCliente" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agendamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpcaoHorario" (
    "id" TEXT NOT NULL,
    "agendamentoId" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "escolhida" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OpcaoHorario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModeloItem" (
    "id" TEXT NOT NULL,
    "etapa" "Etapa" NOT NULL,
    "ambiente" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ModeloItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vistoria" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "etapa" "Etapa" NOT NULL,
    "agendamentoId" TEXT,
    "status" "StatusVistoria" NOT NULL DEFAULT 'EM_ANDAMENTO',
    "resultado" "ResultadoVistoria",
    "vistoriadorId" TEXT NOT NULL,
    "vistoriadorNome" TEXT NOT NULL,
    "acompanhante" TEXT,
    "observacoes" TEXT,
    "iniciadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" TIMESTAMP(3),

    CONSTRAINT "Vistoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VistoriaItem" (
    "id" TEXT NOT NULL,
    "vistoriaId" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "resultado" "ResultadoItem",
    "observacao" TEXT,

    CONSTRAINT "VistoriaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Foto" (
    "id" TEXT NOT NULL,
    "vistoriaItemId" TEXT NOT NULL,
    "arquivo" TEXT NOT NULL,
    "nomeOriginal" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "enviadaPorId" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Foto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pendencia" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "etapa" "Etapa" NOT NULL,
    "vistoriaId" TEXT,
    "vistoriaItemId" TEXT,
    "descricao" TEXT NOT NULL,
    "status" "StatusPendencia" NOT NULL DEFAULT 'ABERTA',
    "resolucao" TEXT,
    "resolvidaPorId" TEXT,
    "resolvidaPorNome" TEXT,
    "resolvidaEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pendencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Documento" (
    "id" TEXT NOT NULL,
    "unidadeId" TEXT NOT NULL,
    "etapa" "Etapa" NOT NULL,
    "vistoriaId" TEXT,
    "tipo" "TipoDocumento" NOT NULL,
    "protocolo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "conteudo" JSONB NOT NULL,
    "arquivo" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "arquivoAssinado" TEXT,
    "sha256Assinado" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Envelope" (
    "id" TEXT NOT NULL,
    "documentoId" TEXT NOT NULL,
    "provedor" "ProvedorAssinatura" NOT NULL DEFAULT 'INTERNO',
    "idExterno" TEXT,
    "status" "StatusEnvelope" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "Envelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signatario" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "parte" "ParteSignataria" NOT NULL,
    "ordem" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "cpf" TEXT,
    "email" TEXT,
    "usuarioId" TEXT,
    "clienteId" TEXT,
    "status" "StatusSignatario" NOT NULL DEFAULT 'PENDENTE',
    "metodo" "MetodoAssinatura",
    "assinadoEm" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "localizacao" TEXT,
    "assinaturaImagem" TEXT,
    "motivoRecusa" TEXT,
    "token" TEXT,
    "codigoHash" TEXT,
    "codigoExpiraEm" TIMESTAMP(3),
    "codigoTentativas" INTEGER NOT NULL DEFAULT 0,
    "codigoEnviadoEm" TIMESTAMP(3),
    "codigoCanal" TEXT,
    "idExterno" TEXT,
    "urlAssinatura" TEXT,

    CONSTRAINT "Signatario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "seq" SERIAL NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL,
    "acao" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT,
    "unidadeId" TEXT,
    "etapa" "Etapa",
    "atorTipo" "TipoAtor" NOT NULL,
    "atorId" TEXT,
    "atorNome" TEXT NOT NULL,
    "atorPerfil" TEXT,
    "organizacao" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "statusAnterior" TEXT,
    "statusNovo" TEXT,
    "dados" JSONB,
    "hashAnterior" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("seq")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Empreendimento_codigo_key" ON "Empreendimento"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_cpfCnpj_key" ON "Cliente"("cpfCnpj");

-- CreateIndex
CREATE INDEX "Unidade_etapa_status_idx" ON "Unidade"("etapa", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Unidade_empreendimentoId_bloco_numero_key" ON "Unidade"("empreendimentoId", "bloco", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "Agendamento_tokenCliente_key" ON "Agendamento"("tokenCliente");

-- CreateIndex
CREATE INDEX "Agendamento_status_dataHora_idx" ON "Agendamento"("status", "dataHora");

-- CreateIndex
CREATE INDEX "ModeloItem_etapa_ordem_idx" ON "ModeloItem"("etapa", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "Documento_protocolo_key" ON "Documento"("protocolo");

-- CreateIndex
CREATE UNIQUE INDEX "Envelope_documentoId_key" ON "Envelope"("documentoId");

-- CreateIndex
CREATE INDEX "Envelope_provedor_idExterno_idx" ON "Envelope"("provedor", "idExterno");

-- CreateIndex
CREATE UNIQUE INDEX "Signatario_token_key" ON "Signatario"("token");

-- CreateIndex
CREATE INDEX "EventoAuditoria_unidadeId_seq_idx" ON "EventoAuditoria"("unidadeId", "seq");

-- CreateIndex
CREATE INDEX "EventoAuditoria_acao_idx" ON "EventoAuditoria"("acao");

-- CreateIndex
CREATE INDEX "EventoAuditoria_criadoEm_idx" ON "EventoAuditoria"("criadoEm");

-- AddForeignKey
ALTER TABLE "Usuario" ADD CONSTRAINT "Usuario_organizacaoId_fkey" FOREIGN KEY ("organizacaoId") REFERENCES "Organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empreendimento" ADD CONSTRAINT "Empreendimento_construtoraId_fkey" FOREIGN KEY ("construtoraId") REFERENCES "Organizacao"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Empreendimento" ADD CONSTRAINT "Empreendimento_incorporadoraId_fkey" FOREIGN KEY ("incorporadoraId") REFERENCES "Organizacao"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unidade" ADD CONSTRAINT "Unidade_empreendimentoId_fkey" FOREIGN KEY ("empreendimentoId") REFERENCES "Empreendimento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unidade" ADD CONSTRAINT "Unidade_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agendamento" ADD CONSTRAINT "Agendamento_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpcaoHorario" ADD CONSTRAINT "OpcaoHorario_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "Agendamento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vistoria" ADD CONSTRAINT "Vistoria_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vistoria" ADD CONSTRAINT "Vistoria_agendamentoId_fkey" FOREIGN KEY ("agendamentoId") REFERENCES "Agendamento"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VistoriaItem" ADD CONSTRAINT "VistoriaItem_vistoriaId_fkey" FOREIGN KEY ("vistoriaId") REFERENCES "Vistoria"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_vistoriaItemId_fkey" FOREIGN KEY ("vistoriaItemId") REFERENCES "VistoriaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pendencia" ADD CONSTRAINT "Pendencia_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pendencia" ADD CONSTRAINT "Pendencia_vistoriaId_fkey" FOREIGN KEY ("vistoriaId") REFERENCES "Vistoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pendencia" ADD CONSTRAINT "Pendencia_vistoriaItemId_fkey" FOREIGN KEY ("vistoriaItemId") REFERENCES "VistoriaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_unidadeId_fkey" FOREIGN KEY ("unidadeId") REFERENCES "Unidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_vistoriaId_fkey" FOREIGN KEY ("vistoriaId") REFERENCES "Vistoria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Envelope" ADD CONSTRAINT "Envelope_documentoId_fkey" FOREIGN KEY ("documentoId") REFERENCES "Documento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signatario" ADD CONSTRAINT "Signatario_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "Envelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trilha de auditoria imutável: o banco recusa qualquer alteração ou
-- exclusão, venha de onde vier (inclusive da própria aplicação).
CREATE OR REPLACE FUNCTION auditoria_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'A trilha de auditoria e imutavel: % nao e permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evento_auditoria_sem_alteracao
  BEFORE UPDATE OR DELETE ON "EventoAuditoria"
  FOR EACH ROW EXECUTE FUNCTION auditoria_imutavel();

CREATE TRIGGER evento_auditoria_sem_truncate
  BEFORE TRUNCATE ON "EventoAuditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION auditoria_imutavel();
