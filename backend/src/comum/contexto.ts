import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Perfil, TipoAtor } from '@prisma/client';
import type { Request } from 'express';

export interface UsuarioLogado {
  sub: string;
  nome: string;
  email: string;
  perfil: Perfil;
  organizacaoId: string | null;
  organizacaoNome: string | null;
  // Conta de teste vendo o sistema como outro perfil (ver auth/guards.ts)
  contaTeste?: boolean;
  perfilReal?: Perfil;
}

// Quem está agindo — vai inteiro para a trilha de auditoria
export interface Ator {
  tipo: TipoAtor;
  id?: string | null;
  nome: string;
  perfil?: string | null;
  organizacao?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

// Contexto de uma requisição: o usuário (quando há login) e a origem
export interface Contexto {
  usuario: UsuarioLogado;
  ip: string | null;
  userAgent: string | null;
  ator: Ator;
}

export function origemDe(req: Request) {
  return {
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
  };
}

export function atorUsuario(usuario: UsuarioLogado, req?: Request): Ator {
  return {
    tipo: TipoAtor.USUARIO,
    id: usuario.sub,
    nome: usuario.nome,
    perfil: usuario.perfil,
    organizacao: usuario.organizacaoNome,
    ...(req ? origemDe(req) : {}),
  };
}

export const ATOR_SISTEMA: Ator = { tipo: TipoAtor.SISTEMA, nome: 'Sistema' };

export const Ctx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Contexto => {
    const req = context.switchToHttp().getRequest<Request>();
    const usuario = (req as any).user as UsuarioLogado;
    return {
      usuario,
      ...origemDe(req),
      ator: usuario ? atorUsuario(usuario, req) : ATOR_SISTEMA,
    };
  },
);

// Para rotas públicas (sem login): só a origem da requisição
export const Origem = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    origemDe(context.switchToHttp().getRequest<Request>()),
);

export function ehAdmin(u: UsuarioLogado) {
  return u.perfil === Perfil.ADMINISTRADOR;
}
