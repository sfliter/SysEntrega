import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ResultadoItem } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { MotivoBody } from '../assinaturas/assinaturas.controller';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Contexto, Ctx } from '../comum/contexto';
import { VistoriasService } from './vistorias.service';

class ItemBody {
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsEnum(ResultadoItem)
  resultado?: ResultadoItem | null;

  @IsOptional() @IsString() @MaxLength(2000) observacao?: string;
}

class ConcluirBody {
  @IsOptional() @IsString() @MaxLength(4000) observacoes?: string;
  @IsOptional() @IsString() @MaxLength(160) acompanhante?: string;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class VistoriasController {
  constructor(private vistorias: VistoriasService) {}

  @Post('unidades/:id/vistorias')
  iniciar(@Param('id') id: string, @Ctx() ctx: Contexto) {
    return this.vistorias.iniciar(id, ctx);
  }

  @Get('vistorias/:id')
  obter(@Param('id') id: string, @Ctx() ctx: Contexto) {
    return this.vistorias.obter(id, ctx.usuario);
  }

  @Patch('vistorias/:id/itens/:itemId')
  marcar(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: ItemBody,
    @Ctx() ctx: Contexto,
  ) {
    return this.vistorias.marcarItem(id, itemId, dto, ctx);
  }

  // As fotos chegam já reduzidas pelo navegador; o limite aqui é a rede de
  // segurança (8 MB por foto, 6 por envio), com o arquivo em memória.
  @Post('vistorias/:id/itens/:itemId/fotos')
  @UseInterceptors(
    FilesInterceptor('fotos', 6, { limits: { fileSize: 8 * 1024 * 1024 } }),
  )
  fotos(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @UploadedFiles() arquivos: Express.Multer.File[],
    @Ctx() ctx: Contexto,
  ) {
    return this.vistorias.adicionarFotos(id, itemId, arquivos, ctx);
  }

  @Get('fotos/:id')
  async foto(@Param('id') id: string, @Ctx() ctx: Contexto, @Res() res: Response) {
    const { mime, conteudo } = await this.vistorias.lerFoto(id, ctx.usuario);
    res.set({
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(conteudo);
  }

  @Delete('fotos/:id')
  removerFoto(@Param('id') id: string, @Ctx() ctx: Contexto) {
    return this.vistorias.removerFoto(id, ctx);
  }

  @Post('vistorias/:id/concluir')
  @HttpCode(200)
  concluir(@Param('id') id: string, @Body() dto: ConcluirBody, @Ctx() ctx: Contexto) {
    return this.vistorias.concluir(id, dto, ctx);
  }

  @Post('vistorias/:id/cancelar')
  @HttpCode(200)
  cancelar(@Param('id') id: string, @Body() dto: MotivoBody, @Ctx() ctx: Contexto) {
    return this.vistorias.cancelar(id, dto.motivo, ctx);
  }
}
