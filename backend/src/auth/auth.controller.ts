import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Limite, LimiteGuard } from './limite.guard';
import { Perfil } from '@prisma/client';
import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Contexto, Ctx, Origem } from '../comum/contexto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards';

class LoginDto {
  @IsEmail()
  @MaxLength(200)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  senha: string;
}

class TrocarSenhaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  senhaAtual: string;

  @IsString()
  @MinLength(8, { message: 'A nova senha precisa de ao menos 8 caracteres' })
  @MaxLength(200)
  novaSenha: string;
}

class VerComoDto {
  @IsEnum(Perfil)
  perfil: Perfil;

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  organizacaoId?: string | null;
}

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  // 10 tentativas a cada 5 minutos por IP + e-mail
  @Post('login')
  @HttpCode(200)
  @UseGuards(LimiteGuard)
  @Limite(10, 300, 'email')
  login(
    @Body() dto: LoginDto,
    @Origem() origem: { ip: string | null; userAgent: string | null },
  ) {
    return this.auth.login(dto.email, dto.senha, origem);
  }

  @Post('trocar-senha')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, LimiteGuard)
  @Limite(10, 300)
  trocarSenha(@Body() dto: TrocarSenhaDto, @Ctx() ctx: Contexto) {
    return this.auth.trocarSenha(ctx, dto.senhaAtual, dto.novaSenha);
  }

  @Get('perfis-de-teste')
  @UseGuards(JwtAuthGuard)
  perfisDeTeste(@Ctx() ctx: Contexto) {
    return this.auth.perfisDeTeste(ctx);
  }

  // Conta de teste: troca o perfil com que ela vê (e opera) o sistema
  @Post('ver-como')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  verComo(@Body() dto: VerComoDto, @Ctx() ctx: Contexto) {
    return this.auth.verComo(ctx, dto.perfil, dto.organizacaoId ?? null);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Ctx() ctx: Contexto) {
    return ctx.usuario;
  }
}
