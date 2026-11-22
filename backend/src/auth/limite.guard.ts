import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

interface RegraLimite {
  max: number;
  segundos: number;
  // Campo do corpo que entra na chave (ex.: e-mail no login), além do IP
  campo?: string;
}

const LIMITE_KEY = 'limite';

// Limite de chamadas por origem, para as rotas sem login (tentativas de
// senha, links públicos). Fica na memória do processo: serve a uma instância
// da API. Com mais de uma instância, o limite passa a valer por instância —
// nesse caso, mova o controle para o proxy ou para um armazenamento comum.
export const Limite = (max: number, segundos: number, campo?: string) =>
  SetMetadata(LIMITE_KEY, { max, segundos, campo } satisfies RegraLimite);

@Injectable()
export class LimiteGuard implements CanActivate {
  private chamadas = new Map<string, number[]>();

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const regra = this.reflector.getAllAndOverride<RegraLimite>(LIMITE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!regra) return true;
    const req = context.switchToHttp().getRequest<Request>();
    const extra = regra.campo
      ? String(req.body?.[regra.campo] ?? '').trim().toLowerCase().slice(0, 200)
      : '';
    const escopo = regra.campo ? context.getHandler().name : context.getClass().name;
    const chave = `${escopo}|${req.ip}|${extra}`;

    const agora = Date.now();
    const inicio = agora - regra.segundos * 1000;
    const recentes = (this.chamadas.get(chave) ?? []).filter((t) => t > inicio);
    if (recentes.length >= regra.max) {
      this.chamadas.set(chave, recentes);
      throw new HttpException(
        'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recentes.push(agora);
    this.chamadas.set(chave, recentes);
    if (this.chamadas.size > 20000) this.limpar(agora);
    return true;
  }

  // Descarta as chaves sem chamadas recentes (janela máxima de 1 hora)
  private limpar(agora: number) {
    for (const [chave, tempos] of this.chamadas) {
      if (tempos[tempos.length - 1] < agora - 3600_000) this.chamadas.delete(chave);
    }
  }
}
