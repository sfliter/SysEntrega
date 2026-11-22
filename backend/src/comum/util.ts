import { createHash, randomBytes, randomInt } from 'crypto';

export function sha256(dado: Buffer | string): string {
  return createHash('sha256').update(dado).digest('hex');
}

export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function codigoNumerico(digitos = 6): string {
  return String(randomInt(0, 10 ** digitos)).padStart(digitos, '0');
}

// Protocolo legível do termo: SE-2026-7K3MQ9 (sem 0/O, 1/I para ditar por telefone)
export function novoProtocolo(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let sufixo = '';
  for (let i = 0; i < 6; i++) sufixo += alfabeto[randomInt(alfabeto.length)];
  return `SE-${new Date().getFullYear()}-${sufixo}`;
}

// JSON com as chaves em ordem: o Postgres (jsonb) reordena as chaves, então o
// hash da auditoria precisa de uma forma que não dependa da ordem.
export function jsonCanonico(valor: unknown): string {
  if (valor === null || valor === undefined) return 'null';
  if (Array.isArray(valor)) return `[${valor.map(jsonCanonico).join(',')}]`;
  if (valor instanceof Date) return JSON.stringify(valor.toISOString());
  if (typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    const chaves = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${chaves
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico(obj[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(valor);
}

export function soDigitos(v?: string | null): string {
  return (v ?? '').replace(/\D/g, '');
}

export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[n])) return false;
  }
  return true;
}

export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    const pesos = base.length === 12
      ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
      : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const soma = base.split('').reduce((s, c, i) => s + Number(c) * pesos[i], 0);
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d.endsWith(`${d1}${d2}`);
}

export function cpfCnpjValido(v: string): boolean {
  const d = soDigitos(v);
  return d.length === 11 ? cpfValido(d) : cnpjValido(d);
}

// Para telas públicas: "Maria S. O." em vez do nome completo
export function nomeAbreviado(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length <= 1) return partes[0] ?? '';
  return `${partes[0]} ${partes
    .slice(1)
    .map((p) => `${p[0].toUpperCase()}.`)
    .join(' ')}`;
}

export function mascararEmail(email: string): string {
  const [usuario, dominio] = email.split('@');
  if (!dominio) return '***';
  return `${usuario.slice(0, 2)}${'*'.repeat(Math.max(usuario.length - 2, 3))}@${dominio}`;
}

const FUSO = process.env.FUSO_HORARIO || 'America/Sao_Paulo';

export function dataHoraBR(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: FUSO,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(d);
}
