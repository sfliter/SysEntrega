export type Perfil =
  | 'ADMINISTRADOR'
  | 'CONSTRUTORA'
  | 'INCORPORADORA'
  | 'RELACIONAMENTO'
  | 'AUDITOR';

export type Etapa =
  | 'CONSTRUTORA_INCORPORADORA'
  | 'INCORPORADORA_RELACIONAMENTO'
  | 'RELACIONAMENTO_CLIENTE';

export type StatusUnidade =
  | 'AGUARDANDO_LIBERACAO'
  | 'AGUARDANDO_AGENDAMENTO'
  | 'VISTORIA_AGENDADA'
  | 'AGUARDANDO_CONFERENCIA'
  | 'EM_VISTORIA'
  | 'COM_PENDENCIAS'
  | 'AGUARDANDO_ASSINATURA'
  | 'ENTREGUE'
  // Só para a construtora: a unidade já foi recebida e ela não acompanha mais
  | 'RECEBIDA_INCORPORADORA';

export type ResultadoItem = 'CONFORME' | 'RESSALVA' | 'NAO_CONFORME' | 'NAO_SE_APLICA';

export interface Usuario {
  sub: string;
  nome: string;
  email: string;
  perfil: Perfil;
  organizacaoId: string | null;
  organizacaoNome: string | null;
  // Conta de teste: pode ver o sistema como qualquer perfil
  contaTeste?: boolean;
  perfilReal?: Perfil;
}

export interface UnidadeResumo {
  id: string;
  bloco: string;
  numero: string;
  andar: string | null;
  tipologia: string | null;
  etapa: Etapa;
  status: StatusUnidade;
  atualizadoEm: string | null;
  encerradaParaPerfil?: boolean;
  empreendimento: { id: string; nome: string; codigo: string };
  cliente: { id: string; nome: string } | null;
  pendenciasAbertas: number;
}

export interface OpcaoHorario {
  id: string;
  inicio: string;
  escolhida: boolean;
}

export interface Agendamento {
  id: string;
  unidadeId: string;
  etapa: Etapa;
  status: 'PROPOSTO' | 'CONFIRMADO' | 'CANCELADO' | 'REALIZADO';
  dataHora: string | null;
  local: string | null;
  observacao: string | null;
  propostoPorPerfil: Perfil;
  confirmadoPeloCliente: boolean;
  motivoCancelamento: string | null;
  tokenCliente?: string | null;
  criadoEm: string;
  opcoes: OpcaoHorario[];
  podeConfirmar: boolean;
  podeCancelar: boolean;
  unidade?: {
    id: string;
    bloco: string;
    numero: string;
    empreendimento: { nome: string; codigo: string };
    cliente: { nome: string } | null;
  };
}

export interface VistoriaResumo {
  id: string;
  etapa: Etapa;
  status: 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
  resultado: 'APROVADA' | 'APROVADA_COM_RESSALVAS' | 'REPROVADA' | null;
  vistoriadorNome: string;
  acompanhante: string | null;
  observacoes: string | null;
  iniciadaEm: string;
  concluidaEm: string | null;
  totalItens: number;
  podeConduzir: boolean;
}

export interface Pendencia {
  id: string;
  etapa: Etapa;
  descricao: string;
  status: 'ABERTA' | 'RESOLVIDA';
  resolucao: string | null;
  resolvidaPorNome: string | null;
  resolvidaEm: string | null;
  criadoEm: string;
}

export interface Signatario {
  id: string;
  parte: 'CONSTRUTORA' | 'INCORPORADORA' | 'RELACIONAMENTO' | 'CLIENTE';
  nome: string;
  email: string | null;
  status: 'PENDENTE' | 'ASSINADO' | 'RECUSADO';
  metodo: string | null;
  assinadoEm: string | null;
  motivoRecusa: string | null;
  urlAssinatura: string | null;
  token: string | null;
  podeAssinar: boolean;
}

export interface Documento {
  id: string;
  etapa: Etapa;
  protocolo: string;
  titulo: string;
  sha256: string;
  sha256Assinado: string | null;
  assinado: boolean;
  criadoEm: string;
  envelope: {
    id: string;
    provedor: 'INTERNO' | 'RSF_SIGNER';
    status: 'PENDENTE' | 'CONCLUIDO' | 'RECUSADO' | 'CANCELADO';
    concluidoEm: string | null;
    signatarios: Signatario[];
  } | null;
}

export interface DetalheUnidade {
  unidade: Omit<UnidadeResumo, 'pendenciasAbertas' | 'cliente'> & {
    clienteId: string | null;
    cliente: { id: string; nome: string; cpfCnpj: string; email: string | null; telefone: string | null } | null;
    empreendimento: { id: string; nome: string; codigo: string; endereco: string | null };
  };
  etapa: {
    chave: Etapa;
    rotulo: string;
    exigeAgendamento: boolean;
    nomeVistoria: string;
    recebedor: Perfil | null;
  };
  permissoes: {
    liberar: boolean;
    proporHorarios: boolean;
    iniciarVistoria: boolean;
    resolverPendencias: boolean;
    editar: boolean;
    anotar: boolean;
    vincularCliente: boolean;
  };
  agendamentos: Agendamento[];
  vistorias: VistoriaResumo[];
  pendencias: Pendencia[];
  documentos: Documento[];
}

export interface EventoHistorico {
  seq: number;
  criadoEm: string;
  acao: string;
  descricao: string;
  etapa: Etapa | null;
  atorTipo: string;
  atorNome: string;
  atorPerfil: string | null;
  organizacao: string | null;
  statusAnterior: string | null;
  statusNovo: string | null;
}
