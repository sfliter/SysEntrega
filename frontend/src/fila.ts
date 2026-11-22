// Fila de envio da vistoria.
//
// Na obra o sinal do celular oscila. Por isso nada do que o vistoriador marca
// depende da rede no momento do toque: cada avaliação, observação e foto é
// gravada primeiro NO APARELHO (IndexedDB) e entra numa fila. A fila é
// enviada assim que há conexão e tentada de novo, sozinha, até dar certo —
// inclusive depois de fechar e reabrir o navegador.
//
// Regras:
//  - falha de rede ou do servidor (5xx): a operação FICA na fila e é tentada
//    de novo, com intervalos crescentes;
//  - recusa do servidor (4xx — ex.: a vistoria já foi encerrada): a operação
//    é marcada com o erro e fica à vista do usuário, que decide descartar;
//  - reenviar a mesma coisa não duplica: avaliação é "o último valor vale" e
//    o servidor reconhece a mesma foto pelo conteúdo.
import axios from 'axios';
import { api, DEMO, mensagemDeErro, sessao } from './api';
import type { ResultadoItem } from './tipos';

interface Base {
  id: string;
  usuarioId: string;
  vistoriaId: string;
  itemId: string;
  criadoEm: number;
  erro?: string;
}

export type Operacao = Base &
  (
    | { tipo: 'item'; rotulo: string; mudanca: { resultado?: ResultadoItem | null; observacao?: string } }
    | { tipo: 'foto'; rotulo: string; dados: ArrayBuffer; mime: string; nome: string }
  );

export interface EstadoFila {
  ops: Operacao[];
  pendentes: number;
  comErro: number;
  sincronizando: boolean;
  online: boolean;
  // false = o aparelho não deixou gravar em disco: a fila vive só enquanto a
  // página estiver aberta
  persistente: boolean;
}

// ---------- armazenamento no aparelho ----------

const BANCO = 'sysentrega';
const LOJAS = ['fila', 'vistorias'] as const;
type Loja = (typeof LOJAS)[number];

let banco: IDBDatabase | null = null;
const memoria: Record<Loja, Map<string, any>> = { fila: new Map(), vistorias: new Map() };

function abrirBanco(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const pedido = indexedDB.open(BANCO, 1);
      pedido.onupgradeneeded = () => {
        for (const loja of LOJAS) {
          if (!pedido.result.objectStoreNames.contains(loja)) {
            pedido.result.createObjectStore(loja, { keyPath: 'id' });
          }
        }
      };
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => resolve(null);
      pedido.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function noBanco<T>(loja: Loja, modo: IDBTransactionMode, acao: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = banco!.transaction(loja, modo);
    const pedido = acao(tx.objectStore(loja));
    // Só considera gravado quando a transação termina de verdade
    tx.oncomplete = () => resolve(pedido.result as T);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function gravar<T extends { id: string }>(loja: Loja, valor: T) {
  memoria[loja].set(valor.id, valor);
  if (!banco) return;
  try {
    await noBanco(loja, 'readwrite', (s) => s.put(valor));
  } catch {
    // Disco cheio ou bloqueado: segue em memória e avisa o usuário
    perderPersistencia();
  }
}

async function apagar(loja: Loja, id: string) {
  memoria[loja].delete(id);
  if (!banco) return;
  try {
    await noBanco(loja, 'readwrite', (s) => s.delete(id));
  } catch {
    perderPersistencia();
  }
}

async function ler<T>(loja: Loja, id: string): Promise<T | null> {
  if (memoria[loja].has(id)) return memoria[loja].get(id);
  if (!banco) return null;
  try {
    return (await noBanco<T>(loja, 'readonly', (s) => s.get(id))) ?? null;
  } catch {
    return null;
  }
}

// ---------- estado ----------

let ops: Operacao[] = [];
let sincronizando = false;
let persistente = true;
let emEnvio: string | null = null;
// Demonstração: botão "sem sinal" (a rede de verdade continua lá)
let semSinalSimulado = false;
let estado: EstadoFila = montarEstado();
const ouvintes = new Set<() => void>();

function usuarioAtual(): string | null {
  return sessao.usuario()?.sub ?? null;
}

function montarEstado(): EstadoFila {
  const minhas = ops.filter((o) => o.usuarioId === usuarioAtual());
  return {
    ops: minhas,
    pendentes: minhas.filter((o) => !o.erro).length,
    comErro: minhas.filter((o) => o.erro).length,
    sincronizando,
    online: !semSinalSimulado && (typeof navigator === 'undefined' ? true : navigator.onLine),
    persistente,
  };
}

function avisar() {
  estado = montarEstado();
  ouvintes.forEach((f) => f());
}

function perderPersistencia() {
  if (!persistente) return;
  persistente = false;
  avisar();
}

const pronto: Promise<void> = (async () => {
  // Na demonstração o servidor simulado recomeça a cada abertura da página:
  // a fila também fica só em memória.
  if (DEMO) return;
  banco = await abrirBanco();
  if (!banco) {
    persistente = false;
  } else {
    try {
      // O que já foi enfileirado nesta sessão (antes de o banco abrir) continua valendo
      const guardadas = await noBanco<Operacao[]>('fila', 'readonly', (s) => s.getAll());
      const novas = new Set(ops.map((o) => o.id));
      ops = [...guardadas.filter((o) => !novas.has(o.id)), ...ops];
      ops.forEach((o) => memoria.fila.set(o.id, o));
    } catch {
      persistente = false;
    }
  }
  avisar();
})();

// ---------- envio ----------

const ESPERAS = [2000, 5000, 10000, 20000, 30000];
let tentativa = 0;
let relogio: ReturnType<typeof setTimeout> | undefined;
let repetir = false;

async function enviar(op: Operacao) {
  if (op.tipo === 'item') {
    await api.patch(`/vistorias/${op.vistoriaId}/itens/${op.itemId}`, op.mudanca, { timeout: 20000 });
    return;
  }
  const form = new FormData();
  form.append('fotos', new Blob([op.dados], { type: op.mime }), op.nome);
  await api.post(`/vistorias/${op.vistoriaId}/itens/${op.itemId}/fotos`, form, { timeout: 60000 });
}

// Falhas que passam sozinhas: sem rede, tempo esgotado, servidor fora do ar,
// limite de chamadas, sessão vencida (volta a enviar depois do novo login).
function passageira(erro: unknown): boolean {
  if (!axios.isAxiosError(erro) || !erro.response) return true;
  const s = erro.response.status;
  return s >= 500 || s === 401 || s === 408 || s === 429;
}

function agendarNovaTentativa() {
  clearTimeout(relogio);
  relogio = setTimeout(sincronizar, ESPERAS[Math.min(tentativa, ESPERAS.length - 1)]);
  tentativa++;
}

async function sincronizar(): Promise<void> {
  if (sincronizando) {
    repetir = true;
    return;
  }
  await pronto;
  clearTimeout(relogio);
  sincronizando = true;
  avisar();
  try {
    for (;;) {
      const usuario = usuarioAtual();
      if (!usuario) break;
      const op = ops
        .filter((o) => !o.erro && o.usuarioId === usuario)
        .sort((a, b) => a.criadoEm - b.criadoEm)[0];
      if (!op) break;
      emEnvio = op.id;
      try {
        await enviar(op);
        ops = ops.filter((o) => o.id !== op.id);
        await apagar('fila', op.id);
        tentativa = 0;
      } catch (erro) {
        if (passageira(erro)) {
          agendarNovaTentativa();
          break;
        }
        // O servidor recusou: guarda o motivo e segue com o resto da fila
        op.erro = mensagemDeErro(erro);
        await gravar('fila', op);
      } finally {
        emEnvio = null;
      }
      avisar();
    }
  } finally {
    sincronizando = false;
    avisar();
    if (repetir) {
      repetir = false;
      void sincronizar();
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    tentativa = 0;
    avisar();
    void sincronizar();
  });
  window.addEventListener('offline', avisar);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void sincronizar();
  });
  // Rede de segurança: mesmo sem nenhum evento do navegador, tenta de novo
  setInterval(() => {
    if (estado.pendentes > 0 && !sincronizando) void sincronizar();
  }, 30000);
  // Sem gravação em disco, fechar a página perderia a fila: pede confirmação
  window.addEventListener('beforeunload', (e) => {
    if (!persistente && estado.pendentes > 0) e.preventDefault();
  });
  void pronto.then(sincronizar);
}

function novoId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- interface pública ----------

export const fila = {
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => {
      ouvintes.delete(f);
    };
  },
  estado: () => estado,
  pronto,
  semSinalSimulado: () => semSinalSimulado,
  simularSemSinal(valor: boolean) {
    semSinalSimulado = valor;
    tentativa = 0;
    avisar();
    if (!valor) void sincronizar();
  },
  sincronizar,

  // A entrada na fila é imediata (no mesmo instante do toque): a tela nunca
  // diz "tudo salvo" com algo ainda por enviar. A gravação em disco vem logo
  // em seguida.
  async enfileirarItem(
    vistoriaId: string,
    itemId: string,
    rotulo: string,
    mudanca: { resultado?: ResultadoItem | null; observacao?: string },
  ) {
    const usuarioId = usuarioAtual();
    if (!usuarioId) return;
    // Várias mudanças no mesmo item antes do envio viram uma só (o último
    // valor de cada campo). A que já está sendo enviada não é mexida.
    const existente = ops.find(
      (o) => o.tipo === 'item' && o.itemId === itemId && o.usuarioId === usuarioId && !o.erro && o.id !== emEnvio,
    );
    let op: Operacao;
    if (existente && existente.tipo === 'item') {
      existente.mudanca = { ...existente.mudanca, ...mudanca };
      op = existente;
    } else {
      op = { id: novoId(), tipo: 'item', usuarioId, vistoriaId, itemId, rotulo, mudanca, criadoEm: Date.now() };
      ops.push(op);
    }
    avisar();
    await pronto;
    // Se o envio já levou esta operação enquanto o banco abria, não regrava
    if (ops.includes(op)) await gravar('fila', op);
    void sincronizar();
  },

  async enfileirarFoto(vistoriaId: string, itemId: string, rotulo: string, foto: Blob, nome: string) {
    const usuarioId = usuarioAtual();
    if (!usuarioId) return;
    const op: Operacao = {
      id: novoId(),
      tipo: 'foto',
      usuarioId,
      vistoriaId,
      itemId,
      rotulo,
      // ArrayBuffer (e não Blob): há navegadores que não gravam Blob no IndexedDB
      dados: await foto.arrayBuffer(),
      mime: foto.type || 'image/jpeg',
      nome,
      criadoEm: Date.now(),
    };
    ops.push(op);
    avisar();
    await pronto;
    if (ops.includes(op)) await gravar('fila', op);
    void sincronizar();
  },

  async descartar(id: string) {
    ops = ops.filter((o) => o.id !== id);
    await apagar('fila', id);
    avisar();
  },

  async tentarDeNovo(id: string) {
    const op = ops.find((o) => o.id === id);
    if (!op) return;
    delete op.erro;
    await gravar('fila', op);
    avisar();
    void sincronizar();
  },

  // Cópia da vistoria no aparelho: é o que a tela mostra quando não há sinal
  async guardarVistoria(id: string, dados: unknown) {
    await pronto;
    await gravar('vistorias', { id, dados, salvoEm: Date.now() });
  },

  async lerVistoria<T>(id: string): Promise<{ dados: T; salvoEm: number } | null> {
    await pronto;
    return ler('vistorias', id);
  },

  async esquecerVistoria(id: string) {
    await pronto;
    await apagar('vistorias', id);
  },
};
