import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

// Envio de e-mails ao cliente: o código de uso único e o link de assinatura.
//
// Sem SMTP configurado o sistema RECUSA o envio do código, em vez de fingir
// que mandou. Para ensaiar o fluxo antes de o e-mail estar liberado,
// CODIGO_NO_LOG=1 escreve o código no log do servidor — assinatura colhida
// assim não tem valor (o titular não recebeu nada) e isso fica na auditoria.
@Injectable()
export class EnvioService {
  private log = new Logger('Envio');
  private transporte?: nodemailer.Transporter;

  emailConfigurado(): boolean {
    return !!process.env.SMTP_HOST;
  }

  modoEnsaio(): boolean {
    return !this.emailConfigurado() && process.env.CODIGO_NO_LOG === '1';
  }

  private async enviar(para: string, assunto: string, texto: string) {
    this.transporte ??= nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === '1',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    await this.transporte.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: para,
      subject: assunto,
      text: texto,
    });
  }

  // Devolve se o envio foi de verdade ou só um ensaio
  async enviarCodigo(
    email: string,
    codigo: string,
    info: { protocolo: string; minutos: number },
  ): Promise<{ ensaio: boolean }> {
    if (this.emailConfigurado()) {
      try {
        await this.enviar(
          email,
          `Código de assinatura — termo ${info.protocolo}`,
          `Seu código para assinar o termo ${info.protocolo} é:\n\n    ${codigo}\n\n` +
            `Ele vale por ${info.minutos} minutos e só pode ser usado uma vez. ` +
            `Não compartilhe este código com ninguém além de quem está conduzindo a sua assinatura.\n\n` +
            `Se você não solicitou este código, ignore este e-mail.\n\nRSF · SysEntrega`,
        );
      } catch (erro) {
        this.log.error(`Falha ao enviar o código: ${(erro as Error).message}`);
        throw new ServiceUnavailableException(
          'Não foi possível enviar o código por e-mail agora. Tente novamente em instantes.',
        );
      }
      return { ensaio: false };
    }
    if (this.modoEnsaio()) {
      this.log.warn(
        `[ENSAIO — SEM VALOR DE ASSINATURA] código do termo ${info.protocolo}: ${codigo}`,
      );
      return { ensaio: true };
    }
    throw new ServiceUnavailableException(
      'O envio de e-mail não está configurado (SMTP). Sem ele o código de assinatura não chega ao titular.',
    );
  }

  // Melhor esforço: se o e-mail não sair, o Relacionamento ainda tem o link
  async enviarLink(email: string, assunto: string, texto: string): Promise<boolean> {
    if (!this.emailConfigurado()) return false;
    try {
      await this.enviar(email, assunto, texto);
      return true;
    } catch (erro) {
      this.log.error(`Falha ao enviar link: ${(erro as Error).message}`);
      return false;
    }
  }
}
