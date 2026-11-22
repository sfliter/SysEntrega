// Teste da vistoria sem sinal, num navegador de verdade (Playwright).
//
// Precisa do sistema no ar com o build de produção (o service worker só existe
// nele) e do seed de demonstração:
//   backend:  npm run build && npm start          (porta 3000)
//   frontend: npm run build && npx vite preview --host 127.0.0.1 --port 4173
//   node test/offline.e2e.mjs
//
// O Playwright não é dependência do projeto: instale-o à parte ou rode num
// ambiente que já o tenha.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { chromium, devices } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:4173';
const SENHA = process.env.SEED_SENHA_PADRAO || 'Mudar@123';
const RETRATO = process.env.RETRATO; // pasta para salvar imagens das telas (opcional)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

let passos = 0;
const ok = (t) => console.log(`  ✓ ${String(++passos).padStart(2)} ${t}`);

// ---- chamadas diretas à API (por fora do navegador: é a "visão do servidor")
async function chamar(metodo, caminho, token, corpo) {
  const r = await fetch(`${BASE}/api${caminho}`, {
    method: metodo,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await r.json().catch(() => null);
  assert.ok(r.ok, `${metodo} ${caminho} → ${r.status} ${JSON.stringify(dados)}`);
  return dados;
}
const entrar = async (email) => (await chamar('POST', '/auth/login', null, { email, senha: SENHA })).accessToken;
const noServidor = async (vistoriaId, token) => {
  const v = await chamar('GET', `/vistorias/${vistoriaId}`, token);
  return {
    avaliados: v.itens.filter((i) => i.resultado).length,
    fotos: v.itens.reduce((s, i) => s + i.fotos.length, 0),
    observacoes: v.itens.filter((i) => i.observacao).map((i) => i.observacao),
  };
};

// ---- prepara uma unidade com vistoria agendada
const [construtora, incorp] = await Promise.all(['construtora@exemplo.com', 'incorporadora@exemplo.com'].map(entrar));
const emp = (await chamar('GET', '/empreendimentos', incorp)).find((e) => e.codigo === '01');
const numero = `F${Date.now().toString().slice(-6)}`;
const [un] = await chamar('POST', '/unidades', incorp, { empreendimentoId: emp.id, bloco: 'Fila', numeros: [numero] });
await chamar('POST', `/unidades/${un.id}/liberar`, construtora, {});
const ag = await chamar('POST', `/unidades/${un.id}/agendamentos`, construtora, { opcoes: [new Date(Date.now() + 86400_000).toISOString()] });
await chamar('POST', `/agendamentos/${ag.id}/confirmar`, incorp, { opcaoId: ag.opcoes[0].id });

// Espera o servidor chegar a um estado (o envio da fila é assíncrono)
async function ateServidor(vistoriaId, token, esperado, ms = 30000) {
  let atual;
  for (const fim = Date.now() + ms; Date.now() < fim; ) {
    atual = await noServidor(vistoriaId, token);
    if (JSON.stringify(atual) === JSON.stringify(esperado)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.deepEqual(atual, esperado);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'pt-BR' });
const page = await ctx.newPage();
const errosDePagina = [];
page.on('pageerror', (e) => errosDePagina.push(e.message));
const retrato = (nome) => (RETRATO ? page.screenshot({ path: `${RETRATO}/${nome}.png` }) : null);
const grupo = (i) => page.getByRole('group').nth(i);
const marcar = (i, qual) => grupo(i).getByRole('button', { name: qual, exact: true }).click();

try {
  console.log('\nVistoria sem sinal');
  await page.goto(`${BASE}/login`);
  await page.getByLabel('E-mail').fill('incorporadora@exemplo.com');
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: /Olá/ }).waitFor();
  // Espera o service worker assumir a página (a interface fica guardada no aparelho)
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  await page.goto(`${BASE}/unidades/${un.id}`);
  await page.getByRole('button', { name: 'Iniciar vistoria' }).click();
  // a vistoria abre no primeiro ambiente (Geral, 5 itens); os demais ficam nas abas
  const ambientes = (pg) => pg.getByRole('tablist', { name: 'Ambientes da vistoria' });
  await ambientes(page).waitFor();
  const vistoriaId = page.url().split('/').pop();

  await marcar(0, 'Conforme');
  await ateServidor(vistoriaId, incorp, { avaliados: 1, fotos: 0, observacoes: [] });
  await page.getByText('Tudo salvo no servidor').waitFor();
  ok('com sinal, cada toque chega ao servidor');

  // ---------- o sinal cai ----------
  await ctx.setOffline(true);
  await marcar(1, 'Conforme');
  await marcar(2, 'Ressalva');
  await page.getByPlaceholder(/Descreva o problema/).fill('Rodapé solto atrás da porta');
  await page.getByPlaceholder(/Descreva o problema/).blur();
  await marcar(3, 'Conforme');
  await marcar(4, 'Não conforme');
  await marcar(4, 'Conforme'); // mudou de ideia: vale o último toque
  await page.locator('input[type=file]').nth(2).setInputFiles({ name: 'rodape.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Foto aguardando envio' }).waitFor();
  await page.getByText(/Sem sinal: \d+ alteração\(ões\) salva\(s\) neste aparelho/).first().waitFor();
  await page.getByText('5/18').waitFor();
  assert.deepEqual(await noServidor(vistoriaId, incorp), { avaliados: 1, fotos: 0, observacoes: [] });
  await ambientes(page).getByRole('tab', { name: 'Concluir' }).click();
  await page.getByRole('button', { name: /Faltam 13 itens/ }).waitFor();
  await ambientes(page).getByRole('tab', { name: /Geral/ }).click();
  await retrato('20-vistoria-sem-sinal');
  ok('sem sinal, o vistoriador continua: avaliações, observação e foto ficam salvas no aparelho (nada chegou ao servidor)');

  // ---------- recarrega a página ainda sem sinal ----------
  await page.reload();
  await page.getByText('5/18').waitFor();
  await page.getByText(/cópia guardada neste aparelho/).waitFor();
  await page.getByRole('button', { name: 'Foto aguardando envio' }).waitFor();
  assert.equal(await page.getByPlaceholder(/Descreva o problema/).inputValue(), 'Rodapé solto atrás da porta');
  ok('recarregar sem sinal não perde nada: a tela abre com a cópia do aparelho e a fila intacta');

  // ---------- fecha a aba e abre outra, ainda sem sinal ----------
  await page.close();
  const outra = await ctx.newPage();
  outra.on('pageerror', (e) => errosDePagina.push(e.message));
  await outra.goto(`${BASE}/vistorias/${vistoriaId}`);
  await outra.getByText('5/18').waitFor();
  await outra.getByRole('button', { name: 'Foto aguardando envio' }).waitFor();
  ok('fechar o navegador e voltar depois, ainda sem sinal, também não perde nada');

  // ---------- o envio da foto chega ao servidor, mas a resposta se perde ----------
  let cortes = 0;
  await outra.route('**/api/vistorias/*/itens/*/fotos', async (rota) => {
    if (cortes++ === 0) {
      await rota.fetch(); // o servidor recebe e grava…
      await rota.abort('connectionreset'); // …mas o aparelho nunca fica sabendo
    } else {
      await rota.continue();
    }
  });
  await ctx.setOffline(false);
  await ateServidor(vistoriaId, incorp, { avaliados: 5, fotos: 1, observacoes: ['Rodapé solto atrás da porta'] });
  await outra.getByText('Tudo salvo no servidor').waitFor({ timeout: 30000 });
  assert.ok(cortes >= 2, 'a foto deveria ter sido reenviada');
  assert.equal((await noServidor(vistoriaId, incorp)).fotos, 1, 'o reenvio não pode duplicar a foto');
  await outra.getByRole('button', { name: /Ampliar foto/ }).waitFor();
  assert.equal(await outra.getByRole('button', { name: 'Foto aguardando envio' }).count(), 0);
  ok('quando o sinal volta a fila é enviada sozinha; a foto reenviada após resposta perdida não duplica');

  // ---------- o histórico registra o que foi feito sem sinal ----------
  const hist = await chamar('GET', `/unidades/${un.id}/historico`, incorp);
  assert.equal(hist.filter((e) => e.acao === 'VISTORIA_FOTO_ADICIONADA').length, 1);
  assert.ok(hist.some((e) => e.acao === 'VISTORIA_ITEM_AVALIADO' && /Rodapé solto/.test(e.descricao)));
  ok('tudo o que foi feito sem sinal entra na trilha de auditoria ao ser enviado');

  // ---------- o servidor recusa (a vistoria foi cancelada em outro aparelho) ----------
  await ctx.setOffline(true);
  await ambientes(outra).getByRole('tab', { name: /Instalações elétricas/ }).click();
  await outra.getByRole('group').nth(0).getByRole('button', { name: 'Conforme', exact: true }).click();
  await chamar('POST', `/vistorias/${vistoriaId}/cancelar`, incorp, { motivo: 'Cancelada em outro aparelho (teste)' });
  await ctx.setOffline(false);
  await outra.getByRole('heading', { name: 'Alterações que o servidor recusou' }).waitFor({ timeout: 30000 });
  await outra.getByText('Esta vistoria já foi encerrada').waitFor();
  await outra.getByRole('button', { name: 'Descartar' }).click();
  await outra.getByRole('heading', { name: 'Alterações que o servidor recusou' }).waitFor({ state: 'hidden' });
  ok('alteração recusada pelo servidor não some em silêncio: fica à vista, com o motivo, até o usuário decidir');

  assert.deepEqual(errosDePagina, []);
  console.log(`\n${passos} verificações passaram.\n`);
} catch (erro) {
  console.error('\nFALHOU:', erro.message, '\n');
  // Ajuda no diagnóstico: o que estava na tela no momento da falha
  for (const p of ctx.pages()) {
    console.error('Tela:', p.url(), '\n', (await p.locator('body').innerText().catch(() => '(sem conteúdo)')).slice(0, 700), '\n');
  }
  process.exitCode = 1;
} finally {
  await browser.close();
}
