import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  EnvelopeExterno,
  NovoEnvelopeExterno,
  ProvedorExterno,
  SituacaoExterna,
} from './provedor';

// Adaptador do rsf-signer.
//
// ATENÇÃO: o rsf-signer ainda não tem API publicada. Este adaptador segue o
// contrato proposto em docs/integracao-rsf-signer.md. Quando a API real
// existir, é AQUI (e só aqui) que se ajustam rotas, nomes de campos e o
// formato do webhook — o restante do sistema não muda.
//
// Configuração: RSF_SIGNER_URL, RSF_SIGNER_API_KEY, RSF_SIGNER_WEBHOOK_SECRET.

export interface EventoRsfSigner {
  evento:
    | 'signatario.assinou'
    | 'signatario.recusou'
    | 'envelope.concluido'
    | 'envelope.cancelado';
  envelopeId: string;
  referencia?: string;
  ocorridoEm?: string;
  signatario?: {
    referencia: string;
    nome?: string | null;
    cpf?: string | null;
    assinadoEm?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    motivo?: string | null;
  };
  motivo?: string | null;
}

@Injectable()
export class RsfSignerProvedor implements ProvedorExterno {
  configurado(): boolean {
    return !!(process.env.RSF_SIGNER_URL && process.env.RSF_SIGNER_API_KEY);
  }

  private async chamar(metodo: string, caminho: string, corpo?: unknown) {
    if (!this.configurado()) {
      throw new ServiceUnavailableException(
        'Integração com o rsf-signer não configurada (RSF_SIGNER_URL / RSF_SIGNER_API_KEY)',
      );
    }
    const base = process.env.RSF_SIGNER_URL!.replace(/\/$/, '');
    let resposta: Response;
    try {
      resposta = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${process.env.RSF_SIGNER_API_KEY}`,
          Accept: 'application/json, application/pdf',
          ...(corpo ? { 'Content-Type': 'application/json' } : {}),
        },
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: AbortSignal.timeout(Number(process.env.RSF_SIGNER_TIMEOUT_MS) || 20000),
      });
    } catch (erro) {
      throw new ServiceUnavailableException(
        `rsf-signer inacessível: ${(erro as Error).message}`,
      );
    }
    if (!resposta.ok) {
      const detalhe = (await resposta.text().catch(() => '')).slice(0, 300);
      throw new ServiceUnavailableException(
        `rsf-signer respondeu ${resposta.status} em ${metodo} ${caminho}: ${detalhe}`,
      );
    }
    return resposta;
  }

  async criarEnvelope(dados: NovoEnvelopeExterno): Promise<EnvelopeExterno> {
    const resposta = await this.chamar('POST', '/api/v1/envelopes', {
      referencia: dados.referencia,
      titulo: dados.titulo,
      documento: {
        nome: `${dados.referencia}.pdf`,
        conteudoBase64: dados.pdf.toString('base64'),
        sha256: dados.sha256,
      },
      signatarios: dados.signatarios,
      webhookUrl: dados.webhookUrl,
      metadados: dados.metadados,
    });
    const corpo = (await resposta.json()) as any;
    if (!corpo?.id) {
      throw new ServiceUnavailableException('rsf-signer não devolveu o id do envelope');
    }
    return {
      id: String(corpo.id),
      signatarios: (corpo.signatarios ?? []).map((s: any) => ({
        referencia: String(s.referencia),
        id: String(s.id),
        urlAssinatura: s.urlAssinatura ?? null,
      })),
    };
  }

  async consultar(idExterno: string): Promise<SituacaoExterna> {
    const resposta = await this.chamar(
      'GET',
      `/api/v1/envelopes/${encodeURIComponent(idExterno)}`,
    );
    const corpo = (await resposta.json()) as any;
    return {
      status: corpo.status,
      signatarios: (corpo.signatarios ?? []).map((s: any) => ({
        referencia: String(s.referencia),
        status: s.status,
        nome: s.nome ?? null,
        cpf: s.cpf ?? null,
        assinadoEm: s.assinadoEm ?? null,
        ip: s.ip ?? null,
        userAgent: s.userAgent ?? null,
        motivoRecusa: s.motivoRecusa ?? null,
      })),
    };
  }

  async cancelar(idExterno: string, motivo: string): Promise<void> {
    await this.chamar(
      'POST',
      `/api/v1/envelopes/${encodeURIComponent(idExterno)}/cancelar`,
      { motivo },
    );
  }

  async baixarAssinado(idExterno: string): Promise<Buffer | null> {
    const resposta = await this.chamar(
      'GET',
      `/api/v1/envelopes/${encodeURIComponent(idExterno)}/documento-assinado`,
    );
    const pdf = Buffer.from(await resposta.arrayBuffer());
    // Só aceita o que de fato é um PDF
    return pdf.subarray(0, 5).toString('latin1') === '%PDF-' ? pdf : null;
  }

  // Confere o cabeçalho X-RSF-Signature: "sha256=<hmac hex do corpo bruto>"
  assinaturaDoWebhookConfere(corpoBruto: Buffer, cabecalho: string | undefined): boolean {
    const segredo = process.env.RSF_SIGNER_WEBHOOK_SECRET;
    if (!segredo || !cabecalho) return false;
    const recebido = Buffer.from(cabecalho.replace(/^sha256=/, ''), 'hex');
    const esperado = createHmac('sha256', segredo).update(corpoBruto).digest();
    return recebido.length === esperado.length && timingSafeEqual(recebido, esperado);
  }
}
