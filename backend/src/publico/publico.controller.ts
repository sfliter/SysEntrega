import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AgendamentosService } from '../agendamentos/agendamentos.service';
import { enviarPdf, MotivoBody } from '../assinaturas/assinaturas.controller';
import { AssinaturasService } from '../assinaturas/assinaturas.service';
import { Origem } from '../comum/contexto';

type OrigemReq = { ip: string | null; userAgent: string | null };

class EscolherHorarioBody {
  @IsString() opcaoId: string;
}

class AssinarPublicoBody {
  @Matches(/^\d{6}$/, { message: 'O código tem 6 dígitos' })
  codigo: string;

  @IsOptional() @IsString() @MaxLength(400000) assinaturaImagem?: string;
  @IsOptional() @IsString() @MaxLength(80) localizacao?: string;
}

// Rotas sem login. O cliente final não tem usuário: ele chega por um link
// com token de uso restrito (um por agendamento, um por assinatura). O token
// tem 256 bits aleatórios; a assinatura ainda exige o código de uso único.
@Controller('publico')
export class PublicoController {
  constructor(
    private agendamentos: AgendamentosService,
    private assinaturas: AssinaturasService,
  ) {}

  // ---------- agendamento ----------

  @Get('agendamento/:token')
  agendamento(@Param('token') token: string) {
    return this.agendamentos.publicoObter(token);
  }

  @Post('agendamento/:token/confirmar')
  @HttpCode(200)
  confirmar(
    @Param('token') token: string,
    @Body() dto: EscolherHorarioBody,
    @Origem() origem: OrigemReq,
  ) {
    return this.agendamentos.publicoConfirmar(token, dto.opcaoId, origem);
  }

  @Post('agendamento/:token/recusar')
  @HttpCode(200)
  recusarHorarios(
    @Param('token') token: string,
    @Body() dto: MotivoBody,
    @Origem() origem: OrigemReq,
  ) {
    return this.agendamentos.publicoRecusar(token, dto.motivo, origem);
  }

  // ---------- assinatura ----------

  @Get('assinatura/:token')
  assinatura(@Param('token') token: string) {
    return this.assinaturas.publicoObter(token);
  }

  @Get('assinatura/:token/documento')
  async documento(
    @Param('token') token: string,
    @Origem() origem: OrigemReq,
    @Res() res: Response,
  ) {
    const { nome, pdf } = await this.assinaturas.publicoDocumento(token, origem);
    enviarPdf(res, nome, pdf);
  }

  @Post('assinatura/:token/codigo')
  @HttpCode(200)
  codigo(@Param('token') token: string, @Origem() origem: OrigemReq) {
    return this.assinaturas.publicoEnviarCodigo(token, origem);
  }

  @Post('assinatura/:token/assinar')
  @HttpCode(200)
  assinar(
    @Param('token') token: string,
    @Body() dto: AssinarPublicoBody,
    @Origem() origem: OrigemReq,
  ) {
    return this.assinaturas.publicoAssinar(token, dto, origem);
  }

  @Post('assinatura/:token/recusar')
  @HttpCode(200)
  recusar(
    @Param('token') token: string,
    @Body() dto: MotivoBody,
    @Origem() origem: OrigemReq,
  ) {
    return this.assinaturas.publicoRecusar(token, dto.motivo, origem);
  }

  // ---------- conferência do termo ----------

  @Get('verificar/:protocolo')
  verificar(@Param('protocolo') protocolo: string, @Query('hash') hash?: string) {
    return this.assinaturas.publicoVerificar(protocolo, hash);
  }
}
