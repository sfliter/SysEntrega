import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Etapa, StatusUnidade } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Contexto, Ctx } from '../comum/contexto';
import { UnidadesService } from './unidades.service';

class CriarUnidadesDto {
  @IsString()
  empreendimentoId: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  bloco?: string;

  // Uma ou várias de uma vez: ["101", "102", "103"]
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MaxLength(20, { each: true })
  numeros: string[];

  @IsOptional()
  @IsString()
  @MaxLength(20)
  andar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tipologia?: string;
}

class AtualizarUnidadeDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  andar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tipologia?: string;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  clienteId?: string | null;
}

class FiltroUnidadesDto {
  @IsOptional() @IsString() empreendimentoId?: string;
  @IsOptional() @IsEnum(Etapa) etapa?: Etapa;
  @IsOptional() @IsEnum(StatusUnidade) status?: StatusUnidade;
  @IsOptional() @IsString() @MaxLength(80) busca?: string;
}

class ObservacaoDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacao?: string;
}

class ResolverPendenciaDto {
  @IsString()
  @MinLength(5, { message: 'Descreva o que foi feito (mínimo de 5 caracteres)' })
  @MaxLength(2000)
  resolucao: string;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class UnidadesController {
  constructor(private unidades: UnidadesService) {}

  @Get('unidades')
  listar(@Query() f: FiltroUnidadesDto, @Ctx() ctx: Contexto) {
    return this.unidades.listar(ctx.usuario, f);
  }

  @Post('unidades')
  criar(@Body() dto: CriarUnidadesDto, @Ctx() ctx: Contexto) {
    return this.unidades.criar(dto, ctx);
  }

  @Get('unidades/:id')
  detalhe(@Param('id') id: string, @Ctx() ctx: Contexto) {
    return this.unidades.detalhe(id, ctx.usuario);
  }

  @Patch('unidades/:id')
  atualizar(
    @Param('id') id: string,
    @Body() dto: AtualizarUnidadeDto,
    @Ctx() ctx: Contexto,
  ) {
    return this.unidades.atualizar(id, dto, ctx);
  }

  @Get('unidades/:id/historico')
  historico(@Param('id') id: string, @Ctx() ctx: Contexto) {
    return this.unidades.historico(id, ctx.usuario);
  }

  // Libera a unidade para a etapa em curso, ou a reapresenta após pendências
  @Post('unidades/:id/liberar')
  liberar(
    @Param('id') id: string,
    @Body() dto: ObservacaoDto,
    @Ctx() ctx: Contexto,
  ) {
    return this.unidades.liberar(id, dto.observacao, ctx);
  }

  @Post('pendencias/:id/resolver')
  resolverPendencia(
    @Param('id') id: string,
    @Body() dto: ResolverPendenciaDto,
    @Ctx() ctx: Contexto,
  ) {
    return this.unidades.resolverPendencia(id, dto.resolucao, ctx);
  }
}
