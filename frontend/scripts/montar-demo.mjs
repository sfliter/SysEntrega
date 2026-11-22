// Junta o build da demonstração num único arquivo HTML, sem dependências
// locais: é o arquivo que se abre no navegador (ou se publica) para aprovar
// telas e fluxo.
//   npm run build:demo   →   dist-demo/sysentrega-demonstracao.html
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const dir = new URL('../dist-demo/', import.meta.url);
const arquivos = readdirSync(new URL('assets/', dir));
const ler = (sufixo) => {
  const nome = arquivos.find((a) => a.endsWith(sufixo));
  if (!nome) throw new Error(`Build da demonstração sem arquivo ${sufixo}`);
  return readFileSync(new URL(`assets/${nome}`, dir), 'utf8');
};
const css = ler('.css');
// Dentro de <script>, "</script" encerraria o bloco antes da hora
const js = ler('.js').replace(/<\/script/gi, '<\\/script');
if (/url\((?!["']?data:)/.test(css)) throw new Error('O CSS da demonstração referencia arquivo externo');

const pagina = `<title>SysEntrega Demonstração</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400..800&family=IBM+Plex+Mono:wght@400;600&display=swap">
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`;
writeFileSync(new URL('sysentrega-demonstracao.html', dir), pagina);
// Versão para abrir direto do disco, com o esqueleto de página completo
writeFileSync(
  new URL('abrir-no-navegador.html', dir),
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">${pagina}</body></html>`,
);
console.log(`Demonstração montada: ${(pagina.length / 1024).toFixed(0)} KB`);
