import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

const CHAVE_TOKEN = 'sysentrega.token';
const CHAVE_USUARIO = 'sysentrega.usuario';

export const sessao = {
  token: () => localStorage.getItem(CHAVE_TOKEN),
  usuario: () => {
    try {
      return JSON.parse(localStorage.getItem(CHAVE_USUARIO) || 'null');
    } catch {
      return null;
    }
  },
  guardar(token: string, usuario: unknown) {
    localStorage.setItem(CHAVE_TOKEN, token);
    localStorage.setItem(CHAVE_USUARIO, JSON.stringify(usuario));
  },
  limpar() {
    localStorage.removeItem(CHAVE_TOKEN);
    localStorage.removeItem(CHAVE_USUARIO);
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
      window.location.href = '/login';
    }
    return Promise.reject(erro);
  },
);

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
