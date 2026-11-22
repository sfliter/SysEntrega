import type { Etapa, Perfil, StatusUnidade } from './tipos';

// As quatro "estações" por onde a unidade passa. Cada etapa é o trecho entre
// duas estações vizinhas.
export const ESTACOES = ['Construtora', 'Incorporadora', 'Relacionamento', 'Cliente'];

export const ETAPAS: { chave: Etapa; ordem: number; rotulo: string; curto: string }[] = [
  { chave: 'CONSTRUTORA_INCORPORADORA', ordem: 1, rotulo: 'Construtora → Incorporadora', curto: 'Recebimento da obra' },
  { chave: 'INCORPORADORA_RELACIONAMENTO', ordem: 2, rotulo: 'Incorporadora → Central de Relacionamento', curto: 'Repasse à central' },
  { chave: 'RELACIONAMENTO_CLIENTE', ordem: 3, rotulo: 'Central de Relacionamento → Cliente', curto: 'Entrega ao cliente' },
];

export const ordemDaEtapa = (e: Etapa) => ETAPAS.find((x) => x.chave === e)!.ordem;
export const rotuloDaEtapa = (e: Etapa) => ETAPAS.find((x) => x.chave === e)!.rotulo;

export const STATUS: Record<StatusUnidade, { rotulo: string; tom: 'neutro' | 'andamento' | 'atencao' | 'perigo' | 'ok' }> = {
  AGUARDANDO_LIBERACAO: { rotulo: 'Aguardando liberação', tom: 'neutro' },
  AGUARDANDO_AGENDAMENTO: { rotulo: 'Aguardando agendamento', tom: 'atencao' },
  VISTORIA_AGENDADA: { rotulo: 'Vistoria agendada', tom: 'andamento' },
  AGUARDANDO_CONFERENCIA: { rotulo: 'Aguardando conferência', tom: 'atencao' },
  EM_VISTORIA: { rotulo: 'Em vistoria', tom: 'andamento' },
  COM_PENDENCIAS: { rotulo: 'Com pendências', tom: 'perigo' },
  AGUARDANDO_ASSINATURA: { rotulo: 'Aguardando assinaturas', tom: 'atencao' },
  ENTREGUE: { rotulo: 'Entregue ao cliente', tom: 'ok' },
};

export const PERFIL: Record<Perfil, string> = {
  ADMINISTRADOR: 'Administrador',
  CONSTRUTORA: 'Construtora',
  INCORPORADORA: 'Incorporadora',
  RELACIONAMENTO: 'Central de Relacionamento',
  AUDITOR: 'Auditor',
};

export const PARTE: Record<string, string> = {
  CONSTRUTORA: 'Construtora',
  INCORPORADORA: 'Incorporadora',
  RELACIONAMENTO: 'Central de Relacionamento',
  CLIENTE: 'Cliente',
};

export const RESULTADO_VISTORIA: Record<string, { rotulo: string; tom: 'ok' | 'atencao' | 'perigo' }> = {
  APROVADA: { rotulo: 'Aprovada', tom: 'ok' },
  APROVADA_COM_RESSALVAS: { rotulo: 'Aprovada com ressalvas', tom: 'atencao' },
  REPROVADA: { rotulo: 'Reprovada', tom: 'perigo' },
};

export const METODO: Record<string, string> = {
  SESSAO_AUTENTICADA: 'login + senha',
  CODIGO_USO_UNICO: 'código por e-mail',
  RSF_SIGNER: 'rsf-signer',
};

export function rotuloUnidade(u: { bloco: string; numero: string }) {
  return u.bloco ? `${u.bloco} · ${u.numero}` : u.numero;
}

const fmtDataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const fmtData = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const fmtHora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'short' });

export const dataHora = (iso?: string | null) => (iso ? fmtDataHora.format(new Date(iso)) : '—');
export const dataLonga = (iso: string) => fmtData.format(new Date(iso));
export const hora = (iso: string) => fmtHora.format(new Date(iso));

// "há 3 dias", "há 5 h", "agora" — quanto tempo a unidade está na situação atual
export function haQuanto(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutos < 60) return minutos < 2 ? 'agora' : `há ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'há 1 dia' : `há ${dias} dias`;
}

export function formatarCpfCnpj(v?: string | null) {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
}
