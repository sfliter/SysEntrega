import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Service worker gerado no build, com a lista exata dos arquivos da versão.
// Ele guarda a interface no aparelho: se o sinal cair no meio de uma vistoria
// e a página for recarregada, o sistema abre do mesmo jeito. As chamadas à
// API nunca passam por ele — quem cuida dos dados sem sinal é src/fila.ts.
function servicoOffline(): Plugin {
  return {
    name: 'sysentrega-sw',
    apply: 'build',
    generateBundle(_opcoes, bundle) {
      const arquivos = ['/index.html', '/icone.svg', ...Object.keys(bundle).map((f) => `/${f}`)];
      const versao = Date.now().toString(36);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Gerado no build — não edite.
const CACHE = 'sysentrega-${versao}';
const ARQUIVOS = ${JSON.stringify(arquivos)};

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k.startsWith('sysentrega-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const pedido = e.request;
  if (pedido.method !== 'GET') return;
  const url = new URL(pedido.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Abrir uma tela: tenta a rede por até 4s (sinal fraco "pendura" sem
  // falhar); se não vier, entrega a interface guardada.
  if (pedido.mode === 'navigate') {
    e.respondWith((async () => {
      const guardada = await caches.match('/index.html', { cacheName: CACHE, ignoreVary: true });
      try {
        const controle = new AbortController();
        const limite = setTimeout(() => controle.abort(), 4000);
        // (pedido de navegação não aceita opções: busca pela URL)
        const resposta = await fetch(pedido.url, { signal: controle.signal, credentials: 'same-origin' });
        clearTimeout(limite);
        return resposta;
      } catch (erro) {
        if (guardada) return guardada;
        throw erro;
      }
    })());
    return;
  }
  // Demais arquivos (têm hash no nome): o guardado vale
  // (ignoreVary: o pedido de um script leva cabeçalhos que o da instalação
  // não levou; sem isto o navegador não reconheceria a cópia guardada)
  e.respondWith(caches.match(url.pathname, { cacheName: CACHE, ignoreVary: true }).then((r) => r || fetch(pedido)));
});
`,
      });
    },
  };
}

// `vite build --mode demo` gera a versão de demonstração (ver src/demo)
export default defineConfig(({ mode }) => mode === 'demo' ? {
  plugins: [react()],
  build: {
    outDir: 'dist-demo',
    sourcemap: false,
    cssCodeSplit: false,
    // Tudo embutido: a demonstração é um arquivo só
    assetsInlineLimit: 10_000_000,
    rollupOptions: { input: 'demo.html' },
  },
} : {
  plugins: [react(), servicoOffline()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        // Mantém o Host original: o IP e a origem chegam à API como em produção
        xfwd: true,
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
