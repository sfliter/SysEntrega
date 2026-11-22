import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

// Versão de demonstração: mesma interface, com um servidor simulado dentro
// da própria página (src/demo). Nada sai do navegador.
export const DEMO = import.meta.env.VITE_DEMO === '1';

const CHAVE_TOKEN = 'sysentrega.token';
const CHAVE_USUARIO = 'sysentrega.usuario';

// O navegador pode recusar o armazenamento (janela anônima, dados bloqueados):
// a sessão então vale só enquanto a página estiver aberta.
const reserva = new Map<string, string>();
const guardado = {
  ler(chave: string): string | null {
    if (DEMO) return reserva.get(chave) ?? null;
    try {
      return localStorage.getItem(chave);
    } catch {
      return reserva.get(chave) ?? null;
    }
  },
  gravar(chave: string, valor: string | null) {
    if (valor === null) reserva.delete(chave);
    else reserva.set(chave, valor);
    if (DEMO) return;
    try {
      if (valor === null) localStorage.removeItem(chave);
      else localStorage.setItem(chave, valor);
    } catch {
      // segue com a cópia em memória
    }
  },
};

export const sessao = {
  token: () => guardado.ler(CHAVE_TOKEN),
  usuario: () => {
    try {
      return JSON.parse(guardado.ler(CHAVE_USUARIO) || 'null');
    } catch {
      return null;
    }
  },
  guardar(token: string, usuario: unknown) {
    guardado.gravar(CHAVE_TOKEN, token);
    guardado.gravar(CHAVE_USUARIO, JSON.stringify(usuario));
  },
  limpar() {
    guardado.gravar(CHAVE_TOKEN, null);
    guardado.gravar(CHAVE_USUARIO, null);
  },
};

api.interceptors.request.use((config) => {
  const token = sessao.token();
  // As rotas públicas (cliente sem login) nunca levam o token de um usuário
  if (token && !config.url?.startsWith('/publico/')) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (erro) => {
    const url: string = erro.config?.url ?? '';
    if (
      erro.response?.status === 401 &&
      !url.includes('/auth/login') &&
      !url.startsWith('/publico/')
    ) {
      sessao.limpar();
      if (!DEMO) window.location.href = '/login';
    }
    return Promise.reject(erro);
  },
);

export function semConexao(erro: unknown): boolean {
  return axios.isAxiosError(erro) && !erro.response;
}

export function mensagemDeErro(erro: unknown): string {
  if (axios.isAxiosError(erro)) {
    const msg = erro.response?.data?.message;
    if (Array.isArray(msg)) return msg.join('; ');
    if (typeof msg === 'string') return msg;
    if (!erro.response) return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
  }
  return 'Erro inesperado. Tente novamente.';
}

// Arquivos protegidos (PDF, fotos): baixados com o token e abertos como blob
export async function baixarBlob(caminho: string): Promise<Blob> {
  const { data } = await api.get(caminho, { responseType: 'blob' });
  return data;
}

export async function abrirPdf(caminho: string) {
  if (DEMO) {
    // Na demonstração o termo abre numa janela da própria página
    window.dispatchEvent(new CustomEvent('demo:documento', { detail: caminho }));
    return;
  }
  // A aba é aberta já no clique: depois do download o navegador a bloquearia
  const aba = window.open('', '_blank');
  try {
    const url = URL.createObjectURL(await baixarBlob(caminho));
    if (aba) aba.location.href = url;
    else window.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (erro) {
    aba?.close();
    throw erro;
  }
}
