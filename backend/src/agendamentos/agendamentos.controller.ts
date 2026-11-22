import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Etapa, StatusAgendamento } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Contexto, Ctx } from '../comum/contexto';
import { AgendamentosService } from './agendamentos.service';

export class PropostaBody {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsDateString({}, { each: true })
  opcoes: string[];

  @IsOptional() @IsString() @MaxLength(200) local?: string;
  @IsOptional() @IsString() @MaxLength(1000) observacao?: string;
}

class ReagendarBody extends PropostaBody {
  @IsString()
  @MinLength(5, { message: 'Informe o motivo do reagendamento' })
  @MaxLength(1000)
  motivo: string;
}

class ConfirmarBody {
  @IsString() opcaoId: string;
  @IsOptional() @IsString() @MaxLength(1000) observacao?: string;
}

class CancelarBody {
  @IsString()
  @MinLength(5, { message: 'Informe o motivo do cancelamento' })
  @MaxLength(1000)
  motivo: string;
}

class FiltroAgenda {
  @IsOptional() @IsDateString() de?: string;
  @IsOptional() @IsDateString() ate?: string;
  @IsOptional() @IsEnum(Etapa) etapa?: Etapa;
  @IsOptional() @IsEnum(StatusAgendamento) status?: StatusAgendamento;
}

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AgendamentosController {
  constructor(private agendamentos: AgendamentosService) {}

  @Get('agendamentos')
  agenda(@Query() f: FiltroAgenda, @Ctx() ctx: Contexto) {
    return this.agendamentos.agenda(ctx.usuario, {
      de: f.de ? new Date(f.de) : undefined,
      ate: f.ate ? new Date(f.ate) : undefined,
      etapa: f.etapa,
      status: f.status,
    });
  }

  @Post('unidades/:id/agendamentos')
  propor(@Param('id') id: string, @Body() dto: PropostaBody, @Ctx() ctx: Contexto) {
    return this.agendamentos.propor(id, dto, ctx);
  }

  @Post('agendamentos/:id/confirmar')
  confirmar(@Param('id') id: string, @Body() dto: ConfirmarBody, @Ctx() ctx: Contexto) {
    return this.agendamentos.confirmar(id, dto, ctx);
  }

  @Post('agendamentos/:id/cancelar')
  cancelar(@Param('id') id: string, @Body() dto: CancelarBody, @Ctx() ctx: Contexto) {
    return this.agendamentos.cancelar(id, dto.motivo, ctx);
  }

  @Post('agendamentos/:id/reagendar')
  reagendar(@Param('id') id: string, @Body() dto: ReagendarBody, @Ctx() ctx: Contexto) {
    return this.agendamentos.reagendar(id, dto, ctx);
  }
}
