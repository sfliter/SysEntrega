import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Perfil } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Token não informado');
    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync(token)).sub;
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada');
    }
    // O token só diz quem é. Perfil, organização e se o usuário continua
    // ativo vêm do banco a cada requisição: desativar alguém ou mudar o
    // perfil vale na hora, sem esperar o token vencer.
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: sub },
      include: { organizacao: { select: { nome: true } } },
    });
    if (!usuario || !usuario.ativo) {
      throw new UnauthorizedException('Usuário desativado');
    }
    (request as any).user = {
      sub: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      perfil: usuario.perfil,
      organizacaoId: usuario.organizacaoId,
      organizacaoNome: usuario.organizacao?.nome ?? null,
    };
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const perfis = this.reflector.getAllAndOverride<Perfil[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user) throw new ForbiddenException('Não autenticado');

    const leitura = request.method === 'GET' || request.method === 'HEAD';
    // Somente leitura: o bloqueio fica aqui, não só nos botões da tela
    if (user.perfil === Perfil.AUDITOR) {
      if (leitura) return true;
      throw new ForbiddenException(
        'Perfil somente leitura: esta ação não é permitida',
      );
    }
    if (!perfis || perfis.length === 0) return true;
    if (user.perfil === Perfil.ADMINISTRADOR) return true;
    if (perfis.includes(user.perfil)) return true;
    throw new ForbiddenException('Perfil sem permissão para esta operação');
  }
}
