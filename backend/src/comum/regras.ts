import {
  Agendamento,
  Envelope,
  Etapa,
  Perfil,
  ProvedorAssinatura,
  Signatario,
  StatusAgendamento,
  StatusEnvelope,
  StatusSignatario,
  StatusUnidade,
  Unidade,
} from '@prisma/client';
import { UsuarioLogado } from './contexto';
import { ETAPAS, perfilDaParte } from './fluxo';

// Regras de "quem pode o quê" num lugar só: os serviços aplicam e a API
// devolve o resultado para a tela mostrar apenas os botões que funcionam.

const admin = (u: UsuarioLogado) => u.perfil === Perfil.ADMINISTRADOR;
const tem = (u: UsuarioLogado, perfis: (Perfil | null)[]) =>
  admin(u) || perfis.includes(u.perfil);

export function podeLiberar(u: UsuarioLogado, un: Unidade) {
  return (
    un.status === StatusUnidade.AGUARDANDO_LIBERACAO &&
    tem(u, [ETAPAS[un.etapa].cedente])
  );
}

export function podeProporHorarios(u: UsuarioLogado, un: Unidade) {
  const cfg = ETAPAS[un.etapa];
  return (
    cfg.exigeAgendamento &&
    un.status === StatusUnidade.AGUARDANDO_AGENDAMENTO &&
    tem(u, cfg.propoeHorarios)
  );
}

export function podeConfirmarAgendamento(
  u: UsuarioLogado,
  ag: Pick<Agendamento, 'status' | 'etapa' | 'propostoPorPerfil'>,
) {
  if (ag.status !== StatusAgendamento.PROPOSTO) return false;
  if (admin(u)) return true;
  const cfg = ETAPAS[ag.etapa];
  // Com o cliente: ele escolhe pelo link; o Relacionamento pode registrar a
  // escolha feita por telefone (fica marcado como "em nome do cliente").
  if (cfg.recebedor === null) return u.perfil === cfg.cedente;
  // Entre empresas: quem escolhe é a parte que não ofereceu os horários
  return (
    [cfg.cedente, cfg.recebedor].includes(u.perfil) &&
    u.perfil !== ag.propostoPorPerfil
  );
}

export function podeCancelarAgendamento(
  u: UsuarioLogado,
  ag: Pick<Agendamento, 'status' | 'etapa'>,
) {
  const cfg = ETAPAS[ag.etapa];
  const aberto =
    ag.status === StatusAgendamento.PROPOSTO ||
    ag.status === StatusAgendamento.CONFIRMADO;
  return aberto && tem(u, [cfg.cedente, cfg.recebedor]);
}

export function podeIniciarVistoria(u: UsuarioLogado, un: Unidade) {
  const pronto =
    un.status === StatusUnidade.VISTORIA_AGENDADA ||
    un.status === StatusUnidade.AGUARDANDO_CONFERENCIA;
  return pronto && tem(u, [ETAPAS[un.etapa].vistoriador]);
}

export function podeConduzirVistoria(u: UsuarioLogado, etapa: Etapa) {
  return tem(u, [ETAPAS[etapa].vistoriador]);
}

export function podeResolverPendencias(u: UsuarioLogado, un: Unidade) {
  return (
    un.status === StatusUnidade.COM_PENDENCIAS &&
    tem(u, ETAPAS[un.etapa].resolvePendencias)
  );
}

// Ninguém assina por outra parte — nem o administrador.
export function podeAssinar(
  u: UsuarioLogado,
  sig: Pick<Signatario, 'status' | 'parte'>,
  env: Pick<Envelope, 'status' | 'provedor'>,
) {
  return (
    env.provedor === ProvedorAssinatura.INTERNO &&
    env.status === StatusEnvelope.PENDENTE &&
    sig.status === StatusSignatario.PENDENTE &&
    perfilDaParte(sig.parte) === u.perfil
  );
}

export function podeCadastrarUnidades(u: UsuarioLogado) {
  return tem(u, [Perfil.INCORPORADORA]);
}

export function podeGerirClientes(u: UsuarioLogado) {
  return tem(u, [Perfil.INCORPORADORA, Perfil.RELACIONAMENTO]);
}
