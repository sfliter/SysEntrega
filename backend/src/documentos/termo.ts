import { TipoDocumento } from '@prisma/client';

// Retrato do termo no momento da emissão. É gravado junto do documento e é a
// única fonte do PDF — o termo assinado é refeito a partir daqui, não dos
// cadastros (que podem ter mudado desde então).
export interface ConteudoTermo {
  protocolo: string;
  titulo: string;
  tipo: TipoDocumento;
  etapa: string;
  emitidoEm: string;
  empreendimento: { nome: string; codigo: string; endereco: string | null };
  unidade: {
    bloco: string;
    numero: string;
    andar: string | null;
    tipologia: string | null;
  };
  cedente: ParteTermo;
  recebedor: ParteTermo;
  vistoria: {
    nome: string;
    agendadaPara: string | null;
    iniciadaEm: string;
    concluidaEm: string;
    vistoriador: string;
    acompanhante: string | null;
    resultado: string;
    observacoes: string | null;
    conformes: number;
    aplicaveis: number;
  };
  itens: ItemTermo[];
  pendenciasSanadas: {
    descricao: string;
    resolucao: string;
    resolvidaPor: string;
    resolvidaEm: string;
  }[];
  declaracao: string;
}

export interface ParteTermo {
  parte: string;
  nome: string; // razão social ou nome do cliente
  documento: string | null; // CNPJ ou CPF
  representante: string | null;
}

export interface ItemTermo {
  ambiente: string;
  descricao: string;
  resultado: string;
  observacao: string | null;
  fotos: string[]; // chaves no armazenamento
}

export interface AssinaturaTermo {
  parte: string;
  nome: string;
  cpf: string | null;
  metodo: string;
  assinadoEm: string;
  ip: string | null;
  userAgent: string | null;
  localizacao: string | null;
  assinaturaImagem: string | null;
}

// Textos de aceite de cada termo. São um ponto de partida: devem passar pelo
// jurídico antes do uso em produção.
export const DECLARACOES: Record<TipoDocumento, string> = {
  TERMO_RECEBIMENTO:
    'A CONSTRUTORA declara entregar, e a INCORPORADORA declara receber, a unidade identificada neste termo, ' +
    'vistoriada na data indicada e no estado aqui descrito. As ressalvas registradas permanecem sob ' +
    'responsabilidade da CONSTRUTORA para correção. O recebimento não exime a CONSTRUTORA da ' +
    'responsabilidade por vícios ocultos nem afasta as garantias legais e contratuais da obra.',
  TERMO_REPASSE:
    'A INCORPORADORA declara repassar à CENTRAL DE RELACIONAMENTO a unidade identificada neste termo, ' +
    'apta para apresentação e entrega ao cliente. A CENTRAL DE RELACIONAMENTO declara ter conferido e ' +
    'recebido a unidade, as chaves e os documentos relacionados, no estado aqui descrito.',
  TERMO_ENTREGA:
    'O CLIENTE declara ter vistoriado a unidade identificada neste termo, acompanhado pela Central de ' +
    'Relacionamento, e a recebe, com as respectivas chaves, no estado aqui descrito. As ressalvas ' +
    'registradas serão tratadas pela incorporadora. O recebimento não afasta as garantias legais e ' +
    'contratuais do imóvel.',
};

export const ROTULO_RESULTADO_ITEM: Record<string, string> = {
  CONFORME: 'Conforme',
  RESSALVA: 'Com ressalva',
  NAO_CONFORME: 'Não conforme',
  NAO_SE_APLICA: 'Não se aplica',
};

export const ROTULO_RESULTADO_VISTORIA: Record<string, string> = {
  APROVADA: 'Aprovada',
  APROVADA_COM_RESSALVAS: 'Aprovada com ressalvas',
  REPROVADA: 'Reprovada',
};

export const ROTULO_METODO: Record<string, string> = {
  SESSAO_AUTENTICADA: 'Usuário autenticado, com senha conferida no ato',
  CODIGO_USO_UNICO: 'Código de uso único enviado ao titular',
  RSF_SIGNER: 'Assinatura colhida pelo rsf-signer',
  ENSAIO: 'ENSAIO — código exibido apenas no log do servidor. SEM VALOR DE ASSINATURA',
};
