import {
  Etapa,
  ParteSignataria,
  Perfil,
  StatusUnidade,
  TipoDocumento,
} from '@prisma/client';

// Definição declarativa das três etapas de transferência da unidade. Para
// ajustar quem faz o quê em cada etapa, edite apenas este arquivo.
export interface ConfigEtapa {
  ordem: number;
  rotulo: string;
  // Quem entrega e quem recebe. `recebedor` nulo = cliente final (sem login).
  cedente: Perfil;
  recebedor: Perfil | null;
  parteCedente: ParteSignataria;
  parteRecebedora: ParteSignataria;
  // A unidade entra na etapa aguardando liberação de quem entrega? Se não,
  // já entra pronta para o passo seguinte.
  liberacaoManual: boolean;
  // Há data marcada para a vistoria? Se não, quem recebe faz uma conferência
  // quando quiser.
  exigeAgendamento: boolean;
  // Quem oferece horários e quem conduz a vistoria/conferência
  propoeHorarios: Perfil[];
  vistoriador: Perfil;
  // Quem marca as pendências como resolvidas e reapresenta a unidade
  resolvePendencias: Perfil[];
  tipoDocumento: TipoDocumento;
  tituloDocumento: string;
  nomeVistoria: string;
  proxima: Etapa | null;
}

export const ETAPAS: Record<Etapa, ConfigEtapa> = {
  CONSTRUTORA_INCORPORADORA: {
    ordem: 1,
    rotulo: 'Construtora → Incorporadora',
    cedente: Perfil.CONSTRUTORA,
    recebedor: Perfil.INCORPORADORA,
    parteCedente: ParteSignataria.CONSTRUTORA,
    parteRecebedora: ParteSignataria.INCORPORADORA,
    liberacaoManual: true,
    exigeAgendamento: true,
    propoeHorarios: [Perfil.CONSTRUTORA, Perfil.INCORPORADORA],
    vistoriador: Perfil.INCORPORADORA,
    resolvePendencias: [Perfil.CONSTRUTORA],
    tipoDocumento: TipoDocumento.TERMO_RECEBIMENTO,
    tituloDocumento: 'Termo de Vistoria e Recebimento de Unidade',
    nomeVistoria: 'Vistoria técnica',
    proxima: Etapa.INCORPORADORA_RELACIONAMENTO,
  },
  INCORPORADORA_RELACIONAMENTO: {
    ordem: 2,
    rotulo: 'Incorporadora → Central de Relacionamento',
    cedente: Perfil.INCORPORADORA,
    recebedor: Perfil.RELACIONAMENTO,
    parteCedente: ParteSignataria.INCORPORADORA,
    parteRecebedora: ParteSignataria.RELACIONAMENTO,
    liberacaoManual: true,
    exigeAgendamento: false,
    propoeHorarios: [],
    vistoriador: Perfil.RELACIONAMENTO,
    resolvePendencias: [Perfil.INCORPORADORA],
    tipoDocumento: TipoDocumento.TERMO_REPASSE,
    tituloDocumento: 'Termo de Repasse de Unidade à Central de Relacionamento',
    nomeVistoria: 'Conferência de repasse',
    proxima: Etapa.RELACIONAMENTO_CLIENTE,
  },
  RELACIONAMENTO_CLIENTE: {
    ordem: 3,
    rotulo: 'Central de Relacionamento → Cliente',
    cedente: Perfil.RELACIONAMENTO,
    recebedor: null,
    parteCedente: ParteSignataria.RELACIONAMENTO,
    parteRecebedora: ParteSignataria.CLIENTE,
    liberacaoManual: false,
    exigeAgendamento: true,
    propoeHorarios: [Perfil.RELACIONAMENTO],
    vistoriador: Perfil.RELACIONAMENTO,
    resolvePendencias: [Perfil.RELACIONAMENTO, Perfil.INCORPORADORA],
    tipoDocumento: TipoDocumento.TERMO_ENTREGA,
    tituloDocumento: 'Termo de Vistoria, Aceite e Entrega de Chaves',
    nomeVistoria: 'Vistoria com o cliente',
    proxima: null,
  },
};

export const ORDEM_ETAPAS: Etapa[] = [
  Etapa.CONSTRUTORA_INCORPORADORA,
  Etapa.INCORPORADORA_RELACIONAMENTO,
  Etapa.RELACIONAMENTO_CLIENTE,
];

// Status em que a unidade entra numa etapa, e em que fica depois de liberada
// (ou reapresentada após sanar pendências).
export function statusDeEntrada(etapa: Etapa): StatusUnidade {
  return ETAPAS[etapa].liberacaoManual
    ? StatusUnidade.AGUARDANDO_LIBERACAO
    : statusAposLiberacao(etapa);
}

export function statusAposLiberacao(etapa: Etapa): StatusUnidade {
  return ETAPAS[etapa].exigeAgendamento
    ? StatusUnidade.AGUARDANDO_AGENDAMENTO
    : StatusUnidade.AGUARDANDO_CONFERENCIA;
}

export const ROTULO_STATUS: Record<StatusUnidade, string> = {
  AGUARDANDO_LIBERACAO: 'Aguardando liberação',
  AGUARDANDO_AGENDAMENTO: 'Aguardando agendamento',
  VISTORIA_AGENDADA: 'Vistoria agendada',
  AGUARDANDO_CONFERENCIA: 'Aguardando conferência',
  EM_VISTORIA: 'Em vistoria',
  COM_PENDENCIAS: 'Com pendências',
  AGUARDANDO_ASSINATURA: 'Aguardando assinaturas',
  ENTREGUE: 'Entregue ao cliente',
};

// Depois que a unidade é recebida e o termo da vistoria é aceito pelas duas
// partes, a construtora deixa de acompanhar o que acontece com ela: para a
// construtora a unidade passa a aparecer apenas como "recebida".
export const RECEBIDA_INCORPORADORA = 'RECEBIDA_INCORPORADORA';
export type StatusVisivel = StatusUnidade | typeof RECEBIDA_INCORPORADORA;
export const ROTULO_STATUS_VISIVEL: Record<StatusVisivel, string> = {
  ...ROTULO_STATUS,
  RECEBIDA_INCORPORADORA: 'Recebida pela incorporadora',
};

// A situação da unidade como o perfil pode vê-la
export function situacaoVisivel(
  perfil: Perfil,
  un: { etapa: Etapa; status: StatusUnidade; atualizadoEm: Date },
): { etapa: Etapa; status: StatusVisivel; atualizadoEm: Date | null; encerradaParaPerfil: boolean } {
  if (perfil === Perfil.CONSTRUTORA && un.etapa !== Etapa.CONSTRUTORA_INCORPORADORA) {
    return {
      etapa: Etapa.CONSTRUTORA_INCORPORADORA,
      status: RECEBIDA_INCORPORADORA,
      // a data da última mudança revelaria a atividade das etapas seguintes
      atualizadoEm: null,
      encerradaParaPerfil: true,
    };
  }
  return { etapa: un.etapa, status: un.status, atualizadoEm: un.atualizadoEm, encerradaParaPerfil: false };
}

export const ROTULO_PARTE: Record<ParteSignataria, string> = {
  CONSTRUTORA: 'Construtora',
  INCORPORADORA: 'Incorporadora',
  RELACIONAMENTO: 'Central de Relacionamento',
  CLIENTE: 'Cliente',
};

export function rotuloEstado(etapa: Etapa, status: StatusUnidade): string {
  if (status === StatusUnidade.ENTREGUE) return ROTULO_STATUS[status];
  return `Etapa ${ETAPAS[etapa].ordem} · ${ROTULO_STATUS[status]}`;
}

// A construtora só enxerga a etapa em que participa: agendamentos, vistorias,
// termos e histórico das etapas seguintes envolvem o cliente e não são dela.
export function etapasVisiveis(perfil: Perfil): Etapa[] {
  return perfil === Perfil.CONSTRUTORA
    ? [Etapa.CONSTRUTORA_INCORPORADORA]
    : ORDEM_ETAPAS;
}

export function perfilDaParte(parte: ParteSignataria): Perfil | null {
  switch (parte) {
    case ParteSignataria.CONSTRUTORA:
      return Perfil.CONSTRUTORA;
    case ParteSignataria.INCORPORADORA:
      return Perfil.INCORPORADORA;
    case ParteSignataria.RELACIONAMENTO:
      return Perfil.RELACIONAMENTO;
    default:
      return null;
  }
}
