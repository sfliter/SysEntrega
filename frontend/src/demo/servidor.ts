// Servidor simulado da demonstração.
//
// Roda dentro da própria página e responde às mesmas chamadas da API real,
// com as mesmas regras de quem pode o quê (espelho de backend/src/comum/
// fluxo.ts e regras.ts). Serve para aprovar telas e fluxo — não é o sistema:
// nada é gravado, e tudo recomeça ao reabrir a página.
import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { fila } from '../fila';
import type { Etapa, Perfil, ResultadoItem, StatusUnidade, Usuario } from '../tipos';

type Parte = 'CONSTRUTORA' | 'INCORPORADORA' | 'RELACIONAMENTO' | 'CLIENTE';

interface ConfigEtapa {
  ordem: number;
  rotulo: string;
  cedente: Perfil;
  recebedor: Perfil | null;
  parteCedente: Parte;
  parteRecebedora: Parte;
  liberacaoManual: boolean;
  exigeAgendamento: boolean;
  propoeHorarios: Perfil[];
  vistoriador: Perfil;
  resolvePendencias: Perfil[];
  titulo: string;
  nomeVistoria: string;
  declaracao: string;
  proxima: Etapa | null;
}

const ETAPAS: Record<Etapa, ConfigEtapa> = {
  CONSTRUTORA_INCORPORADORA: {
    ordem: 1, rotulo: 'Construtora → Incorporadora', cedente: 'CONSTRUTORA', recebedor: 'INCORPORADORA',
    parteCedente: 'CONSTRUTORA', parteRecebedora: 'INCORPORADORA', liberacaoManual: true, exigeAgendamento: true,
    propoeHorarios: ['CONSTRUTORA', 'INCORPORADORA'], vistoriador: 'INCORPORADORA', resolvePendencias: ['CONSTRUTORA'],
    titulo: 'Termo de Vistoria e Recebimento de Unidade', nomeVistoria: 'Vistoria técnica',
    declaracao: 'A CONSTRUTORA declara entregar, e a INCORPORADORA declara receber, a unidade identificada neste termo, vistoriada na data indicada e no estado aqui descrito. As ressalvas registradas permanecem sob responsabilidade da CONSTRUTORA para correção. O recebimento não exime a CONSTRUTORA da responsabilidade por vícios ocultos nem afasta as garantias legais e contratuais da obra.',
    proxima: 'INCORPORADORA_RELACIONAMENTO',
  },
  INCORPORADORA_RELACIONAMENTO: {
    ordem: 2, rotulo: 'Incorporadora → Central de Relacionamento', cedente: 'INCORPORADORA', recebedor: 'RELACIONAMENTO',
    parteCedente: 'INCORPORADORA', parteRecebedora: 'RELACIONAMENTO', liberacaoManual: true, exigeAgendamento: false,
    propoeHorarios: [], vistoriador: 'RELACIONAMENTO', resolvePendencias: ['INCORPORADORA'],
    titulo: 'Termo de Repasse de Unidade à Central de Relacionamento', nomeVistoria: 'Conferência de repasse',
    declaracao: 'A INCORPORADORA declara repassar à CENTRAL DE RELACIONAMENTO a unidade identificada neste termo, apta para apresentação e entrega ao cliente. A CENTRAL DE RELACIONAMENTO declara ter conferido e recebido a unidade, as chaves e os documentos relacionados, no estado aqui descrito.',
    proxima: 'RELACIONAMENTO_CLIENTE',
  },
  RELACIONAMENTO_CLIENTE: {
    ordem: 3, rotulo: 'Central de Relacionamento → Cliente', cedente: 'RELACIONAMENTO', recebedor: null,
    parteCedente: 'RELACIONAMENTO', parteRecebedora: 'CLIENTE', liberacaoManual: false, exigeAgendamento: true,
    propoeHorarios: ['RELACIONAMENTO'], vistoriador: 'RELACIONAMENTO', resolvePendencias: ['RELACIONAMENTO', 'INCORPORADORA'],
    titulo: 'Termo de Vistoria, Aceite e Entrega de Chaves', nomeVistoria: 'Vistoria com o cliente',
    declaracao: 'O CLIENTE declara ter vistoriado a unidade identificada neste termo, acompanhado pela Central de Relacionamento, e a recebe, com as respectivas chaves, no estado aqui descrito. As ressalvas registradas serão tratadas pela incorporadora. O recebimento não afasta as garantias legais e contratuais do imóvel.',
    proxima: null,
  },
};
const ORDEM: Etapa[] = ['CONSTRUTORA_INCORPORADORA', 'INCORPORADORA_RELACIONAMENTO', 'RELACIONAMENTO_CLIENTE'];

const STATUS: Record<StatusUnidade, string> = {
  AGUARDANDO_LIBERACAO: 'Aguardando liberação', AGUARDANDO_AGENDAMENTO: 'Aguardando agendamento',
  VISTORIA_AGENDADA: 'Vistoria agendada', AGUARDANDO_CONFERENCIA: 'Aguardando conferência', EM_VISTORIA: 'Em vistoria',
  COM_PENDENCIAS: 'Com pendências', AGUARDANDO_ASSINATURA: 'Aguardando assinaturas', ENTREGUE: 'Entregue ao cliente',
};
const PARTE: Record<Parte, string> = {
  CONSTRUTORA: 'Construtora', INCORPORADORA: 'Incorporadora', RELACIONAMENTO: 'Central de Relacionamento', CLIENTE: 'Cliente',
};
const RESULTADO_ITEM: Record<string, string> = {
  CONFORME: 'Conforme', RESSALVA: 'Com ressalva', NAO_CONFORME: 'Não conforme', NAO_SE_APLICA: 'Não se aplica',
};
const RESULTADO: Record<string, string> = {
  APROVADA: 'Aprovada', APROVADA_COM_RESSALVAS: 'Aprovada com ressalvas', REPROVADA: 'Reprovada',
};

const PAUTA: Record<Etapa, [string, string[]][]> = {
  CONSTRUTORA_INCORPORADORA: [
    ['Geral', ['Limpeza final da unidade', 'Pintura de paredes e tetos', 'Pisos e rodapés', 'Portas, batentes e fechaduras', 'Esquadrias e vidros']],
    ['Instalações elétricas', ['Quadro de distribuição identificado', 'Tomadas e interruptores', 'Pontos de iluminação']],
    ['Instalações hidráulicas', ['Pontos de água e registros', 'Esgoto e ralos (teste de escoamento)', 'Ausência de vazamentos e infiltrações']],
    ['Cozinha e área de serviço', ['Bancadas e cubas', 'Revestimentos e rejuntes']],
    ['Banheiros', ['Louças e metais', 'Impermeabilização (teste de estanqueidade)', 'Revestimentos e rejuntes']],
    ['Varanda', ['Guarda-corpo e fixações', 'Caimento e escoamento do piso']],
  ],
  INCORPORADORA_RELACIONAMENTO: [
    ['Documentação', ['Termo de recebimento da construtora assinado', 'Manual do proprietário', 'Habite-se e documentação do empreendimento']],
    ['Chaves', ['Jogo completo de chaves da unidade', 'Controles e tags de acesso']],
    ['Unidade', ['Unidade limpa e pronta para apresentação', 'Ressalvas da vistoria técnica tratadas', 'Medidores e ligações (água, luz, gás) identificados']],
  ],
  RELACIONAMENTO_CLIENTE: [
    ['Geral', ['Pintura de paredes e tetos', 'Pisos e rodapés', 'Portas e fechaduras', 'Janelas e vidros']],
    ['Elétrica', ['Tomadas, interruptores e iluminação', 'Quadro de distribuição']],
    ['Hidráulica', ['Torneiras, registros e descargas', 'Ralos e escoamento']],
    ['Cozinha e área de serviço', ['Bancadas, cubas e revestimentos']],
    ['Banheiros', ['Louças, metais e revestimentos']],
    ['Entrega', ['Manual do proprietário entregue', 'Chaves, controles e tags entregues', 'Leitura dos medidores registrada']],
  ],
};

// ---------- estado ----------

class Falha extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}
const recusar = (mensagem = 'Ação não permitida para o seu perfil neste momento'): never => {
  throw new Falha(403, mensagem);
};
const invalido = (mensagem: string): never => {
  throw new Falha(400, mensagem);
};
const sumiu = (mensagem: string): never => {
  throw new Falha(404, mensagem);
};

type Reg = Record<string, any>;
let db: {
  orgs: Reg[]; usuarios: Reg[]; emps: Reg[]; clientes: Reg[]; unidades: Reg[]; agendamentos: Reg[];
  vistorias: Reg[]; pendencias: Reg[]; documentos: Reg[]; eventos: Reg[]; pauta: Reg[];
};
let contador = 0;
let deslocamento = 0; // relógio da demonstração (o roteiro inicial "viaja" no tempo)
const agora = () => new Date(Date.now() + deslocamento);
const iso = () => agora().toISOString();
const novoId = (prefixo: string) => `${prefixo}${(++contador).toString(36).padStart(4, '0')}`;
const token = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 10)).join('');
const dataHora = (d: string | Date) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(d));
const rotuloUn = (u: Reg) => (u.bloco ? `${u.bloco} · ${u.numero}` : u.numero);
const estado = (etapa: Etapa, status: StatusUnidade) =>
  status === 'ENTREGUE' ? STATUS[status] : `Etapa ${ETAPAS[etapa].ordem} · ${STATUS[status]}`;
const abreviar = (nome: string) => {
  const p = nome.trim().split(/\s+/);
  return p.length <= 1 ? p[0] : `${p[0]} ${p.slice(1).map((x) => `${x[0].toUpperCase()}.`).join(' ')}`;
};
const mascarar = (email: string) => {
  const [u, d] = email.split('@');
  return `${u.slice(0, 2)}${'*'.repeat(Math.max(u.length - 2, 3))}@${d}`;
};

// Hash "de mentira" (64 hex) só para a demonstração ter o que mostrar
function hash(texto: string): string {
  let saida = '';
  for (let semente = 1; saida.length < 64; semente++) {
    let h = 2166136261 ^ semente;
    for (let i = 0; i < texto.length; i++) h = Math.imul(h ^ texto.charCodeAt(i), 16777619);
    saida += (h >>> 0).toString(16).padStart(8, '0');
  }
  return saida.slice(0, 64);
}

function protocolo(): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alfabeto[Math.floor(Math.random() * alfabeto.length)];
  return `SE-${agora().getFullYear()}-${s}`;
}

interface Ator {
  tipo: 'USUARIO' | 'CLIENTE' | 'SISTEMA';
  nome: string;
  perfil?: string | null;
  organizacao?: string | null;
  id?: string;
}
const atorDe = (u: Usuario): Ator => ({ tipo: 'USUARIO', nome: u.nome, perfil: u.perfil, organizacao: u.organizacaoNome, id: u.sub });

function registrar(e: {
  acao: string; descricao: string; ator: Ator; unidade?: Reg | null; etapa?: Etapa | null;
  anterior?: string | null; novo?: string | null; entidade?: string;
}) {
  const ultimo = db.eventos[db.eventos.length - 1];
  const hashAnterior = ultimo?.hash ?? '0'.repeat(64);
  const criadoEm = iso();
  db.eventos.push({
    seq: db.eventos.length + 1, criadoEm, acao: e.acao, descricao: e.descricao, entidade: e.entidade ?? 'Unidade',
    unidadeId: e.unidade?.id ?? null, etapa: e.etapa ?? e.unidade?.etapa ?? null,
    atorTipo: e.ator.tipo, atorId: e.ator.id ?? null, atorNome: e.ator.nome, atorPerfil: e.ator.perfil ?? null,
    organizacao: e.ator.organizacao ?? null, ip: e.ator.tipo === 'SISTEMA' ? null : e.ator.tipo === 'CLIENTE' ? '189.40.12.77' : '200.150.31.8',
    statusAnterior: e.anterior ?? null, statusNovo: e.novo ?? null,
    hashAnterior, hash: hash(`${hashAnterior}|${criadoEm}|${e.acao}|${e.descricao}`),
  });
}

function mudar(un: Reg, novo: { etapa?: Etapa; status: StatusUnidade }, ev: { acao: string; descricao: string; ator: Ator }) {
  const antes = estado(un.etapa, un.status);
  const etapaDoEvento = un.etapa;
  un.etapa = novo.etapa ?? un.etapa;
  un.status = novo.status;
  un.atualizadoEm = iso();
  registrar({ ...ev, unidade: un, etapa: etapaDoEvento, anterior: antes, novo: estado(un.etapa, un.status) });
}

// ---------- regras (espelho de regras.ts) ----------

const admin = (u: Usuario) => u.perfil === 'ADMINISTRADOR';
const tem = (u: Usuario, perfis: (Perfil | null)[]) => admin(u) || perfis.includes(u.perfil);
const etapasVisiveis = (p: Perfil): Etapa[] => (p === 'CONSTRUTORA' ? ['CONSTRUTORA_INCORPORADORA'] : ORDEM);
const statusAposLiberacao = (e: Etapa): StatusUnidade => (ETAPAS[e].exigeAgendamento ? 'AGUARDANDO_AGENDAMENTO' : 'AGUARDANDO_CONFERENCIA');
const statusDeEntrada = (e: Etapa): StatusUnidade => (ETAPAS[e].liberacaoManual ? 'AGUARDANDO_LIBERACAO' : statusAposLiberacao(e));
const perfilDaParte = (p: Parte): Perfil | null => (p === 'CLIENTE' ? null : p);

const regras = {
  liberar: (u: Usuario, un: Reg) => un.status === 'AGUARDANDO_LIBERACAO' && tem(u, [ETAPAS[un.etapa as Etapa].cedente]),
  propor: (u: Usuario, un: Reg) => {
    const c = ETAPAS[un.etapa as Etapa];
    return c.exigeAgendamento && un.status === 'AGUARDANDO_AGENDAMENTO' && tem(u, c.propoeHorarios);
  },
  confirmar: (u: Usuario, ag: Reg) => {
    if (ag.status !== 'PROPOSTO') return false;
    if (admin(u)) return true;
    const c = ETAPAS[ag.etapa as Etapa];
    if (c.recebedor === null) return u.perfil === c.cedente;
    return [c.cedente, c.recebedor].includes(u.perfil) && u.perfil !== ag.propostoPorPerfil;
  },
  cancelarAg: (u: Usuario, ag: Reg) => {
    const c = ETAPAS[ag.etapa as Etapa];
    return ['PROPOSTO', 'CONFIRMADO'].includes(ag.status) && tem(u, [c.cedente, c.recebedor]);
  },
  iniciar: (u: Usuario, un: Reg) =>
    ['VISTORIA_AGENDADA', 'AGUARDANDO_CONFERENCIA'].includes(un.status) && tem(u, [ETAPAS[un.etapa as Etapa].vistoriador]),
  conduzir: (u: Usuario, etapa: Etapa) => tem(u, [ETAPAS[etapa].vistoriador]),
  pendencias: (u: Usuario, un: Reg) => un.status === 'COM_PENDENCIAS' && tem(u, ETAPAS[un.etapa as Etapa].resolvePendencias),
  assinar: (u: Usuario, s: Reg, env: Reg) => env.status === 'PENDENTE' && s.status === 'PENDENTE' && perfilDaParte(s.parte) === u.perfil,
  cadastrar: (u: Usuario) => tem(u, ['INCORPORADORA']),
  clientes: (u: Usuario) => tem(u, ['INCORPORADORA', 'RELACIONAMENTO']),
};

const noEscopo = (u: Usuario, un: Reg) =>
  u.perfil !== 'CONSTRUTORA' || db.emps.find((e) => e.id === un.empreendimentoId)?.construtoraId === u.organizacaoId;

function unidade(id: string, u: Usuario): Reg {
  const un = db.unidades.find((x) => x.id === id);
  if (!un || !noEscopo(u, un)) return sumiu('Unidade não encontrada');
  return un;
}
const empDe = (un: Reg) => db.emps.find((e) => e.id === un.empreendimentoId)!;
const clienteDe = (un: Reg) => db.clientes.find((c) => c.id === un.clienteId) ?? null;
const orgNome = (id: string | null) => db.orgs.find((o) => o.id === id)?.nome ?? null;

// ---------- operações ----------

function concluirEtapa(un: Reg, ator: Ator, prot: string) {
  const c = ETAPAS[un.etapa as Etapa];
  if (!c.proxima) {
    mudar(un, { status: 'ENTREGUE' }, { acao: 'UNIDADE_ENTREGUE', descricao: `Termo ${prot} assinado por todas as partes: unidade entregue ao cliente`, ator });
    return;
  }
  un.liberadaPorId = null;
  mudar(un, { etapa: c.proxima, status: statusDeEntrada(c.proxima) }, {
    acao: 'ETAPA_CONCLUIDA', descricao: `Termo ${prot} assinado por todas as partes: etapa "${c.rotulo}" concluída`, ator,
  });
}

function emitirTermo(v: Reg, ator: Ator) {
  const un = db.unidades.find((x) => x.id === v.unidadeId)!;
  const c = ETAPAS[v.etapa as Etapa];
  const emp = empDe(un);
  const cli = clienteDe(un);
  const vistoriador = db.usuarios.find((x) => x.id === v.vistoriadorId)!;
  const liberou = db.usuarios.find((x) => x.id === un.liberadaPorId) ?? null;
  const cedenteU = c.recebedor === null ? vistoriador : liberou;
  const recebedorU = c.recebedor === null ? null : vistoriador;
  const dadosDaParte = (p: Parte, representante: string | null) => {
    if (p === 'CONSTRUTORA') return { parte: PARTE[p], nome: orgNome(emp.construtoraId), documento: db.orgs.find((o) => o.id === emp.construtoraId)?.cnpj ?? null, representante };
    if (p === 'INCORPORADORA') return { parte: PARTE[p], nome: orgNome(emp.incorporadoraId) ?? 'Incorporadora', documento: null, representante };
    if (p === 'RELACIONAMENTO') return { parte: PARTE[p], nome: db.orgs.find((o) => o.tipo === 'CENTRAL_RELACIONAMENTO')?.nome, documento: null, representante };
    return { parte: PARTE[p], nome: cli?.nome ?? 'Cliente', documento: cli?.cpfCnpj ?? null, representante: null };
  };
  const aplicaveis = v.itens.filter((i: Reg) => i.resultado !== 'NAO_SE_APLICA');
  const prot = protocolo();
  const conteudo = {
    protocolo: prot, titulo: c.titulo, etapa: c.rotulo, emitidoEm: iso(),
    empreendimento: { nome: emp.nome, codigo: emp.codigo, endereco: emp.endereco },
    unidade: { bloco: un.bloco, numero: un.numero, andar: un.andar, tipologia: un.tipologia },
    cedente: dadosDaParte(c.parteCedente, cedenteU?.nome ?? null),
    recebedor: dadosDaParte(c.parteRecebedora, recebedorU?.nome ?? null),
    vistoria: {
      nome: c.nomeVistoria, iniciadaEm: v.iniciadaEm, concluidaEm: v.concluidaEm, vistoriador: v.vistoriadorNome,
      acompanhante: v.acompanhante, resultado: RESULTADO[v.resultado], observacoes: v.observacoes,
      conformes: aplicaveis.filter((i: Reg) => i.resultado === 'CONFORME' || i.resultado === 'RESSALVA').length,
      aplicaveis: aplicaveis.length,
    },
    itens: v.itens.map((i: Reg) => ({
      ambiente: i.ambiente, descricao: i.descricao, resultado: RESULTADO_ITEM[i.resultado], chave: i.resultado,
      observacao: i.observacao, fotos: i.fotos.map((f: Reg) => f.id),
    })),
    pendenciasSanadas: db.pendencias
      .filter((p) => p.unidadeId === un.id && p.etapa === v.etapa && p.status === 'RESOLVIDA')
      .map((p) => ({ descricao: p.descricao, resolucao: p.resolucao, resolvidaPor: p.resolvidaPorNome, resolvidaEm: p.resolvidaEm })),
    declaracao: c.declaracao,
  };
  const sig = (parte: Parte, ordem: number, pessoa: Reg | null, extra: Reg = {}) => ({
    id: novoId('sg'), parte, ordem, nome: pessoa?.nome ?? PARTE[parte], cpf: pessoa?.cpf ?? null, email: pessoa?.email ?? null,
    status: 'PENDENTE', metodo: null, assinadoEm: null, motivoRecusa: null, urlAssinatura: null, token: null,
    assinaturaImagem: null, codigo: null, ...extra,
  });
  const doc: Reg = {
    id: novoId('dc'), unidadeId: un.id, etapa: v.etapa, vistoriaId: v.id, protocolo: prot, titulo: c.titulo,
    sha256: hash(JSON.stringify(conteudo)), sha256Assinado: null, assinado: false, criadoEm: iso(), conteudo,
    envelope: {
      id: novoId('ev'), provedor: 'INTERNO', status: 'PENDENTE', concluidoEm: null,
      signatarios: [
        sig(c.parteCedente, 1, cedenteU),
        c.recebedor === null
          ? sig('CLIENTE', 2, cli && { nome: cli.nome, cpf: cli.cpfCnpj, email: cli.email }, { token: token() })
          : sig(c.parteRecebedora, 2, recebedorU),
      ],
    },
  };
  db.documentos.push(doc);
  registrar({ acao: 'TERMO_EMITIDO', descricao: `${c.titulo} emitido com o protocolo ${prot}, aguardando assinatura das partes`, ator, unidade: un, etapa: v.etapa, entidade: 'Documento' });
  return doc;
}

function assinarSignatario(doc: Reg, s: Reg, ev: { nome: string; metodo: string; imagem?: string | null }, ator: Ator) {
  const un = db.unidades.find((x) => x.id === doc.unidadeId)!;
  if (doc.envelope.status !== 'PENDENTE' || s.status !== 'PENDENTE') invalido('Este termo não está mais aguardando esta assinatura');
  if (un.etapa !== doc.etapa || un.status !== 'AGUARDANDO_ASSINATURA') invalido('A unidade não está aguardando assinatura deste termo');
  Object.assign(s, { status: 'ASSINADO', nome: ev.nome, metodo: ev.metodo, assinadoEm: iso(), assinaturaImagem: ev.imagem ?? null, codigo: null });
  registrar({ acao: 'TERMO_ASSINADO', descricao: `${ev.nome} assinou o termo ${doc.protocolo} pela parte ${PARTE[s.parte as Parte]}`, ator, unidade: un, etapa: doc.etapa, entidade: 'Signatario' });
  if (doc.envelope.signatarios.every((x: Reg) => x.status === 'ASSINADO')) {
    doc.envelope.status = 'CONCLUIDO';
    doc.envelope.concluidoEm = iso();
    doc.assinado = true;
    doc.sha256Assinado = hash(doc.sha256 + doc.envelope.concluidoEm);
    concluirEtapa(un, ator, doc.protocolo);
  }
}

function recusarSignatario(doc: Reg, s: Reg, motivo: string, quem: string, ator: Ator) {
  const un = db.unidades.find((x) => x.id === doc.unidadeId)!;
  if (doc.envelope.status !== 'PENDENTE' || s.status !== 'PENDENTE') invalido('Este termo não está mais aguardando esta assinatura');
  Object.assign(s, { status: 'RECUSADO', nome: quem, motivoRecusa: motivo });
  doc.envelope.status = 'RECUSADO';
  db.pendencias.push({
    id: novoId('pd'), unidadeId: un.id, etapa: doc.etapa, status: 'ABERTA', criadoEm: iso(), resolucao: null, resolvidaPorNome: null, resolvidaEm: null,
    descricao: `Assinatura do termo ${doc.protocolo} recusada por ${quem} (${PARTE[s.parte as Parte]}): ${motivo}`,
  });
  mudar(un, { status: 'COM_PENDENCIAS' }, { acao: 'TERMO_RECUSADO', descricao: `${quem} (${PARTE[s.parte as Parte]}) recusou assinar o termo ${doc.protocolo}: ${motivo}`, ator });
}

function validarOpcoes(opcoes: string[]): string[] {
  const datas = [...new Set(opcoes ?? [])].map((o) => new Date(o));
  if (!datas.length || datas.some((d) => Number.isNaN(d.getTime()))) invalido('Informe ao menos um horário válido');
  if (datas.some((d) => d.getTime() < agora().getTime())) invalido('Os horários oferecidos precisam estar no futuro');
  return datas.sort((a, b) => a.getTime() - b.getTime()).map((d) => d.toISOString());
}

function propor(un: Reg, corpo: Reg, u: Usuario) {
  if (!regras.propor(u, un)) recusar();
  const c = ETAPAS[un.etapa as Etapa];
  if (c.recebedor === null && !un.clienteId) invalido('Vincule o cliente à unidade antes de agendar a vistoria com ele');
  const datas = validarOpcoes(corpo.opcoes);
  if (db.agendamentos.some((a) => a.unidadeId === un.id && a.etapa === un.etapa && ['PROPOSTO', 'CONFIRMADO'].includes(a.status))) {
    invalido('Já existe um agendamento em aberto para esta unidade. Cancele-o ou reagende.');
  }
  const ag: Reg = {
    id: novoId('ag'), unidadeId: un.id, etapa: un.etapa, status: 'PROPOSTO', dataHora: null, local: corpo.local || null,
    observacao: corpo.observacao || null, propostoPorPerfil: u.perfil, confirmadoPeloCliente: false, motivoCancelamento: null,
    tokenCliente: c.recebedor === null ? token() : null, criadoEm: iso(),
    opcoes: datas.map((inicio) => ({ id: novoId('op'), inicio, escolhida: false })),
  };
  db.agendamentos.push(ag);
  registrar({
    acao: 'AGENDAMENTO_PROPOSTO', ator: atorDe(u), unidade: un, entidade: 'Agendamento',
    descricao: `Horários oferecidos para ${c.nomeVistoria.toLowerCase()} da unidade ${rotuloUn(un)}: ${datas.map(dataHora).join(' · ')}`,
  });
  return ag;
}

function confirmar(ag: Reg, opcaoId: string, ator: Ator, peloCliente: boolean) {
  const un = db.unidades.find((x) => x.id === ag.unidadeId)!;
  if (ag.status !== 'PROPOSTO') invalido('Este agendamento não está mais aguardando confirmação');
  const opcao = ag.opcoes.find((o: Reg) => o.id === opcaoId);
  if (!opcao) invalido('Horário não pertence a este agendamento');
  if (new Date(opcao.inicio).getTime() < agora().getTime()) invalido('Este horário já passou. Peça novas opções.');
  opcao.escolhida = true;
  Object.assign(ag, { status: 'CONFIRMADO', dataHora: opcao.inicio, confirmadoPeloCliente: peloCliente });
  const c = ETAPAS[ag.etapa as Etapa];
  mudar(un, { status: 'VISTORIA_AGENDADA' }, {
    acao: 'AGENDAMENTO_CONFIRMADO', ator,
    descricao: `${c.nomeVistoria} da unidade ${rotuloUn(un)} confirmada para ${dataHora(opcao.inicio)}` +
      (peloCliente ? ' pelo cliente, no link de agendamento' : c.recebedor === null ? ' — registrada pelo Relacionamento em nome do cliente' : ''),
  });
}

function cancelarAg(ag: Reg, motivo: string, ator: Ator) {
  const un = db.unidades.find((x) => x.id === ag.unidadeId)!;
  if (!['PROPOSTO', 'CONFIRMADO'].includes(ag.status)) invalido('Este agendamento não está mais em aberto');
  const eraConfirmado = ag.status === 'CONFIRMADO';
  const quando = ag.dataHora ? ` de ${dataHora(ag.dataHora)}` : '';
  Object.assign(ag, { status: 'CANCELADO', motivoCancelamento: motivo });
  const ev = { acao: 'AGENDAMENTO_CANCELADO', descricao: `Agendamento${quando} da unidade ${rotuloUn(un)} cancelado: ${motivo}`, ator };
  if (eraConfirmado && un.status === 'VISTORIA_AGENDADA') mudar(un, { status: 'AGUARDANDO_AGENDAMENTO' }, ev);
  else registrar({ ...ev, unidade: un, etapa: ag.etapa });
}

function vistoriaDe(id: string, u: Usuario) {
  const v = db.vistorias.find((x) => x.id === id);
  if (!v || !etapasVisiveis(u.perfil).includes(v.etapa)) return sumiu('Vistoria não encontrada');
  return { v, un: unidade(v.unidadeId, u) };
}

function agendamentoVisivel(ag: Reg, u: Usuario) {
  const un = db.unidades.find((x) => x.id === ag.unidadeId)!;
  const cli = clienteDe(un);
  const emp = empDe(un);
  return {
    ...ag, tokenCliente: undefined,
    unidade: { id: un.id, bloco: un.bloco, numero: un.numero, empreendimento: { nome: emp.nome, codigo: emp.codigo }, cliente: u.perfil === 'CONSTRUTORA' || !cli ? null : { nome: cli.nome } },
    podeConfirmar: regras.confirmar(u, ag), podeCancelar: regras.cancelarAg(u, ag),
  };
}

// ---------- rotas ----------

interface Pedido {
  u: Usuario;
  corpo: any;
  q: Record<string, string>;
}
// 'conta-teste': a troca de perfil vale mesmo quando o perfil atual é só de leitura
type Rota = [string, RegExp, (p: Pedido, ...ids: string[]) => unknown, ('publica' | 'conta-teste')?];

const rotas: Rota[] = [
  ['POST', /^\/auth\/login$/, ({ corpo }) => {
    const usuario = db.usuarios.find((x) => x.email === String(corpo.email).toLowerCase());
    if (!usuario) throw new Falha(401, 'E-mail ou senha inválidos');
    const u: Usuario = { sub: usuario.id, nome: usuario.nome, email: usuario.email, perfil: usuario.perfil, organizacaoId: usuario.organizacaoId, organizacaoNome: orgNome(usuario.organizacaoId), ...(usuario.contaTeste ? { contaTeste: true, perfilReal: usuario.perfil } : {}) };
    return { accessToken: `demo.${usuario.id}`, usuario: u };
  }, 'publica'],
  ['GET', /^\/auth\/perfis-de-teste$/, ({ u }) => (u.contaTeste ? perfisDeTeste() : recusar('Só uma conta de teste pode trocar de perfil'))],
  ['POST', /^\/auth\/ver-como$/, ({ u, corpo }) => {
    if (!u.contaTeste) recusar('Só uma conta de teste pode trocar de perfil');
    const opcao = perfisDeTeste().find((o) => o.perfil === corpo.perfil && (o.organizacaoId ?? null) === (corpo.organizacaoId ?? null)) ?? invalido('Perfil de teste inválido');
    registrar({ acao: 'CONTA_TESTE_VER_COMO', descricao: `${u.nome} passou a ver o sistema como ${opcao.rotulo}`, ator: atorDe(u), entidade: 'Usuario' });
    return {
      accessToken: `demo.${u.sub}.${opcao.perfil}.${opcao.organizacaoId ?? ''}`,
      usuario: { ...u, perfil: opcao.perfil, organizacaoId: opcao.organizacaoId, organizacaoNome: orgNome(opcao.organizacaoId) },
    };
  }, 'conta-teste'],
  ['GET', /^\/auth\/me$/, ({ u }) => u],
  ['POST', /^\/auth\/trocar-senha$/, () => ({ ok: true })],

  ['GET', /^\/dashboard$/, ({ u }) => {
    const visiveis = etapasVisiveis(u.perfil);
    const minhas = db.unidades.filter((un) => noEscopo(u, un));
    const fila: Reg[] = [];
    for (const un of minhas) {
      if (un.status === 'ENTREGUE' || !visiveis.includes(un.etapa)) continue;
      const c = ETAPAS[un.etapa as Etapa];
      const base = { unidadeId: un.id, unidade: rotuloUn(un), empreendimento: empDe(un).nome, desde: un.atualizadoEm };
      const proposta = db.agendamentos.find((a) => a.unidadeId === un.id && a.etapa === un.etapa && a.status === 'PROPOSTO');
      if (regras.liberar(u, un)) fila.push({ ...base, acao: 'Liberar a unidade' });
      else if (proposta && !admin(u) && regras.confirmar(u, proposta)) fila.push({ ...base, acao: c.recebedor === null ? 'Aguardando o cliente escolher o horário' : 'Escolher o horário da vistoria' });
      else if (!proposta && regras.propor(u, un)) fila.push({ ...base, acao: 'Oferecer horários de vistoria' });
      else if (regras.iniciar(u, un)) fila.push({ ...base, acao: `Iniciar ${c.nomeVistoria.toLowerCase()}` });
      else if (un.status === 'EM_VISTORIA' && regras.conduzir(u, un.etapa)) fila.push({ ...base, acao: 'Concluir a vistoria em andamento' });
      else if (regras.pendencias(u, un)) fila.push({ ...base, acao: 'Sanar pendências' });
    }
    for (const d of db.documentos) {
      const un = db.unidades.find((x) => x.id === d.unidadeId)!;
      if (d.envelope.status !== 'PENDENTE' || !noEscopo(u, un) || !visiveis.includes(d.etapa)) continue;
      for (const s of d.envelope.signatarios) {
        if (s.status === 'PENDENTE' && perfilDaParte(s.parte) === u.perfil) {
          fila.push({ unidadeId: un.id, unidade: rotuloUn(un), empreendimento: empDe(un).nome, acao: `Assinar o termo ${d.protocolo}`, desde: d.criadoEm });
        }
      }
    }
    fila.sort((a, b) => a.desde.localeCompare(b.desde));
    const emAndamento = minhas.filter((un) => un.status !== 'ENTREGUE');
    return {
      etapas: ORDEM.map((etapa) => {
        const daEtapa = emAndamento.filter((un) => un.etapa === etapa);
        const porStatus = [...new Set(daEtapa.map((un) => un.status))].map((status) => ({ status, total: daEtapa.filter((un) => un.status === status).length }));
        return { etapa, ordem: ETAPAS[etapa].ordem, rotulo: ETAPAS[etapa].rotulo, visivel: visiveis.includes(etapa), total: daEtapa.length, porStatus };
      }),
      totalUnidades: minhas.length,
      entregues: minhas.length - emAndamento.length,
      fila,
      proximosAgendamentos: db.agendamentos
        .filter((a) => a.status === 'CONFIRMADO' && visiveis.includes(a.etapa) && noEscopo(u, db.unidades.find((x) => x.id === a.unidadeId)!))
        .sort((a, b) => a.dataHora.localeCompare(b.dataHora)).slice(0, 8)
        .map((a) => {
          const un = db.unidades.find((x) => x.id === a.unidadeId)!;
          return { id: a.id, unidadeId: un.id, unidade: rotuloUn(un), empreendimento: empDe(un).nome, etapa: a.etapa, dataHora: a.dataHora, local: a.local };
        }),
    };
  }],

  // ----- cadastros -----
  ['GET', /^\/organizacoes$/, () => db.orgs],
  ['POST', /^\/organizacoes$/, ({ u, corpo }) => { if (!admin(u)) recusar('Perfil sem permissão para esta operação'); const o = { id: novoId('og'), ativo: true, ...corpo }; db.orgs.push(o); return o; }],
  ['PATCH', /^\/organizacoes\/(\w+)$/, ({ u, corpo }, id) => { if (!admin(u)) recusar('Perfil sem permissão para esta operação'); return Object.assign(db.orgs.find((o) => o.id === id)!, corpo); }],
  ['GET', /^\/empreendimentos$/, ({ u }) =>
    db.emps.filter((e) => u.perfil !== 'CONSTRUTORA' || e.construtoraId === u.organizacaoId).map((e) => ({
      ...e, construtora: { nome: orgNome(e.construtoraId) }, incorporadora: e.incorporadoraId ? { nome: orgNome(e.incorporadoraId) } : null,
      _count: { unidades: db.unidades.filter((un) => un.empreendimentoId === e.id).length },
    }))],
  ['POST', /^\/empreendimentos$/, ({ u, corpo }) => {
    if (!regras.cadastrar(u)) recusar('Perfil sem permissão para esta operação');
    if (db.emps.some((e) => e.codigo === String(corpo.codigo).toUpperCase())) throw new Falha(409, 'Já existe um empreendimento com este código');
    const e = { id: novoId('em'), ativo: true, endereco: null, incorporadoraId: null, ...corpo, codigo: String(corpo.codigo).toUpperCase() };
    db.emps.push(e);
    registrar({ acao: 'EMPREENDIMENTO_CRIADO', descricao: `Empreendimento ${e.nome} (${e.codigo}) cadastrado`, ator: atorDe(u), entidade: 'Empreendimento' });
    return e;
  }],
  ['PATCH', /^\/empreendimentos\/(\w+)$/, ({ u, corpo }, id) => { if (!regras.cadastrar(u)) recusar('Perfil sem permissão para esta operação'); return Object.assign(db.emps.find((e) => e.id === id)!, corpo); }],
  ['GET', /^\/clientes$/, ({ u, q }) => {
    if (!regras.clientes(u) && u.perfil !== 'AUDITOR') recusar('Perfil sem permissão para esta operação');
    const termo = (q.busca ?? '').toLowerCase();
    return db.clientes
      .filter((c) => !termo || c.nome.toLowerCase().includes(termo) || c.cpfCnpj.includes(termo.replace(/\D/g, '') || '#'))
      .map((c) => ({ ...c, _count: { unidades: db.unidades.filter((un) => un.clienteId === c.id).length } }));
  }],
  ['POST', /^\/clientes$/, ({ u, corpo }) => {
    if (!regras.clientes(u)) recusar('Perfil sem permissão para esta operação');
    const cpfCnpj = String(corpo.cpfCnpj ?? '').replace(/\D/g, '');
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) invalido('CPF/CNPJ inválido');
    if (db.clientes.some((c) => c.cpfCnpj === cpfCnpj)) throw new Falha(409, 'Já existe um cliente com este CPF/CNPJ');
    const c = { id: novoId('cl'), nome: corpo.nome, cpfCnpj, email: corpo.email || null, telefone: corpo.telefone || null };
    db.clientes.push(c);
    registrar({ acao: 'CLIENTE_CRIADO', descricao: `Cliente ${c.nome} cadastrado`, ator: atorDe(u), entidade: 'Cliente', etapa: 'RELACIONAMENTO_CLIENTE' });
    return c;
  }],
  ['PATCH', /^\/clientes\/(\w+)$/, ({ u, corpo }, id) => {
    if (!regras.clientes(u)) recusar('Perfil sem permissão para esta operação');
    return Object.assign(db.clientes.find((c) => c.id === id)!, { ...corpo, cpfCnpj: String(corpo.cpfCnpj).replace(/\D/g, ''), email: corpo.email || null });
  }],
  ['GET', /^\/usuarios$/, ({ u }) => {
    if (!admin(u) && u.perfil !== 'AUDITOR') recusar('Perfil sem permissão para esta operação');
    return db.usuarios.map((x) => ({ ...x, organizacao: x.organizacaoId ? { nome: orgNome(x.organizacaoId) } : null }));
  }],
  ['POST', /^\/usuarios$/, ({ u, corpo }) => { if (!admin(u)) recusar('Perfil sem permissão para esta operação'); const n = { id: novoId('us'), ativo: true, cpf: null, organizacaoId: null, ...corpo, senha: undefined }; db.usuarios.push(n); return n; }],
  ['PATCH', /^\/usuarios\/(\w+)$/, ({ u, corpo }, id) => { if (!admin(u)) recusar('Perfil sem permissão para esta operação'); return Object.assign(db.usuarios.find((x) => x.id === id)!, { ...corpo, senha: undefined }); }],
  ['GET', /^\/pauta$/, () => db.pauta],
  ['POST', /^\/pauta$/, ({ u, corpo }) => { if (!admin(u)) recusar('Perfil sem permissão para esta operação'); const p = { id: novoId('pt'), ordem: 0, ativo: true, ...corpo }; db.pauta.push(p); return p; }],
  ['PATCH', /^\/pauta\/(\w+)$/, ({ u, corpo }, id) => { if (!admin(u)) recusar('Perfil sem permissão para esta operação'); return Object.assign(db.pauta.find((p) => p.id === id)!, corpo); }],

  // ----- unidades -----
  ['GET', /^\/unidades$/, ({ u, q }) => {
    const termo = (q.busca ?? '').toLowerCase();
    return db.unidades
      .filter((un) => noEscopo(u, un))
      .filter((un) => (!q.empreendimentoId || un.empreendimentoId === q.empreendimentoId) && (!q.etapa || un.etapa === q.etapa) && (!q.status || un.status === q.status))
      .filter((un) => !termo || un.numero.toLowerCase().includes(termo) || un.bloco.toLowerCase().includes(termo) || (u.perfil !== 'CONSTRUTORA' && (clienteDe(un)?.nome ?? '').toLowerCase().includes(termo)))
      .map((un) => {
        const emp = empDe(un);
        const cli = clienteDe(un);
        return {
          ...un, empreendimento: { id: emp.id, nome: emp.nome, codigo: emp.codigo },
          cliente: u.perfil === 'CONSTRUTORA' || !cli ? null : { id: cli.id, nome: cli.nome },
          pendenciasAbertas: db.pendencias.filter((p) => p.unidadeId === un.id && p.status === 'ABERTA').length,
        };
      })
      .sort((a: Reg, b: Reg) => a.empreendimento.nome.localeCompare(b.empreendimento.nome) || a.bloco.localeCompare(b.bloco) || a.numero.localeCompare(b.numero));
  }],
  ['POST', /^\/unidades$/, ({ u, corpo }) => {
    if (!regras.cadastrar(u)) recusar();
    const emp = db.emps.find((e) => e.id === corpo.empreendimentoId) ?? invalido('Empreendimento não encontrado');
    const bloco = (corpo.bloco ?? '').trim();
    const numeros: string[] = [...new Set((corpo.numeros as string[]).map((n) => n.trim()).filter(Boolean))];
    const repetidas = numeros.filter((n) => db.unidades.some((un) => un.empreendimentoId === emp.id && un.bloco === bloco && un.numero === n));
    if (repetidas.length) throw new Falha(409, `Já cadastradas neste empreendimento/bloco: ${repetidas.join(', ')}`);
    return numeros.map((numero) => {
      const un: Reg = { id: novoId('un'), empreendimentoId: emp.id, bloco, numero, andar: corpo.andar || null, tipologia: corpo.tipologia || null, clienteId: null, etapa: 'CONSTRUTORA_INCORPORADORA', status: 'AGUARDANDO_LIBERACAO', liberadaPorId: null, atualizadoEm: iso() };
      db.unidades.push(un);
      registrar({ acao: 'UNIDADE_CADASTRADA', descricao: `Unidade ${rotuloUn(un)} cadastrada em ${emp.nome}`, ator: atorDe(u), unidade: un, novo: estado(un.etapa, un.status) });
      return un;
    });
  }],
  ['GET', /^\/unidades\/(\w+)$/, ({ u }, id) => {
    const un = unidade(id, u);
    const visiveis = etapasVisiveis(u.perfil);
    const emp = empDe(un);
    const relac = u.perfil === 'RELACIONAMENTO' || admin(u);
    const c = ETAPAS[un.etapa as Etapa];
    return {
      unidade: { ...un, empreendimento: { id: emp.id, nome: emp.nome, codigo: emp.codigo, endereco: emp.endereco }, cliente: u.perfil === 'CONSTRUTORA' ? null : clienteDe(un) },
      etapa: { ...c, chave: un.etapa },
      permissoes: {
        liberar: regras.liberar(u, un), proporHorarios: regras.propor(u, un), iniciarVistoria: regras.iniciar(u, un),
        resolverPendencias: regras.pendencias(u, un), editar: regras.cadastrar(u),
        anotar: u.perfil !== 'AUDITOR' && visiveis.includes(un.etapa),
        vincularCliente: regras.clientes(u) && un.status !== 'ENTREGUE',
      },
      agendamentos: db.agendamentos.filter((a) => a.unidadeId === id && visiveis.includes(a.etapa)).slice().reverse()
        .map((a) => ({ ...a, tokenCliente: relac ? a.tokenCliente : null, podeConfirmar: regras.confirmar(u, a), podeCancelar: regras.cancelarAg(u, a) })),
      vistorias: db.vistorias.filter((v) => v.unidadeId === id && visiveis.includes(v.etapa)).slice().reverse()
        .map((v) => ({ ...v, itens: undefined, totalItens: v.itens.length, podeConduzir: regras.conduzir(u, v.etapa) })),
      pendencias: db.pendencias.filter((p) => p.unidadeId === id && visiveis.includes(p.etapa)),
      documentos: db.documentos.filter((d) => d.unidadeId === id && visiveis.includes(d.etapa)).slice().reverse().map((d) => ({
        ...d, conteudo: undefined,
        envelope: {
          ...d.envelope,
          signatarios: d.envelope.signatarios.map((s: Reg) => ({
            ...s, assinaturaImagem: undefined, codigo: undefined,
            email: relac || s.parte !== 'CLIENTE' ? s.email : null,
            token: relac && s.status === 'PENDENTE' ? s.token : null,
            podeAssinar: regras.assinar(u, s, d.envelope),
          })),
        },
      })),
    };
  }],
  ['PATCH', /^\/unidades\/(\w+)$/, ({ u, corpo }, id) => {
    const un = unidade(id, u);
    if (corpo.clienteId !== undefined && corpo.clienteId !== un.clienteId) {
      if (!regras.clientes(u)) recusar();
      if (un.etapa === 'RELACIONAMENTO_CLIENTE' && un.status !== 'AGUARDANDO_AGENDAMENTO') {
        invalido('Há agendamento, vistoria ou termo em andamento com o cliente atual. Cancele-os antes de trocar o titular.');
      }
      const novo = db.clientes.find((c) => c.id === corpo.clienteId);
      un.clienteId = corpo.clienteId;
      registrar({
        acao: 'CLIENTE_VINCULADO', ator: atorDe(u), unidade: un, etapa: 'RELACIONAMENTO_CLIENTE',
        descricao: novo ? `Cliente ${novo.nome} vinculado à unidade ${rotuloUn(un)}` : `Cliente desvinculado da unidade ${rotuloUn(un)}`,
      });
    }
    return un;
  }],
  ['GET', /^\/unidades\/(\w+)\/historico$/, ({ u }, id) => {
    unidade(id, u);
    const visiveis = etapasVisiveis(u.perfil);
    return db.eventos.filter((e) => e.unidadeId === id && (u.perfil !== 'CONSTRUTORA' || !e.etapa || visiveis.includes(e.etapa)));
  }],
  ['POST', /^\/unidades\/(\w+)\/liberar$/, ({ u, corpo }, id) => {
    const un = unidade(id, u);
    const c = ETAPAS[un.etapa as Etapa];
    if (un.status === 'COM_PENDENCIAS') {
      if (!regras.pendencias(u, un)) recusar();
      const abertas = db.pendencias.filter((p) => p.unidadeId === id && p.etapa === un.etapa && p.status === 'ABERTA').length;
      if (abertas) invalido(`Ainda há ${abertas} pendência(s) em aberto. Registre a resolução de cada uma antes de reapresentar a unidade.`);
      mudar(un, { status: statusAposLiberacao(un.etapa) }, { acao: 'UNIDADE_REAPRESENTADA', ator: atorDe(u), descricao: `Pendências sanadas: unidade ${rotuloUn(un)} reapresentada para ${c.nomeVistoria.toLowerCase()}` });
      return un;
    }
    if (!regras.liberar(u, un)) recusar();
    un.liberadaPorId = u.sub;
    mudar(un, { status: statusAposLiberacao(un.etapa) }, {
      acao: 'UNIDADE_LIBERADA', ator: atorDe(u),
      descricao: `Unidade ${rotuloUn(un)} liberada na etapa "${c.rotulo}"${corpo?.observacao ? ` — ${corpo.observacao}` : ''}`,
    });
    return un;
  }],
  ['POST', /^\/unidades\/(\w+)\/anotacoes$/, ({ u, corpo }, id) => {
    const un = unidade(id, u);
    if (u.perfil === 'AUDITOR') recusar('Perfil somente leitura: esta ação não é permitida');
    if (!etapasVisiveis(u.perfil).includes(un.etapa)) recusar('A unidade já passou da etapa em que a sua empresa participa');
    registrar({ acao: 'ANOTACAO', descricao: String(corpo.texto).trim(), ator: atorDe(u), unidade: un });
    return { ok: true };
  }],
  ['POST', /^\/pendencias\/(\w+)\/resolver$/, ({ u, corpo }, id) => {
    const p = db.pendencias.find((x) => x.id === id) ?? sumiu('Pendência não encontrada');
    const un = unidade(p.unidadeId, u);
    if (!regras.pendencias(u, un)) recusar();
    Object.assign(p, { status: 'RESOLVIDA', resolucao: corpo.resolucao, resolvidaPorNome: u.nome, resolvidaEm: iso() });
    registrar({ acao: 'PENDENCIA_RESOLVIDA', descricao: `Pendência resolvida: ${p.descricao} — ${corpo.resolucao}`, ator: atorDe(u), unidade: un, entidade: 'Pendencia' });
    return p;
  }],

  // ----- agendamentos -----
  ['GET', /^\/agendamentos$/, ({ u, q }) => {
    const visiveis = etapasVisiveis(u.perfil);
    const de = q.de ? new Date(q.de).getTime() : -Infinity;
    const ate = q.ate ? new Date(q.ate).getTime() : Infinity;
    const dentro = (d: string) => new Date(d).getTime() >= de && new Date(d).getTime() <= ate;
    return db.agendamentos
      .filter((a) => visiveis.includes(a.etapa) && (!q.etapa || a.etapa === q.etapa) && a.status !== 'CANCELADO')
      .filter((a) => noEscopo(u, db.unidades.find((x) => x.id === a.unidadeId)!))
      .filter((a) => (a.dataHora ? dentro(a.dataHora) : a.opcoes.some((o: Reg) => dentro(o.inicio))))
      .sort((a, b) => (a.dataHora ?? '').localeCompare(b.dataHora ?? ''))
      .map((a) => agendamentoVisivel(a, u));
  }],
  ['POST', /^\/unidades\/(\w+)\/agendamentos$/, ({ u, corpo }, id) => propor(unidade(id, u), corpo, u)],
  ['POST', /^\/agendamentos\/(\w+)\/confirmar$/, ({ u, corpo }, id) => {
    const ag = db.agendamentos.find((a) => a.id === id) ?? sumiu('Agendamento não encontrado');
    unidade(ag.unidadeId, u);
    if (!regras.confirmar(u, ag)) recusar('A escolha do horário cabe à outra parte');
    if (ETAPAS[ag.etapa as Etapa].recebedor === null && !String(corpo.observacao ?? '').trim()) {
      invalido('Registre como o cliente confirmou o horário (telefone, WhatsApp, e-mail...)');
    }
    confirmar(ag, corpo.opcaoId, atorDe(u), false);
    return ag;
  }],
  ['POST', /^\/agendamentos\/(\w+)\/cancelar$/, ({ u, corpo }, id) => {
    const ag = db.agendamentos.find((a) => a.id === id) ?? sumiu('Agendamento não encontrado');
    unidade(ag.unidadeId, u);
    if (!regras.cancelarAg(u, ag)) recusar();
    cancelarAg(ag, corpo.motivo, atorDe(u));
    return ag;
  }],
  ['POST', /^\/agendamentos\/(\w+)\/reagendar$/, ({ u, corpo }, id) => {
    const ag = db.agendamentos.find((a) => a.id === id) ?? sumiu('Agendamento não encontrado');
    const un = unidade(ag.unidadeId, u);
    if (!regras.cancelarAg(u, ag)) recusar();
    validarOpcoes(corpo.opcoes);
    cancelarAg(ag, `Reagendamento: ${corpo.motivo}`, atorDe(u));
    return propor(un, corpo, u);
  }],

  // ----- vistorias -----
  ['POST', /^\/unidades\/(\w+)\/vistorias$/, ({ u }, id) => {
    const un = unidade(id, u);
    if (!regras.iniciar(u, un)) recusar();
    const c = ETAPAS[un.etapa as Etapa];
    const pauta = db.pauta.filter((p) => p.etapa === un.etapa && p.ativo).sort((a, b) => a.ordem - b.ordem);
    const ag = db.agendamentos.find((a) => a.unidadeId === id && a.etapa === un.etapa && a.status === 'CONFIRMADO');
    if (ag) ag.status = 'REALIZADO';
    const v: Reg = {
      id: novoId('vs'), unidadeId: id, etapa: un.etapa, status: 'EM_ANDAMENTO', resultado: null, vistoriadorId: u.sub, vistoriadorNome: u.nome,
      acompanhante: null, observacoes: null, iniciadaEm: iso(), concluidaEm: null,
      itens: pauta.map((p, i) => ({ id: novoId('it'), ambiente: p.ambiente, descricao: p.descricao, ordem: i, resultado: null, observacao: null, fotos: [] })),
    };
    db.vistorias.push(v);
    mudar(un, { status: 'EM_VISTORIA' }, { acao: 'VISTORIA_INICIADA', ator: atorDe(u), descricao: `${c.nomeVistoria} da unidade ${rotuloUn(un)} iniciada por ${u.nome} (${pauta.length} itens)` });
    return v;
  }],
  ['GET', /^\/vistorias\/(\w+)$/, ({ u }, id) => {
    const { v, un } = vistoriaDe(id, u);
    const c = ETAPAS[v.etapa as Etapa];
    return {
      ...v, nome: c.nomeVistoria, etapaRotulo: c.rotulo, comCliente: c.recebedor === null,
      unidade: { id: un.id, rotulo: rotuloUn(un), empreendimento: empDe(un).nome },
      podeConduzir: v.status === 'EM_ANDAMENTO' && regras.conduzir(u, v.etapa),
      itens: v.itens.map((i: Reg) => ({ ...i, fotos: i.fotos.map((f: Reg) => ({ id: f.id, nomeOriginal: f.nomeOriginal })) })),
    };
  }],
  ['PATCH', /^\/vistorias\/(\w+)\/itens\/(\w+)$/, ({ u, corpo }, id, itemId) => {
    const { v, un } = vistoriaDe(id, u);
    if (v.status !== 'EM_ANDAMENTO') invalido('Esta vistoria já foi encerrada');
    if (!regras.conduzir(u, v.etapa)) recusar();
    const item = v.itens.find((i: Reg) => i.id === itemId) ?? sumiu('Item não encontrado');
    if (corpo.resultado !== undefined) item.resultado = corpo.resultado;
    if (corpo.observacao !== undefined) item.observacao = String(corpo.observacao).trim() || null;
    registrar({
      acao: 'VISTORIA_ITEM_AVALIADO', ator: atorDe(u), unidade: un, etapa: v.etapa, entidade: 'VistoriaItem',
      descricao: `${item.ambiente} · ${item.descricao}: ${item.resultado ? RESULTADO_ITEM[item.resultado] : 'sem avaliação'}${item.observacao ? ` — ${item.observacao}` : ''}`,
    });
    return item;
  }],
  ['POST', /^\/vistorias\/(\w+)\/itens\/(\w+)\/fotos$/, ({ u, corpo }, id, itemId) => {
    const { v, un } = vistoriaDe(id, u);
    if (v.status !== 'EM_ANDAMENTO') invalido('Esta vistoria já foi encerrada');
    if (!regras.conduzir(u, v.etapa)) recusar();
    const item = v.itens.find((i: Reg) => i.id === itemId) ?? sumiu('Item não encontrado');
    const arquivos = corpo instanceof FormData ? (corpo.getAll('fotos') as File[]) : [];
    return arquivos.map((arquivo) => {
      const foto = { id: novoId('ft'), nomeOriginal: arquivo.name || 'foto.jpg', blob: arquivo };
      item.fotos.push(foto);
      registrar({ acao: 'VISTORIA_FOTO_ADICIONADA', descricao: `Foto adicionada em ${item.ambiente} · ${item.descricao}`, ator: atorDe(u), unidade: un, etapa: v.etapa, entidade: 'Foto' });
      return { id: foto.id, nomeOriginal: foto.nomeOriginal };
    });
  }],
  ['GET', /^\/fotos\/(\w+)$/, (_p, id) => {
    for (const v of db.vistorias) for (const i of v.itens) for (const f of i.fotos) if (f.id === id) return f.blob;
    return sumiu('Foto não encontrada');
  }],
  ['DELETE', /^\/fotos\/(\w+)$/, ({ u }, id) => {
    for (const v of db.vistorias) {
      for (const i of v.itens) {
        const indice = i.fotos.findIndex((f: Reg) => f.id === id);
        if (indice < 0) continue;
        if (v.status !== 'EM_ANDAMENTO') invalido('Esta vistoria já foi encerrada');
        i.fotos.splice(indice, 1);
        registrar({ acao: 'VISTORIA_FOTO_REMOVIDA', descricao: `Foto removida de ${i.ambiente} · ${i.descricao}`, ator: atorDe(u), unidade: db.unidades.find((x) => x.id === v.unidadeId), etapa: v.etapa, entidade: 'Foto' });
        return { ok: true };
      }
    }
    return sumiu('Foto não encontrada');
  }],
  ['POST', /^\/vistorias\/(\w+)\/concluir$/, ({ u, corpo }, id) => {
    const { v, un } = vistoriaDe(id, u);
    if (v.status !== 'EM_ANDAMENTO') invalido('Esta vistoria já foi encerrada');
    if (!regras.conduzir(u, v.etapa)) recusar();
    const c = ETAPAS[v.etapa as Etapa];
    const itens: Reg[] = v.itens;
    const faltam = itens.filter((i) => !i.resultado);
    if (faltam.length) invalido(`Faltam ${faltam.length} item(ns) para avaliar. Primeiro: ${faltam[0].ambiente} · ${faltam[0].descricao}`);
    const semObs = itens.find((i) => ['NAO_CONFORME', 'RESSALVA'].includes(i.resultado) && !i.observacao);
    if (semObs) invalido(`Descreva o problema em "${semObs.ambiente} · ${semObs.descricao}": itens não conformes ou com ressalva exigem observação.`);
    const acompanhante = String(corpo?.acompanhante ?? '').trim() || null;
    if (c.recebedor !== null && c.exigeAgendamento && !acompanhante) invalido('Informe quem acompanhou a vistoria pela construtora');
    const ruins = itens.filter((i) => i.resultado === 'NAO_CONFORME');
    const ressalvas = itens.filter((i) => i.resultado === 'RESSALVA');
    const resultado = ruins.length ? 'REPROVADA' : ressalvas.length ? 'APROVADA_COM_RESSALVAS' : 'APROVADA';
    Object.assign(v, { status: 'CONCLUIDA', resultado, acompanhante, observacoes: String(corpo?.observacoes ?? '').trim() || null, concluidaEm: iso() });
    if (resultado === 'REPROVADA') {
      for (const i of ruins) {
        db.pendencias.push({ id: novoId('pd'), unidadeId: un.id, etapa: v.etapa, status: 'ABERTA', criadoEm: iso(), resolucao: null, resolvidaPorNome: null, resolvidaEm: null, descricao: `${i.ambiente} · ${i.descricao}: ${i.observacao}` });
      }
      mudar(un, { status: 'COM_PENDENCIAS' }, { acao: 'VISTORIA_CONCLUIDA', ator: atorDe(u), descricao: `${c.nomeVistoria} da unidade ${rotuloUn(un)} REPROVADA: ${ruins.length} item(ns) não conforme(s) viraram pendências` });
      return { resultado, envelopeId: null, protocolo: null };
    }
    mudar(un, { status: 'AGUARDANDO_ASSINATURA' }, { acao: 'VISTORIA_CONCLUIDA', ator: atorDe(u), descricao: `${c.nomeVistoria} da unidade ${rotuloUn(un)} concluída: ${RESULTADO[resultado]}` });
    const doc = emitirTermo(v, atorDe(u));
    return { resultado, envelopeId: doc.envelope.id, protocolo: doc.protocolo };
  }],
  ['POST', /^\/vistorias\/(\w+)\/cancelar$/, ({ u, corpo }, id) => {
    const { v, un } = vistoriaDe(id, u);
    if (v.status !== 'EM_ANDAMENTO') invalido('Esta vistoria já foi encerrada');
    if (!regras.conduzir(u, v.etapa)) recusar();
    Object.assign(v, { status: 'CANCELADA', observacoes: corpo.motivo, concluidaEm: iso() });
    mudar(un, { status: statusAposLiberacao(un.etapa) }, { acao: 'VISTORIA_CANCELADA', ator: atorDe(u), descricao: `${ETAPAS[v.etapa as Etapa].nomeVistoria} da unidade ${rotuloUn(un)} cancelada: ${corpo.motivo}` });
    return { ok: true };
  }],

  // ----- termos e assinaturas -----
  ['GET', /^\/documentos\/(\w+)\/pdf$/, ({ u }, id) => {
    const d = db.documentos.find((x) => x.id === id);
    if (!d || !etapasVisiveis(u.perfil).includes(d.etapa)) return sumiu('Documento não encontrado');
    const un = unidade(d.unidadeId, u);
    registrar({ acao: 'DOCUMENTO_BAIXADO', descricao: `Termo ${d.protocolo} aberto`, ator: atorDe(u), unidade: un, etapa: d.etapa, entidade: 'Documento' });
    return previa(d);
  }],
  ['POST', /^\/signatarios\/(\w+)\/assinar$/, ({ u, corpo }, id) => {
    const { doc, s } = signatario(id);
    unidade(doc.unidadeId, u);
    if (!regras.assinar(u, s, doc.envelope)) recusar('Esta assinatura cabe a outra parte');
    if (!String(corpo.senha ?? '')) recusar('Senha incorreta');
    assinarSignatario(doc, s, { nome: u.nome, metodo: 'SESSAO_AUTENTICADA', imagem: corpo.assinaturaImagem }, atorDe(u));
    return { ok: true };
  }],
  ['POST', /^\/signatarios\/(\w+)\/recusar$/, ({ u, corpo }, id) => {
    const { doc, s } = signatario(id);
    unidade(doc.unidadeId, u);
    if (!regras.assinar(u, s, doc.envelope)) recusar('Esta assinatura cabe a outra parte');
    recusarSignatario(doc, s, corpo.motivo, u.nome, atorDe(u));
    return { ok: true };
  }],
  ['POST', /^\/envelopes\/(\w+)\/cancelar$/, ({ u, corpo }, id) => {
    const doc = db.documentos.find((d) => d.envelope.id === id) ?? sumiu('Termo não encontrado');
    const un = unidade(doc.unidadeId, u);
    if (!regras.conduzir(u, doc.etapa)) recusar();
    if (doc.envelope.status !== 'PENDENTE') invalido('Só é possível anular um termo que ainda aguarda assinaturas');
    doc.envelope.status = 'CANCELADO';
    mudar(un, { status: statusAposLiberacao(un.etapa) }, { acao: 'TERMO_ANULADO', ator: atorDe(u), descricao: `Termo ${doc.protocolo} anulado antes da conclusão das assinaturas: ${corpo.motivo}` });
    return { ok: true };
  }],

  // ----- auditoria -----
  ['GET', /^\/auditoria$/, ({ u, q }) => {
    if (!admin(u) && u.perfil !== 'AUDITOR') recusar('Perfil sem permissão para esta operação');
    const termo = (q.busca ?? '').toLowerCase();
    const filtrados = db.eventos
      .filter((e) => (!q.acao || e.acao === q.acao) && (!q.unidadeId || e.unidadeId === q.unidadeId))
      .filter((e) => !termo || e.descricao.toLowerCase().includes(termo) || e.atorNome.toLowerCase().includes(termo))
      .filter((e) => (!q.de || e.criadoEm >= q.de) && (!q.ate || e.criadoEm <= q.ate))
      .slice().reverse();
    const pagina = Number(q.pagina) || 1;
    return { total: filtrados.length, pagina, porPagina: 50, eventos: filtrados.slice((pagina - 1) * 50, pagina * 50) };
  }],
  ['GET', /^\/auditoria\/acoes$/, () => [...new Set(db.eventos.map((e) => e.acao))].sort()],
  ['GET', /^\/auditoria\/verificar$/, ({ u }) => {
    if (!admin(u) && u.perfil !== 'AUDITOR') recusar('Perfil sem permissão para esta operação');
    return { integra: true, conferidos: db.eventos.length, primeiroEventoInvalido: null, ultimoHash: db.eventos[db.eventos.length - 1]?.hash ?? '' };
  }],

  // ----- cliente, sem login -----
  ['GET', /^\/publico\/agendamento\/(\w+)$/, (_p, tk) => {
    const ag = agendamentoPorToken(tk);
    const un = db.unidades.find((x) => x.id === ag.unidadeId)!;
    const cli = clienteDe(un);
    return {
      status: ag.status, dataHora: ag.dataHora, local: ag.local, observacao: ag.observacao, empreendimento: empDe(un).nome,
      endereco: empDe(un).endereco, unidade: rotuloUn(un), cliente: cli ? abreviar(cli.nome) : null,
      opcoes: ag.opcoes.map((o: Reg) => ({ ...o, disponivel: new Date(o.inicio).getTime() > agora().getTime() })),
    };
  }, 'publica'],
  ['POST', /^\/publico\/agendamento\/(\w+)\/confirmar$/, ({ corpo }, tk) => {
    const ag = agendamentoPorToken(tk);
    confirmar(ag, corpo.opcaoId, atorCliente(db.unidades.find((x) => x.id === ag.unidadeId)!), true);
    return { ok: true };
  }, 'publica'],
  ['POST', /^\/publico\/agendamento\/(\w+)\/recusar$/, ({ corpo }, tk) => {
    const ag = agendamentoPorToken(tk);
    cancelarAg(ag, `Cliente pediu outros horários: ${corpo.motivo}`, atorCliente(db.unidades.find((x) => x.id === ag.unidadeId)!));
    return { ok: true };
  }, 'publica'],
  ['GET', /^\/publico\/assinatura\/(\w+)$/, (_p, tk) => {
    const { doc, s } = signatarioPorToken(tk);
    const un = db.unidades.find((x) => x.id === doc.unidadeId)!;
    const pendente = s.status === 'PENDENTE' && doc.envelope.status === 'PENDENTE';
    return {
      protocolo: doc.protocolo, titulo: doc.titulo, empreendimento: empDe(un).nome, unidade: rotuloUn(un),
      resultadoVistoria: db.vistorias.find((v) => v.id === doc.vistoriaId)?.resultado ?? null,
      nome: abreviar(s.nome), email: s.email ? mascarar(s.email) : null, status: s.status, statusEnvelope: doc.envelope.status,
      assinadoEm: s.assinadoEm, pendente, temAssinado: doc.assinado, codigoEnviado: pendente && !!s.codigo, sha256: doc.sha256,
    };
  }, 'publica'],
  ['GET', /^\/publico\/assinatura\/(\w+)\/documento$/, (_p, tk) => previa(signatarioPorToken(tk).doc), 'publica'],
  ['POST', /^\/publico\/assinatura\/(\w+)\/codigo$/, (_p, tk) => {
    const { doc, s } = signatarioPorToken(tk);
    if (s.status !== 'PENDENTE' || doc.envelope.status !== 'PENDENTE') invalido('Este termo não está mais aguardando esta assinatura');
    if (!s.email) invalido('Não há e-mail cadastrado para envio do código. Fale com a Central de Relacionamento.');
    s.codigo = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
    const un = db.unidades.find((x) => x.id === doc.unidadeId)!;
    registrar({ acao: 'CODIGO_ASSINATURA_ENVIADO', descricao: `Código de assinatura do termo ${doc.protocolo} enviado para ${mascarar(s.email)}`, ator: atorCliente(un), unidade: un, etapa: doc.etapa, entidade: 'Signatario' });
    return { enviadoPara: mascarar(s.email), validadeMinutos: 15, ensaio: false, codigoDemo: s.codigo };
  }, 'publica'],
  ['POST', /^\/publico\/assinatura\/(\w+)\/assinar$/, ({ corpo }, tk) => {
    const { doc, s } = signatarioPorToken(tk);
    const un = db.unidades.find((x) => x.id === doc.unidadeId)!;
    if (!s.codigo) invalido('Código expirado ou não solicitado. Peça um novo código.');
    if (String(corpo.codigo) !== s.codigo) {
      registrar({ acao: 'CODIGO_ASSINATURA_INCORRETO', descricao: `Código incorreto na assinatura do termo ${doc.protocolo}`, ator: atorCliente(un), unidade: un, etapa: doc.etapa, entidade: 'Signatario' });
      invalido('Código incorreto');
    }
    assinarSignatario(doc, s, { nome: s.nome, metodo: 'CODIGO_USO_UNICO', imagem: corpo.assinaturaImagem }, atorCliente(un));
    return { ok: true };
  }, 'publica'],
  ['POST', /^\/publico\/assinatura\/(\w+)\/recusar$/, ({ corpo }, tk) => {
    const { doc, s } = signatarioPorToken(tk);
    recusarSignatario(doc, s, corpo.motivo, s.nome, atorCliente(db.unidades.find((x) => x.id === doc.unidadeId)!));
    return { ok: true };
  }, 'publica'],
  ['GET', /^\/publico\/verificar\/([\w-]+)$/, (_p, prot) => {
    const d = db.documentos.find((x) => x.protocolo === prot.toUpperCase()) ?? sumiu('Protocolo não encontrado');
    const un = db.unidades.find((x) => x.id === d.unidadeId)!;
    return {
      protocolo: d.protocolo, titulo: d.titulo, empreendimento: empDe(un).nome, unidade: rotuloUn(un), emitidoEm: d.criadoEm,
      situacao: d.envelope.status, concluidoEm: d.envelope.concluidoEm, sha256: d.sha256, sha256Assinado: d.sha256Assinado, confere: null,
      signatarios: d.envelope.signatarios.map((s: Reg) => ({ parte: PARTE[s.parte as Parte], nome: abreviar(s.nome), status: s.status, assinadoEm: s.assinadoEm })),
    };
  }, 'publica'],
];

function signatario(id: string) {
  for (const doc of db.documentos) {
    const s = doc.envelope.signatarios.find((x: Reg) => x.id === id);
    if (s) return { doc, s };
  }
  return sumiu('Signatário não encontrado');
}
function signatarioPorToken(tk: string) {
  for (const doc of db.documentos) {
    const s = doc.envelope.signatarios.find((x: Reg) => x.token === tk);
    if (s) return { doc, s };
  }
  return sumiu('Link de assinatura inválido');
}
const agendamentoPorToken = (tk: string): Reg => db.agendamentos.find((a) => a.tokenCliente === tk) ?? sumiu('Link de agendamento inválido');
const atorCliente = (un: Reg): Ator => ({ tipo: 'CLIENTE', nome: clienteDe(un)?.nome ?? 'Cliente', perfil: 'CLIENTE' });

// O que a janela "termo" da demonstração mostra (na operação é um PDF)
function previa(d: Reg) {
  return {
    conteudo: d.conteudo, sha256: d.sha256, situacao: d.envelope.status,
    assinaturas: d.envelope.signatarios.map((s: Reg) => ({
      parte: PARTE[s.parte as Parte], nome: s.nome, status: s.status, assinadoEm: s.assinadoEm, metodo: s.metodo, assinaturaImagem: s.assinaturaImagem,
    })),
  };
}

export function fotoDaPrevia(id: string): Blob | null {
  for (const v of db.vistorias) for (const i of v.itens) for (const f of i.fotos) if (f.id === id) return f.blob;
  return null;
}

// ---------- despacho ----------

function despachar(metodo: string, caminho: string, corpo: unknown, q: Record<string, string>, u: Usuario | null) {
  for (const [m, padrao, tratar, publica] of rotas) {
    if (m !== metodo) continue;
    const casou = caminho.match(padrao);
    if (!casou) continue;
    if (publica !== 'publica' && !u) throw new Falha(401, 'Sessão inválida ou expirada');
    if (!publica && u?.perfil === 'AUDITOR' && metodo !== 'GET') recusar('Perfil somente leitura: esta ação não é permitida');
    return tratar({ u: u as Usuario, corpo, q }, ...casou.slice(1));
  }
  throw new Falha(404, `A demonstração não simula ${metodo} ${caminho}`);
}

function usuarioDoToken(cabecalho: unknown): Usuario | null {
  const [id, perfil, orgId] = String(cabecalho ?? '').replace('Bearer demo.', '').split('.');
  const x = db.usuarios.find((y) => y.id === id);
  if (!x) return null;
  const u: Usuario = { sub: x.id, nome: x.nome, email: x.email, perfil: x.perfil, organizacaoId: x.organizacaoId, organizacaoNome: orgNome(x.organizacaoId) };
  if (x.contaTeste) {
    u.contaTeste = true;
    u.perfilReal = x.perfil;
    if (perfil) Object.assign(u, { perfil, organizacaoId: orgId || null, organizacaoNome: orgNome(orgId || null) });
  }
  return u;
}

// Os perfis que a conta de teste pode assumir (como no sistema real)
function perfisDeTeste() {
  const doTipo = (tipo: string) => db.orgs.filter((o) => o.tipo === tipo && o.ativo);
  return [
    { perfil: 'INCORPORADORA', organizacaoId: doTipo('INCORPORADORA')[0]?.id ?? null, rotulo: 'Incorporadora' },
    ...doTipo('CONSTRUTORA').map((o) => ({ perfil: 'CONSTRUTORA', organizacaoId: o.id, rotulo: `Construtora — ${o.nome}` })),
    { perfil: 'RELACIONAMENTO', organizacaoId: doTipo('CENTRAL_RELACIONAMENTO')[0]?.id ?? null, rotulo: 'Central de Relacionamento' },
    { perfil: 'AUDITOR', organizacaoId: null, rotulo: 'Auditor (só leitura)' },
    { perfil: 'ADMINISTRADOR', organizacaoId: null, rotulo: 'Administrador' },
  ];
}

export const adaptadorDemo: AxiosAdapter = (config: InternalAxiosRequestConfig) =>
  new Promise<AxiosResponse>((resolve, reject) => {
    setTimeout(() => {
      // Botão "sem sinal": toda chamada falha como falharia sem rede
      if (fila.semSinalSimulado()) {
        reject(new AxiosError('Network Error', AxiosError.ERR_NETWORK, config));
        return;
      }
      const [caminho, consulta = ''] = (config.url ?? '').split('?');
      const q: Record<string, string> = { ...Object.fromEntries(new URLSearchParams(consulta)) };
      for (const [k, v] of Object.entries(config.params ?? {})) if (v !== undefined && v !== null) q[k] = String(v);
      let corpo: unknown = config.data;
      if (typeof corpo === 'string') {
        try {
          corpo = JSON.parse(corpo);
        } catch {
          // segue como texto
        }
      }
      try {
        const dados = despachar((config.method ?? 'get').toUpperCase(), caminho, corpo ?? {}, q, usuarioDoToken(config.headers?.Authorization));
        resolve({ data: dados, status: 200, statusText: 'OK', headers: {}, config });
      } catch (erro) {
        const falha = erro instanceof Falha ? erro : new Falha(500, `Erro na demonstração: ${(erro as Error).message}`);
        const resposta: AxiosResponse = { data: { message: falha.message, statusCode: falha.status }, status: falha.status, statusText: 'Erro', headers: {}, config };
        reject(new AxiosError(falha.message, String(falha.status), config, null, resposta));
      }
    }, 140);
  });

// ---------- dados iniciais ----------

// A demonstração entra com a conta de teste, que troca de perfil em "Ver como"
export const CONTA_DE_TESTE = 'teste@exemplo.com';

// Monta um retrato realista: em vez de dados soltos, percorre o fluxo de
// verdade com cada perfil, ao longo de duas semanas de "tempo".
export function recomecar() {
  db = { orgs: [], usuarios: [], emps: [], clientes: [], unidades: [], agendamentos: [], vistorias: [], pendencias: [], documentos: [], eventos: [], pauta: [] };
  contador = 0;
  const DIA = 86400_000;
  const HORA = 3600_000;
  deslocamento = -16 * DIA;
  const passar = (ms: number) => (deslocamento = Math.min(0, deslocamento + ms));

  const org = (nome: string, tipo: string, cnpj: string | null = null) => { const o = { id: novoId('og'), nome, tipo, cnpj, ativo: true }; db.orgs.push(o); return o; };
  const construtora = org('Construtora Exemplo Ltda', 'CONSTRUTORA', '11222333000181');
  const outra = org('Outra Construtora S.A.', 'CONSTRUTORA');
  const incorporadora = org('RSF Incorporadora', 'INCORPORADORA');
  const central = org('RSF Central de Relacionamento', 'CENTRAL_RELACIONAMENTO');
  const pessoa = (nome: string, email: string, perfil: Perfil, organizacaoId: string | null) => {
    const x: Reg = { id: novoId('us'), nome, email, perfil, organizacaoId, cpf: null, ativo: true, contaTeste: false };
    db.usuarios.push(x);
    return { sub: x.id, nome, email, perfil, organizacaoId, organizacaoNome: orgNome(organizacaoId) } as Usuario;
  };
  const carlos = pessoa('Carlos Construtor', 'construtora@exemplo.com', 'CONSTRUTORA', construtora.id);
  pessoa('Olívia Outra', 'outra.construtora@exemplo.com', 'CONSTRUTORA', outra.id);
  const ines = pessoa('Inês Incorporadora', 'incorporadora@exemplo.com', 'INCORPORADORA', incorporadora.id);
  const renata = pessoa('Renata Relacionamento', 'relacionamento@exemplo.com', 'RELACIONAMENTO', central.id);
  pessoa('Alberto Auditor', 'auditor@exemplo.com', 'AUDITOR', null);
  pessoa('Administrador', 'admin@exemplo.com', 'ADMINISTRADOR', null);
  pessoa('Conta de Teste', CONTA_DE_TESTE, 'AUDITOR', null);
  db.usuarios[db.usuarios.length - 1].contaTeste = true;

  for (const etapa of ORDEM) {
    let ordem = 0;
    for (const [ambiente, itens] of PAUTA[etapa]) for (const descricao of itens) db.pauta.push({ id: novoId('pt'), etapa, ambiente, descricao, ordem: ordem++, ativo: true });
  }
  const emp = { id: novoId('em'), codigo: '01', nome: 'Residencial Exemplo', endereco: 'Rua das Acácias, 100 — Centro', construtoraId: construtora.id, incorporadoraId: incorporadora.id, ativo: true };
  const emp2 = { id: novoId('em'), codigo: '02', nome: 'Edifício Outro', endereco: null, construtoraId: outra.id, incorporadoraId: incorporadora.id, ativo: true };
  db.emps.push(emp, emp2);
  const cliente = (nome: string, cpfCnpj: string, email: string, telefone: string) => { const c = { id: novoId('cl'), nome, cpfCnpj, email, telefone }; db.clientes.push(c); return c; };
  const maria = cliente('Maria Souza Oliveira', '52998224725', 'maria@exemplo.com', '(11) 99999-0000');
  const joao = cliente('João Pereira Lima', '11144477735', 'joao@exemplo.com', '(11) 98888-1111');
  const ana = cliente('Ana Beatriz Costa', '39053344705', 'ana@exemplo.com', '(11) 97777-2222');

  const como = (u: Usuario | null, metodo: string, caminho: string, corpo: unknown = {}) => despachar(metodo, caminho, corpo, {}, u) as any;
  const un: Record<string, Reg> = {};
  for (const [andar, numeros] of [['1', ['101', '102', '103']], ['2', ['201', '202', '203']], ['3', ['301', '302', '303']]] as [string, string[]][]) {
    for (const criada of como(ines, 'POST', '/unidades', { empreendimentoId: emp.id, bloco: 'Torre A', numeros, andar, tipologia: '2 dormitórios' })) un[criada.numero] = criada;
  }
  como(ines, 'POST', '/unidades', { empreendimentoId: emp2.id, numeros: ['11'] });

  const emBreve = (dias: number, hora: number) => { const d = new Date(agora().getTime() + dias * DIA); d.setHours(hora, 0, 0, 0); return d.toISOString(); };
  const agendar = (u: Reg, quemPropoe: Usuario, quemConfirma: Usuario) => {
    const ag = como(quemPropoe, 'POST', `/unidades/${u.id}/agendamentos`, { opcoes: [emBreve(1, 9), emBreve(2, 14)], local: 'Portaria da Torre A' });
    passar(3 * HORA);
    como(quemConfirma, 'POST', `/agendamentos/${ag.id}/confirmar`, { opcaoId: ag.opcoes[0].id });
    passar(1.2 * DIA);
  };
  const vistoriar = (u: Reg, quem: Usuario, ajustes: Record<number, { resultado: ResultadoItem; observacao?: string }> = {}, acompanhante?: string) => {
    const v = como(quem, 'POST', `/unidades/${u.id}/vistorias`);
    v.itens.forEach((item: Reg, i: number) => como(quem, 'PATCH', `/vistorias/${v.id}/itens/${item.id}`, ajustes[i] ?? { resultado: 'CONFORME' }));
    passar(HORA);
    como(quem, 'POST', `/vistorias/${v.id}/concluir`, { acompanhante });
    return v;
  };
  const assinarTodos = (u: Reg, exceto: Parte[] = []) => {
    const doc = db.documentos.filter((d) => d.unidadeId === u.id).slice(-1)[0];
    for (const s of doc.envelope.signatarios as Reg[]) {
      if (exceto.includes(s.parte)) continue;
      passar(2 * HORA);
      if (s.parte === 'CLIENTE') {
        const { codigoDemo } = como(null, 'POST', `/publico/assinatura/${s.token}/codigo`);
        como(null, 'POST', `/publico/assinatura/${s.token}/assinar`, { codigo: codigoDemo });
      } else {
        const quem = s.parte === 'CONSTRUTORA' ? carlos : s.parte === 'INCORPORADORA' ? ines : renata;
        como(quem, 'POST', `/signatarios/${s.id}/assinar`, { senha: 'demo' });
      }
    }
  };
  const etapa1 = (u: Reg, ajustes = {}) => {
    como(carlos, 'POST', `/unidades/${u.id}/liberar`, { observacao: 'Obra da unidade concluída e limpa.' });
    passar(4 * HORA);
    agendar(u, carlos, ines);
    vistoriar(u, ines, ajustes, 'Eng. José Almeida');
    assinarTodos(u);
  };
  const etapa2 = (u: Reg) => {
    passar(5 * HORA);
    como(ines, 'POST', `/unidades/${u.id}/liberar`);
    passar(6 * HORA);
    vistoriar(u, renata);
    assinarTodos(u);
  };

  // 303 — o caminho inteiro, até as chaves com o cliente
  etapa1(un['303'], { 1: { resultado: 'RESSALVA', observacao: 'Retoque de pintura atrás da porta de entrada.' } });
  etapa2(un['303']);
  como(renata, 'PATCH', `/unidades/${un['303'].id}`, { clienteId: ana.id });
  let ag = como(renata, 'POST', `/unidades/${un['303'].id}/agendamentos`, { opcoes: [emBreve(1, 10), emBreve(3, 15)] });
  passar(5 * HORA);
  como(null, 'POST', `/publico/agendamento/${ag.tokenCliente}/confirmar`, { opcaoId: ag.opcoes[0].id });
  passar(1.1 * DIA);
  vistoriar(un['303'], renata);
  assinarTodos(un['303']);

  // 101 e 302 — recebidas e repassadas; agora com a Central de Relacionamento
  etapa1(un['101']);
  etapa2(un['101']);
  etapa1(un['302']);
  etapa2(un['302']);
  // 301 — recebida da construtora; repasse aguardando conferência
  etapa1(un['301']);
  // 102 — reprovada na vistoria técnica: pendência com a construtora
  como(carlos, 'POST', `/unidades/${un['102'].id}/liberar`);
  agendar(un['102'], carlos, ines);
  vistoriar(un['102'], ines, { 2: { resultado: 'NAO_CONFORME', observacao: 'Piso da sala com duas peças trincadas.' } }, 'Eng. José Almeida');
  como(carlos, 'POST', `/unidades/${un['102'].id}/anotacoes`, { texto: 'Peças de reposição do piso chegam na quinta-feira; troca prevista para sexta.' });
  // 203 — aprovada com ressalva; a incorporadora já assinou, falta a construtora
  como(carlos, 'POST', `/unidades/${un['203'].id}/liberar`);
  agendar(un['203'], ines, carlos);
  vistoriar(un['203'], ines, { 7: { resultado: 'RESSALVA', observacao: 'Luminária do corredor sem acabamento.' } }, 'Eng. José Almeida');
  assinarTodos(un['203'], ['CONSTRUTORA']);

  // ----- hoje -----
  deslocamento = -5 * HORA;
  como(ines, 'POST', `/unidades/${un['301'].id}/liberar`);
  como(carlos, 'POST', `/unidades/${un['201'].id}/liberar`);
  ag = como(carlos, 'POST', `/unidades/${un['201'].id}/agendamentos`, { opcoes: [emBreve(1, 9), emBreve(2, 14)], local: 'Portaria da Torre A' });
  passar(HORA);
  como(ines, 'POST', `/agendamentos/${ag.id}/confirmar`, { opcaoId: ag.opcoes[0].id });
  como(carlos, 'POST', `/unidades/${un['103'].id}/liberar`);
  como(carlos, 'POST', `/unidades/${un['103'].id}/agendamentos`, { opcoes: [emBreve(2, 9), emBreve(3, 14), emBreve(4, 10)], local: 'Portaria da Torre A' });
  passar(HORA);
  como(renata, 'PATCH', `/unidades/${un['101'].id}`, { clienteId: maria.id });
  ag = como(renata, 'POST', `/unidades/${un['101'].id}/agendamentos`, { opcoes: [emBreve(1, 15), emBreve(4, 10)], local: 'Recepção do empreendimento' });
  passar(HORA);
  como(null, 'POST', `/publico/agendamento/${ag.tokenCliente}/confirmar`, { opcaoId: ag.opcoes[0].id });
  como(renata, 'PATCH', `/unidades/${un['302'].id}`, { clienteId: joao.id });
  como(renata, 'POST', `/unidades/${un['302'].id}/agendamentos`, { opcoes: [emBreve(3, 9), emBreve(5, 16)], local: 'Recepção do empreendimento' });
  deslocamento = 0;
}

recomecar();
