import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Contexto, Ctx, Origem } from '../comum/contexto';
import { AssinaturasService } from './assinaturas.service';
import { RsfSignerProvedor } from './rsf-signer.provedor';

class AssinarBody {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  senha: string;

  @IsOptional() @IsString() @MaxLength(400000) assinaturaImagem?: string;
  @IsOptional() @IsString() @MaxLength(80) localizacao?: string;
}

export class MotivoBody {
  @IsString()
  @MinLength(5, { message: 'Descreva o motivo (mínimo de 5 caracteres)' })
  @MaxLength(1000)
  motivo: string;
}

export function enviarPdf(res: Response, nome: string, pdf: Buffer) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${nome}"`,
    'Content-Length': String(pdf.length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(pdf);
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AssinaturasController {
  constructor(private assinaturas: AssinaturasService) {}

  @Get('documentos/:id/pdf')
  async pdf(
    @Param('id') id: string,
    @Query('versao') versao: string,
    @Ctx() ctx: Contexto,
    @Res() res: Response,
  ) {
    const { nome, pdf } = await this.assinaturas.baixar(
      id,
      versao === 'assinado' ? 'assinado' : 'original',
      ctx,
    );
    enviarPdf(res, nome, pdf);
  }

  @Post('signatarios/:id/assinar')
  @HttpCode(200)
  assinar(@Param('id') id: string, @Body() dto: AssinarBody, @Ctx() ctx: Contexto) {
    return this.assinaturas.assinarComoUsuario(id, dto, ctx);
  }

  @Post('signatarios/:id/recusar')
  @HttpCode(200)
  recusar(@Param('id') id: string, @Body() dto: MotivoBody, @Ctx() ctx: Contexto) {
    return this.assinaturas.recusarComoUsuario(id, dto.motivo, ctx);
  }

  @Post('envelopes/:id/cancelar')
  @HttpCode(200)
  cancelar(@Param('id') id: string, @Body() dto: MotivoBody, @Ctx() ctx: Contexto) {
    return this.assinaturas.cancelarEnvelope(id, dto.motivo, ctx);
  }

  @Post('envelopes/:id/reenviar')
  @HttpCode(200)
  reenviar(@Param('id') id: string, @Ctx() ctx: Contexto) {
    return this.assinaturas.reenviar(id, ctx);
  }

  @Post('envelopes/:id/sincronizar')
  @HttpCode(200)
  sincronizar(@Param('id') id: string, @Ctx() ctx: Contexto) {
    return this.assinaturas.sincronizar(id, ctx);
  }
}

// Avisos do rsf-signer. Sem login: quem prova a origem é o HMAC do corpo,
// feito com o segredo combinado entre os dois sistemas.
@Controller('assinaturas/webhooks')
export class WebhooksController {
  constructor(
    private assinaturas: AssinaturasService,
    private rsfSigner: RsfSignerProvedor,
  ) {}

  @Post('rsf-signer')
  @HttpCode(200)
  async rsf(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-rsf-signature') assinatura: string | undefined,
    @Origem() origem: { ip: string | null; userAgent: string | null },
  ) {
    if (!process.env.RSF_SIGNER_WEBHOOK_SECRET) {
      throw new ServiceUnavailableException('Webhook do rsf-signer não configurado');
    }
    if (!req.rawBody || !this.rsfSigner.assinaturaDoWebhookConfere(req.rawBody, assinatura)) {
      throw new ForbiddenException('Assinatura do webhook inválida');
    }
    return this.assinaturas.receberWebhookRsfSigner(req.body, origem);
  }
}
