// Contrato entre o SysEntrega e quem colhe as assinaturas.
//
// Hoje há duas implementações:
//   - INTERNO     — o próprio SysEntrega colhe (senha do usuário logado ou
//                   código de uso único para o cliente). Não chama ninguém.
//   - RSF_SIGNER  — o termo é enviado ao rsf-signer, que colhe as assinaturas
//                   e avisa o resultado por webhook.
//
// O resto do sistema só conhece AssinaturasService.registrarAssinatura /
// registrarRecusa: tanto faz de onde a assinatura veio.

export interface NovoEnvelopeExterno {
  referencia: string; // protocolo do termo
  titulo: string;
  pdf: Buffer;
  sha256: string;
  webhookUrl: string;
  metadados: Record<string, string>;
  signatarios: {
    referencia: string; // id do signatário no SysEntrega
    parte: string;
    nome: string;
    email: string | null;
    cpf: string | null;
    ordem: number;
  }[];
}

export interface EnvelopeExterno {
  id: string;
  signatarios: { referencia: string; id: string; urlAssinatura: string | null }[];
}

export interface SituacaoExterna {
  status: 'PENDENTE' | 'CONCLUIDO' | 'RECUSADO' | 'CANCELADO';
  signatarios: {
    referencia: string;
    status: 'PENDENTE' | 'ASSINADO' | 'RECUSADO';
    nome?: string | null;
    cpf?: string | null;
    assinadoEm?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    motivoRecusa?: string | null;
  }[];
}

export interface ProvedorExterno {
  criarEnvelope(dados: NovoEnvelopeExterno): Promise<EnvelopeExterno>;
  consultar(idExterno: string): Promise<SituacaoExterna>;
  cancelar(idExterno: string, motivo: string): Promise<void>;
  baixarAssinado(idExterno: string): Promise<Buffer | null>;
}
