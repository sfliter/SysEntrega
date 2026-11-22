import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
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

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(
    @Body() dto: LoginDto,
    @Origem() origem: { ip: string | null; userAgent: string | null },
  ) {
    return this.auth.login(dto.email, dto.senha, origem);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Ctx() ctx: Contexto) {
    return ctx.usuario;
  }
}
