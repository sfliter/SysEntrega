// Teste ponta a ponta do SysEntrega, pela API.
//
// Sobe a API compilada (dist/) duas vezes — uma com a assinatura interna e
// outra apontando para um rsf-signer de mentira — e percorre o fluxo inteiro
// de uma unidade, da liberação pela construtora até a entrega ao cliente.
//
// Pré-requisitos: banco migrado e com o seed de demonstração (SEED_DEMO=1).
//   npm run build && npx prisma migrate deploy && SEED_DEMO=1 node dist/prisma/seed.js
//   DATABASE_URL=... npm run test:e2e
import { spawn } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { createServer as criarServidorTcp } from 'node:net';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const SENHA = process.env.SEED_SENHA_PADRAO || 'Mudar@123';
const PORTA = 3900;
const PORTA_SIGNER = 3901;
const PORTA_SMTP = 3902;
const API = `http://127.0.0.1:${PORTA}/api`;
const SEGREDO_WEBHOOK = 'segredo-de-teste-do-webhook';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const RUBRICA = `data:image/png;base64,${PNG_1X1.toString('base64')}`;

let passos = 0;
const ok = (descricao) => console.log(`  ✓ ${String(++passos).padStart(2)} ${descricao}`);
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const emHoras = (h) => new Date(Date.now() + h * 3600_000).toISOString();

function cpfAleatorio() {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  for (const n of [9, 10]) {
    const soma = d.slice(0, n).reduce((s, v, i) => s + v * (n + 1 - i), 0);
    d.push(((soma * 10) % 11) % 10);
  }
  return d.join('');
}

// ---------- API em subprocesso ----------

async function subirApi(envExtra) {
  const saida = [];
  const proc = spawn('node', ['dist/src/main.js'], {
    env: {
      ...process.env,
      PORT: String(PORTA),
      JWT_SECRET: 'segredo-de-teste-0123456789abcdef0123456789abcdef',
      CODIGO_NO_LOG: '1',
      SMTP_HOST: '',
      APP_URL: `http://127.0.0.1:${PORTA}`,
      ARMAZENAMENTO_DIR: './armazenamento-teste',
      ...envExtra,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (b) => saida.push(b.toString()));
  proc.stderr.on('data', (b) => saida.push(b.toString()));
  for (let i = 0; i < 100; i++) {
    if (saida.join('').includes('API rodando')) break;
    if (proc.exitCode !== null) throw new Error(`API não subiu:\n${saida.join('')}`);
    await new Promise((r) => setTimeout(r, 200));
  }
  return {
    log: () => saida.join(''),
    parar: () => new Promise((r) => (proc.once('exit', r), proc.kill())),
  };
}

async function chamar(metodo, caminho, { token, corpo, bruto, cabecalhos } = {}) {
  const res = await fetch(`${API}${caminho}`, {
    method: metodo,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(corpo && !(corpo instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...cabecalhos,
    },
    body: corpo instanceof FormData ? corpo : corpo ? JSON.stringify(corpo) : bruto,
  });
  const tipo = res.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, dados };
}

async function exigir(statusEsperado, metodo, caminho, opcoes) {
  const r = await chamar(metodo, caminho, opcoes);
  assert.equal(
    r.status,
    statusEsperado,
    `${metodo} ${caminho} → ${r.status} (esperado ${statusEsperado}): ${JSON.stringify(r.dados).slice(0, 300)}`,
  );
  return r.dados;
}

async function entrar(email) {
  const { accessToken } = await exigir(200, 'POST', '/auth/login', { corpo: { email, senha: SENHA } });
  return accessToken;
}

// ---------- passos reutilizados ----------

async function agendarEntreEmpresas(unidadeId, quemPropoe, quemConfirma) {
  const ag = await exigir(201, 'POST', `/unidades/${unidadeId}/agendamentos`, {
    token: quemPropoe,
    corpo: { opcoes: [emHoras(24), emHoras(48)], local: 'Portaria da obra' },
  });
  await exigir(201, 'POST', `/agendamentos/${ag.id}/confirmar`, {
    token: quemConfirma,
    corpo: { opcaoId: ag.opcoes[0].id },
  });
  return ag;
}

// Faz a vistoria inteira. `ajustes` muda o resultado de itens pelo índice.
async function vistoriar(unidadeId, token, ajustes = {}, conclusao = {}) {
  const v = await exigir(201, 'POST', `/unidades/${unidadeId}/vistorias`, { token });
  const vistoria = await exigir(200, 'GET', `/vistorias/${v.id}`, { token });
  for (const [i, item] of vistoria.itens.entries()) {
    await exigir(200, 'PATCH', `/vistorias/${v.id}/itens/${item.id}`, {
      token,
      corpo: ajustes[i] ?? { resultado: 'CONFORME' },
    });
  }
  return { vistoria, concluir: () => chamar('POST', `/vistorias/${v.id}/concluir`, { token, corpo: conclusao }) };
}

async function estado(unidadeId, token) {
  const d = await exigir(200, 'GET', `/unidades/${unidadeId}`, { token });
  return { ...d, onde: `${d.unidade.etapa}/${d.unidade.status}` };
}

// ---------- 1ª parte: assinatura interna ----------

async function fluxoCompleto(prisma) {
  console.log('\nFluxo completo com assinatura interna');
  const api = await subirApi({ ASSINATURA_PROVEDOR: 'interno', CONTAS_DE_TESTE: '1' });
  try {
    const [admin, construtora, outra, incorp, relac, auditor] = await Promise.all(
      ['admin@sysentrega.local', 'construtora@exemplo.com', 'outra.construtora@exemplo.com',
        'incorporadora@exemplo.com', 'relacionamento@exemplo.com', 'auditor@exemplo.com'].map(entrar),
    );
    await exigir(401, 'POST', '/auth/login', { corpo: { email: 'admin@sysentrega.local', senha: 'errada' } });
    ok('login por perfil; senha errada recusada');

    const emps = await exigir(200, 'GET', '/empreendimentos', { token: incorp });
    const emp = emps.find((e) => e.codigo === '01');
    const numero = `T${Date.now().toString().slice(-7)}`;
    await exigir(403, 'POST', '/unidades', { token: construtora, corpo: { empreendimentoId: emp.id, numeros: [numero] } });
    const [un] = await exigir(201, 'POST', '/unidades', {
      token: incorp,
      corpo: { empreendimentoId: emp.id, bloco: 'Teste', numeros: [numero], andar: '9' },
    });
    await exigir(409, 'POST', '/unidades', { token: incorp, corpo: { empreendimentoId: emp.id, bloco: 'Teste', numeros: [numero] } });
    ok('incorporadora cadastra a unidade; construtora não pode; duplicada recusada');

    await exigir(404, 'GET', `/unidades/${un.id}`, { token: outra });
    await exigir(200, 'GET', `/unidades/${un.id}`, { token: construtora });
    assert.equal((await exigir(200, 'GET', '/unidades', { token: outra })).some((u) => u.id === un.id), false);
    ok('outra construtora não enxerga a unidade');

    // ----- Etapa 1: construtora -> incorporadora -----
    await exigir(403, 'POST', `/unidades/${un.id}/liberar`, { token: incorp, corpo: {} });
    await exigir(403, 'POST', `/unidades/${un.id}/agendamentos`, { token: construtora, corpo: { opcoes: [emHoras(24)] } });
    await exigir(201, 'POST', `/unidades/${un.id}/liberar`, { token: construtora, corpo: { observacao: 'Obra concluída' } });
    assert.equal((await estado(un.id, construtora)).onde, 'CONSTRUTORA_INCORPORADORA/AGUARDANDO_AGENDAMENTO');
    ok('só a construtora libera a unidade');

    await exigir(400, 'POST', `/unidades/${un.id}/agendamentos`, { token: construtora, corpo: { opcoes: [emHoras(-2)] } });
    const ag1 = await exigir(201, 'POST', `/unidades/${un.id}/agendamentos`, {
      token: construtora, corpo: { opcoes: [emHoras(24), emHoras(30)] },
    });
    await exigir(403, 'POST', `/agendamentos/${ag1.id}/confirmar`, { token: construtora, corpo: { opcaoId: ag1.opcoes[0].id } });
    await exigir(201, 'POST', `/agendamentos/${ag1.id}/confirmar`, { token: incorp, corpo: { opcaoId: ag1.opcoes[1].id } });
    assert.equal((await estado(un.id, incorp)).onde, 'CONSTRUTORA_INCORPORADORA/VISTORIA_AGENDADA');
    ok('quem oferece os horários não escolhe; a outra parte confirma');

    const ag2 = await exigir(201, 'POST', `/agendamentos/${ag1.id}/reagendar`, {
      token: incorp, corpo: { motivo: 'Equipe indisponível', opcoes: [emHoras(50)] },
    });
    assert.equal((await estado(un.id, incorp)).onde, 'CONSTRUTORA_INCORPORADORA/AGUARDANDO_AGENDAMENTO');
    await exigir(403, 'POST', `/agendamentos/${ag2.id}/confirmar`, { token: incorp, corpo: { opcaoId: ag2.opcoes[0].id } });
    await exigir(201, 'POST', `/agendamentos/${ag2.id}/confirmar`, { token: construtora, corpo: { opcaoId: ag2.opcoes[0].id } });
    ok('reagendamento cancela o anterior e inverte quem confirma');

    await exigir(403, 'POST', `/unidades/${un.id}/vistorias`, { token: construtora });
    const v1 = await vistoriar(un.id, incorp, { 2: { resultado: 'NAO_CONFORME' } }, { acompanhante: 'Eng. José' });
    const itemRuim = v1.vistoria.itens[2];
    let r = await v1.concluir();
    assert.equal(r.status, 400, 'não conforme sem observação deve ser recusado');
    await exigir(200, 'PATCH', `/vistorias/${v1.vistoria.id}/itens/${itemRuim.id}`, {
      token: incorp, corpo: { observacao: 'Piso trincado na sala' },
    });
    const fotos = new FormData();
    fotos.append('fotos', new Blob([PNG_1X1], { type: 'image/png' }), 'piso.png');
    const [foto] = await exigir(201, 'POST', `/vistorias/${v1.vistoria.id}/itens/${itemRuim.id}/fotos`, { token: incorp, corpo: fotos });
    const repetida = new FormData();
    repetida.append('fotos', new Blob([PNG_1X1], { type: 'image/png' }), 'piso.png');
    const [mesma] = await exigir(201, 'POST', `/vistorias/${v1.vistoria.id}/itens/${itemRuim.id}/fotos`, { token: incorp, corpo: repetida });
    assert.equal(mesma.id, foto.id, 'reenvio da mesma foto devolve a que já existe');
    const itensV1 = (await exigir(200, 'GET', `/vistorias/${v1.vistoria.id}`, { token: incorp })).itens;
    assert.equal(itensV1.find((i) => i.id === itemRuim.id).fotos.length, 1);
    const falsa = new FormData();
    falsa.append('fotos', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'x.png');
    await exigir(400, 'POST', `/vistorias/${v1.vistoria.id}/itens/${itemRuim.id}/fotos`, { token: incorp, corpo: falsa });
    assert.ok((await exigir(200, 'GET', `/fotos/${foto.id}`, { token: construtora })).equals(PNG_1X1));
    await exigir(404, 'GET', `/fotos/${foto.id}`, { token: outra });
    r = await v1.concluir();
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    assert.equal(r.dados.resultado, 'REPROVADA');
    let d = await estado(un.id, construtora);
    assert.equal(d.onde, 'CONSTRUTORA_INCORPORADORA/COM_PENDENCIAS');
    assert.equal(d.pendencias.length, 1);
    ok('vistoria reprovada vira pendência; foto conferida pelo conteúdo, protegida por escopo e sem duplicar no reenvio');

    await exigir(400, 'POST', `/unidades/${un.id}/liberar`, { token: construtora, corpo: {} });
    await exigir(403, 'POST', `/pendencias/${d.pendencias[0].id}/resolver`, { token: incorp, corpo: { resolucao: 'tentativa indevida' } });
    await exigir(201, 'POST', `/pendencias/${d.pendencias[0].id}/resolver`, { token: construtora, corpo: { resolucao: 'Piso substituído' } });
    await exigir(201, 'POST', `/unidades/${un.id}/liberar`, { token: construtora, corpo: {} });
    ok('unidade só é reapresentada com todas as pendências resolvidas pela construtora');

    await agendarEntreEmpresas(un.id, construtora, incorp);
    const v2 = await vistoriar(un.id, incorp, { 0: { resultado: 'RESSALVA', observacao: 'Retoque de pintura no hall' } }, { acompanhante: 'Eng. José' });
    r = await v2.concluir();
    assert.equal(r.dados.resultado, 'APROVADA_COM_RESSALVAS');
    assert.match(r.dados.protocolo, /^SE-\d{4}-[A-Z2-9]{6}$/);
    d = await estado(un.id, construtora);
    assert.equal(d.onde, 'CONSTRUTORA_INCORPORADORA/AGUARDANDO_ASSINATURA');
    const termo1 = d.documentos[0];
    const pdf1 = await exigir(200, 'GET', `/documentos/${termo1.id}/pdf`, { token: construtora });
    assert.equal(pdf1.subarray(0, 5).toString(), '%PDF-');
    assert.equal(sha256(pdf1), termo1.sha256);
    await exigir(404, 'GET', `/documentos/${termo1.id}/pdf`, { token: outra });
    ok('vistoria aprovada emite o termo em PDF, com hash conferido');

    const [sigConstr, sigIncorp] = termo1.envelope.signatarios;
    assert.deepEqual([sigConstr.parte, sigIncorp.parte], ['CONSTRUTORA', 'INCORPORADORA']);
    await exigir(403, 'POST', `/signatarios/${sigConstr.id}/assinar`, { token: admin, corpo: { senha: SENHA } });
    await exigir(403, 'POST', `/signatarios/${sigConstr.id}/assinar`, { token: incorp, corpo: { senha: SENHA } });
    await exigir(403, 'POST', `/signatarios/${sigConstr.id}/assinar`, { token: construtora, corpo: { senha: 'senha-errada' } });
    await exigir(200, 'POST', `/signatarios/${sigConstr.id}/assinar`, { token: construtora, corpo: { senha: SENHA, assinaturaImagem: RUBRICA } });
    assert.equal((await estado(un.id, incorp)).onde, 'CONSTRUTORA_INCORPORADORA/AGUARDANDO_ASSINATURA');
    await exigir(200, 'POST', `/signatarios/${sigIncorp.id}/assinar`, { token: incorp, corpo: { senha: SENHA } });
    d = await estado(un.id, incorp);
    assert.equal(d.onde, 'INCORPORADORA_RELACIONAMENTO/AGUARDANDO_LIBERACAO');
    ok('cada parte assina só por si (nem o administrador assina por outra); as duas assinaturas concluem a etapa 1');

    const assinado1 = await exigir(200, 'GET', `/documentos/${termo1.id}/pdf?versao=assinado`, { token: incorp });
    const conf = await exigir(200, 'GET', `/publico/verificar/${termo1.protocolo}?hash=${sha256(assinado1)}`);
    assert.equal(conf.confere, 'ASSINADO');
    assert.equal((await exigir(200, 'GET', `/publico/verificar/${termo1.protocolo}?hash=${'a'.repeat(64)}`)).confere, 'DIFERENTE');
    assert.equal(JSON.stringify(conf).includes('@'), false, 'a conferência pública não expõe e-mail');
    ok('conferência pública do termo pelo protocolo e pelo hash do arquivo');

    // ----- Etapa 2: incorporadora -> central de relacionamento -----
    await exigir(403, 'POST', `/unidades/${un.id}/liberar`, { token: relac, corpo: {} });
    await exigir(201, 'POST', `/unidades/${un.id}/liberar`, { token: incorp, corpo: {} });
    assert.equal((await estado(un.id, relac)).onde, 'INCORPORADORA_RELACIONAMENTO/AGUARDANDO_CONFERENCIA');
    await exigir(403, 'POST', `/unidades/${un.id}/vistorias`, { token: incorp });
    const v3 = await vistoriar(un.id, relac);
    r = await v3.concluir();
    assert.equal(r.dados.resultado, 'APROVADA');
    d = await estado(un.id, relac);
    for (const s of d.documentos[0].envelope.signatarios) {
      await exigir(200, 'POST', `/signatarios/${s.id}/assinar`, {
        token: s.parte === 'INCORPORADORA' ? incorp : relac, corpo: { senha: SENHA },
      });
    }
    assert.equal((await estado(un.id, relac)).onde, 'RELACIONAMENTO_CLIENTE/AGUARDANDO_AGENDAMENTO');
    ok('etapa 2: repasse sem agendamento, conferência e aceite das duas partes');

    const visaoConstrutora = await estado(un.id, construtora);
    assert.equal(visaoConstrutora.documentos.length, 1, 'construtora só vê o termo da etapa 1');
    assert.equal(visaoConstrutora.vistorias.every((v) => v.etapa === 'CONSTRUTORA_INCORPORADORA'), true);

    // ----- Etapa 3: central de relacionamento -> cliente -----
    await exigir(400, 'POST', `/unidades/${un.id}/agendamentos`, { token: relac, corpo: { opcoes: [emHoras(24)] } });
    await exigir(400, 'POST', '/clientes', { token: relac, corpo: { nome: 'CPF Inválido', cpfCnpj: '11111111111' } });
    const cliente = await exigir(201, 'POST', '/clientes', {
      token: relac, corpo: { nome: 'João Pereira Lima', cpfCnpj: cpfAleatorio(), email: 'joao@exemplo.com' },
    });
    await exigir(403, 'PATCH', `/unidades/${un.id}`, { token: construtora, corpo: { clienteId: cliente.id } });
    await exigir(200, 'PATCH', `/unidades/${un.id}`, { token: relac, corpo: { clienteId: cliente.id } });
    assert.equal((await estado(un.id, construtora)).unidade.cliente, null, 'construtora não vê o cliente');
    ok('agendamento com o cliente exige cliente vinculado; CPF validado; construtora não vê dados do cliente');

    const ag3 = await exigir(201, 'POST', `/unidades/${un.id}/agendamentos`, { token: relac, corpo: { opcoes: [emHoras(24), emHoras(72)] } });
    assert.ok(ag3.tokenCliente);
    await exigir(404, 'GET', '/publico/agendamento/token-inexistente');
    const pub = await exigir(200, 'GET', `/publico/agendamento/${ag3.tokenCliente}`);
    assert.equal(pub.cliente, 'João P. L.');
    await exigir(200, 'POST', `/publico/agendamento/${ag3.tokenCliente}/confirmar`, { corpo: { opcaoId: pub.opcoes[1].id } });
    await exigir(400, 'POST', `/publico/agendamento/${ag3.tokenCliente}/confirmar`, { corpo: { opcaoId: pub.opcoes[0].id } });
    d = await estado(un.id, relac);
    assert.equal(d.onde, 'RELACIONAMENTO_CLIENTE/VISTORIA_AGENDADA');
    assert.equal(d.agendamentos[0].confirmadoPeloCliente, true);
    ok('cliente escolhe o horário pelo link público, uma única vez');

    const v4 = await vistoriar(un.id, relac);
    r = await v4.concluir();
    assert.equal(r.status, 200, JSON.stringify(r.dados));
    d = await estado(un.id, relac);
    const termo3 = d.documentos[0];
    const sigRelac = termo3.envelope.signatarios.find((s) => s.parte === 'RELACIONAMENTO');
    const sigCliente = termo3.envelope.signatarios.find((s) => s.parte === 'CLIENTE');
    assert.ok(sigCliente.token);
    assert.equal((await estado(un.id, incorp)).documentos[0].envelope.signatarios.find((s) => s.parte === 'CLIENTE').token, null);
    await exigir(403, 'POST', `/signatarios/${sigCliente.id}/assinar`, { token: relac, corpo: { senha: SENHA } });
    await exigir(200, 'POST', `/signatarios/${sigRelac.id}/assinar`, { token: relac, corpo: { senha: SENHA } });

    const link = `/publico/assinatura/${sigCliente.token}`;
    const tela = await exigir(200, 'GET', link);
    assert.equal(tela.pendente, true);
    assert.equal(tela.email, 'jo***@exemplo.com');
    assert.equal((await exigir(200, 'GET', `${link}/documento`)).subarray(0, 5).toString(), '%PDF-');
    await exigir(400, 'POST', `${link}/assinar`, { corpo: { codigo: '123456' } });
    const envio = await exigir(200, 'POST', `${link}/codigo`);
    assert.equal(envio.ensaio, true);
    await exigir(429, 'POST', `${link}/codigo`);
    const codigo = api.log().match(new RegExp(`${termo3.protocolo}: (\\d{6})`))[1];
    const errado = codigo === '000000' ? '111111' : '000000';
    await exigir(400, 'POST', `${link}/assinar`, { corpo: { codigo: errado } });
    await exigir(200, 'POST', `${link}/assinar`, { corpo: { codigo, assinaturaImagem: RUBRICA, localizacao: '-23.5505,-46.6333' } });
    await exigir(400, 'POST', `${link}/assinar`, { corpo: { codigo } });
    d = await estado(un.id, relac);
    assert.equal(d.onde, 'RELACIONAMENTO_CLIENTE/ENTREGUE');
    assert.equal(d.documentos[0].envelope.status, 'CONCLUIDO');
    ok('cliente assina pelo link com código de uso único; código errado e reuso recusados; unidade ENTREGUE');

    // O código só serve uma vez e nunca fica em claro no banco
    const noBanco = await prisma.signatario.findUnique({ where: { id: sigCliente.id } });
    assert.equal(noBanco.codigoHash, null);
    assert.equal(noBanco.metodo, 'CODIGO_USO_UNICO');

    // ----- Auditoria -----
    const hist = await exigir(200, 'GET', `/unidades/${un.id}/historico`, { token: relac });
    const acoes = hist.map((e) => e.acao);
    for (const esperada of ['UNIDADE_CADASTRADA', 'UNIDADE_LIBERADA', 'AGENDAMENTO_PROPOSTO', 'AGENDAMENTO_CONFIRMADO',
      'AGENDAMENTO_CANCELADO', 'VISTORIA_INICIADA', 'VISTORIA_ITEM_AVALIADO', 'VISTORIA_FOTO_ADICIONADA',
      'VISTORIA_CONCLUIDA', 'PENDENCIA_RESOLVIDA', 'UNIDADE_REAPRESENTADA', 'TERMO_EMITIDO', 'TERMO_ASSINADO',
      'ASSINATURA_SENHA_INCORRETA', 'ETAPA_CONCLUIDA', 'CLIENTE_VINCULADO', 'CODIGO_ASSINATURA_ENVIADO',
      'CODIGO_ASSINATURA_INCORRETO', 'DOCUMENTO_BAIXADO', 'UNIDADE_ENTREGUE']) {
      assert.ok(acoes.includes(esperada), `histórico sem ${esperada}`);
    }
    const histConstrutora = await exigir(200, 'GET', `/unidades/${un.id}/historico`, { token: construtora });
    assert.ok(histConstrutora.length > 5 && histConstrutora.length < hist.length);
    assert.equal(histConstrutora.some((e) => /João|Pereira/.test(e.descricao)), false);
    assert.equal(histConstrutora.every((e) => !e.etapa || e.etapa === 'CONSTRUTORA_INCORPORADORA'), true);
    ok(`histórico da unidade com ${hist.length} eventos; a construtora só vê os da etapa dela`);

    await exigir(201, 'POST', `/unidades/${un.id}/anotacoes`, { token: relac, corpo: { texto: 'Cliente pediu segunda via do manual.' } });
    await exigir(403, 'POST', `/unidades/${un.id}/anotacoes`, { token: construtora, corpo: { texto: 'Etapa encerrada para a construtora.' } });
    await exigir(403, 'POST', `/unidades/${un.id}/anotacoes`, { token: auditor, corpo: { texto: 'Auditor não escreve.' } });
    const comAnotacao = await exigir(200, 'GET', `/unidades/${un.id}/historico`, { token: relac });
    assert.ok(comAnotacao.some((e) => e.acao === 'ANOTACAO' && /segunda via/.test(e.descricao)));
    hist.push(comAnotacao.at(-1));
    const planilha = (await exigir(200, 'GET', '/unidades/exportar.csv?busca=' + numero, { token: incorp })).toString();
    assert.ok(planilha.includes(numero) && planilha.includes('Entregue ao cliente'));
    assert.equal((await exigir(200, 'GET', '/unidades/exportar.csv', { token: outra })).toString().includes(numero), false);
    assert.equal((await exigir(200, 'GET', '/saude')).ok, true);
    ok('anotações entram no histórico (só de quem participa da etapa); planilha de unidades respeita o escopo; /saude responde');

    await exigir(403, 'GET', '/auditoria', { token: construtora });
    await exigir(403, 'GET', '/auditoria', { token: relac });
    const trilha = await exigir(200, 'GET', `/auditoria?unidadeId=${un.id}&porPagina=5`, { token: auditor });
    assert.equal(trilha.total, hist.length);
    assert.ok(trilha.eventos[0].ip, 'a trilha completa guarda o IP');
    await exigir(403, 'POST', `/unidades/${un.id}/liberar`, { token: auditor, corpo: {} });
    const csv = await exigir(200, 'GET', `/auditoria/exportar.csv?unidadeId=${un.id}`, { token: auditor });
    assert.ok(csv.toString().includes('UNIDADE_ENTREGUE'));
    ok('trilha completa só para administrador e auditor; auditor não escreve; exportação CSV');

    const integra = await exigir(200, 'GET', '/auditoria/verificar', { token: auditor });
    assert.equal(integra.integra, true);
    await assert.rejects(prisma.$executeRawUnsafe(`UPDATE "EventoAuditoria" SET descricao = 'adulterado' WHERE seq = 1`), /imutavel/);
    await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM "EventoAuditoria" WHERE seq = 1`), /imutavel/);
    await assert.rejects(prisma.$executeRawUnsafe(`TRUNCATE "EventoAuditoria"`), /imutavel/);
    ok(`cadeia de hashes íntegra (${integra.conferidos} eventos); o banco recusa UPDATE, DELETE e TRUNCATE na trilha`);

    // Com o gatilho desligado (só o dono da tabela consegue), a adulteração
    // passa pelo banco — e é a cadeia de hashes que a denuncia.
    const alvo = hist[3].seq;
    await prisma.$executeRawUnsafe(`ALTER TABLE "EventoAuditoria" DISABLE TRIGGER evento_auditoria_sem_alteracao`);
    try {
      const [{ descricao }] = await prisma.$queryRawUnsafe(`SELECT descricao FROM "EventoAuditoria" WHERE seq = ${alvo}`);
      await prisma.$executeRawUnsafe(`UPDATE "EventoAuditoria" SET descricao = 'adulterado' WHERE seq = ${alvo}`);
      const quebrada = await exigir(200, 'GET', '/auditoria/verificar', { token: auditor });
      assert.equal(quebrada.integra, false);
      assert.equal(quebrada.primeiroEventoInvalido, alvo);
      await prisma.$executeRawUnsafe(`UPDATE "EventoAuditoria" SET descricao = $1 WHERE seq = ${alvo}`, descricao);
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "EventoAuditoria" ENABLE TRIGGER evento_auditoria_sem_alteracao`);
    }
    assert.equal((await exigir(200, 'GET', '/auditoria/verificar', { token: auditor })).integra, true);
    ok('adulteração direta no banco é apontada pela verificação, no evento exato');

    // Recusa de assinatura devolve a unidade com pendência
    const numero2 = `R${Date.now().toString().slice(-7)}`;
    const [un2] = await exigir(201, 'POST', '/unidades', { token: incorp, corpo: { empreendimentoId: emp.id, bloco: 'Teste', numeros: [numero2] } });
    await exigir(201, 'POST', `/unidades/${un2.id}/liberar`, { token: construtora, corpo: {} });
    await agendarEntreEmpresas(un2.id, incorp, construtora);
    await (await vistoriar(un2.id, incorp, {}, { acompanhante: 'Eng. José' })).concluir();
    d = await estado(un2.id, construtora);
    await exigir(200, 'POST', `/signatarios/${d.documentos[0].envelope.signatarios[0].id}/recusar`, {
      token: construtora, corpo: { motivo: 'Metragem divergente no termo' },
    });
    d = await estado(un2.id, construtora);
    assert.equal(d.onde, 'CONSTRUTORA_INCORPORADORA/COM_PENDENCIAS');
    assert.equal(d.documentos[0].envelope.status, 'RECUSADO');
    assert.match(d.pendencias[0].descricao, /Metragem divergente/);
    ok('recusa de assinatura encerra o termo e devolve a unidade com pendência');

    // Sessão: desativar o usuário derruba o acesso na hora, sem esperar o token vencer
    const email = `temp${Date.now()}@exemplo.com`;
    const temp = await exigir(201, 'POST', '/usuarios', {
      token: admin, corpo: { nome: 'Usuário Temporário', email, perfil: 'INCORPORADORA', senha: SENHA },
    });
    assert.equal('senhaHash' in temp, false);
    const tokenTemp = await entrar(email);
    await exigir(200, 'GET', '/unidades', { token: tokenTemp });
    await exigir(200, 'PATCH', `/usuarios/${temp.id}`, {
      token: admin, corpo: { nome: 'Usuário Temporário', email, perfil: 'AUDITOR', ativo: true },
    });
    await exigir(403, 'POST', '/unidades', { token: tokenTemp, corpo: { empreendimentoId: emp.id, numeros: ['X1'] } });
    await exigir(200, 'PATCH', `/usuarios/${temp.id}`, {
      token: admin, corpo: { nome: 'Usuário Temporário', email, perfil: 'AUDITOR', ativo: false },
    });
    await exigir(401, 'GET', '/unidades', { token: tokenTemp });
    await exigir(401, 'POST', '/auth/login', { corpo: { email, senha: SENHA } });
    ok('mudança de perfil e desativação de usuário valem na hora, mesmo com o token ainda válido');

    await exigir(403, 'POST', '/auth/trocar-senha', { token: outra, corpo: { senhaAtual: 'errada', novaSenha: 'NovaSenha#2026' } });
    await exigir(400, 'POST', '/auth/trocar-senha', { token: outra, corpo: { senhaAtual: SENHA, novaSenha: 'curta' } });
    await exigir(200, 'POST', '/auth/trocar-senha', { token: outra, corpo: { senhaAtual: SENHA, novaSenha: 'NovaSenha#2026' } });
    await exigir(401, 'POST', '/auth/login', { corpo: { email: 'outra.construtora@exemplo.com', senha: SENHA } });
    await exigir(200, 'POST', '/auth/login', { corpo: { email: 'outra.construtora@exemplo.com', senha: 'NovaSenha#2026' } });
    await exigir(200, 'POST', '/auth/trocar-senha', { token: outra, corpo: { senhaAtual: 'NovaSenha#2026', novaSenha: SENHA } });
    ok('usuário troca a própria senha, conferindo a atual');

    // Conta de teste: um login que vê (e opera) o sistema como qualquer perfil
    const login = await exigir(200, 'POST', '/auth/login', { corpo: { email: 'teste@sysentrega.local', senha: SENHA } });
    assert.equal(login.usuario.contaTeste, true);
    assert.equal(login.usuario.perfil, 'AUDITOR', 'sem escolher perfil, a conta de teste só lê');
    await exigir(403, 'POST', '/unidades', { token: login.accessToken, corpo: { empreendimentoId: emp.id, numeros: ['X2'] } });
    const opcoes = await exigir(200, 'GET', '/auth/perfis-de-teste', { token: login.accessToken });
    assert.deepEqual([...new Set(opcoes.map((o) => o.perfil))].sort(), ['ADMINISTRADOR', 'AUDITOR', 'CONSTRUTORA', 'INCORPORADORA', 'RELACIONAMENTO']);
    const verComo = async (rotulo) => {
      const o = opcoes.find((x) => x.rotulo.includes(rotulo));
      return (await exigir(200, 'POST', '/auth/ver-como', { token: login.accessToken, corpo: { perfil: o.perfil, organizacaoId: o.organizacaoId } })).accessToken;
    };
    const tIncorp = await verComo('Incorporadora');
    const [unT] = await exigir(201, 'POST', '/unidades', { token: tIncorp, corpo: { empreendimentoId: emp.id, bloco: 'Teste', numeros: [`Q${Date.now().toString().slice(-7)}`] } });
    const tConstrutora = await verComo('Construtora Exemplo');
    const tOutra = await verComo('Outra Construtora');
    await exigir(404, 'GET', `/unidades/${unT.id}`, { token: tOutra });
    await exigir(403, 'POST', `/unidades/${unT.id}/liberar`, { token: tIncorp, corpo: {} });
    await exigir(201, 'POST', `/unidades/${unT.id}/liberar`, { token: tConstrutora, corpo: {} });
    const histT = await exigir(200, 'GET', `/unidades/${unT.id}/historico`, { token: tIncorp });
    const liberou = histT.find((e) => e.acao === 'UNIDADE_LIBERADA');
    assert.match(liberou.atorNome, /teste/i, 'a ação da conta de teste fica identificada');
    assert.equal(liberou.atorPerfil, 'CONSTRUTORA');
    assert.equal(liberou.organizacao, 'Construtora Exemplo Ltda');
    const tAuditor = await verComo('Auditor');
    await exigir(403, 'POST', `/unidades/${unT.id}/anotacoes`, { token: tAuditor, corpo: { texto: 'auditor não escreve' } });
    assert.ok((await exigir(200, 'GET', '/auditoria?acao=CONTA_TESTE_VER_COMO', { token: tAuditor })).total >= 4);
    // Usuário comum não troca de perfil, nem forjando o pedido
    await exigir(403, 'GET', '/auth/perfis-de-teste', { token: incorp });
    await exigir(403, 'POST', '/auth/ver-como', { token: construtora, corpo: { perfil: 'ADMINISTRADOR' } });
    ok('conta de teste: um login vê e opera como cada perfil, com escopo e regras do perfil escolhido, e tudo fica identificado');

    const alvoForca = `forca${Date.now()}@exemplo.com`;
    for (let i = 0; i < 10; i++) await exigir(401, 'POST', '/auth/login', { corpo: { email: alvoForca, senha: 'x' } });
    await exigir(429, 'POST', '/auth/login', { corpo: { email: alvoForca, senha: 'x' } });
    await exigir(200, 'POST', '/auth/login', { corpo: { email: 'auditor@exemplo.com', senha: SENHA } });
    ok('login bloqueia após 10 tentativas por e-mail, sem travar os demais usuários');
  } finally {
    await api.parar();
  }
}

// ---------- 2ª parte: rsf-signer (de mentira) ----------

function subirRsfSignerFalso() {
  const pdfAssinado = Buffer.from('%PDF-1.4\n% assinado pelo rsf-signer de teste\n%%EOF\n');
  const recebidos = [];
  const ids = [];
  const servidor = createServer((req, res) => {
    const partes = [];
    req.on('data', (b) => partes.push(b));
    req.on('end', () => {
      const responder = (status, corpo, tipo = 'application/json') => {
        res.writeHead(status, { 'Content-Type': tipo });
        res.end(tipo === 'application/json' ? JSON.stringify(corpo) : corpo);
      };
      if (req.headers.authorization !== 'Bearer chave-de-teste') return responder(401, { erro: 'chave' });
      if (req.method === 'POST' && req.url === '/api/v1/envelopes') {
        const corpo = JSON.parse(Buffer.concat(partes).toString());
        recebidos.push(corpo);
        return responder(201, {
          id: (ids.push(`env_${Date.now()}_${recebidos.length}`), ids.at(-1)),
          status: 'PENDENTE',
          signatarios: corpo.signatarios.map((s, i) => ({
            referencia: s.referencia, id: `sig_${i}`, urlAssinatura: `https://signer.exemplo/assinar/${s.referencia}`,
          })),
        });
      }
      if (req.method === 'GET' && req.url.endsWith('/documento-assinado')) return responder(200, pdfAssinado, 'application/pdf');
      responder(404, { erro: 'rota' });
    });
  });
  return new Promise((resolve) =>
    servidor.listen(PORTA_SIGNER, '127.0.0.1', () =>
      resolve({ recebidos, ids, pdfAssinado, parar: () => new Promise((r) => servidor.close(r)) }),
    ),
  );
}

async function fluxoRsfSigner() {
  console.log('\nAssinatura pelo rsf-signer (serviço simulado, contrato de docs/integracao-rsf-signer.md)');
  const signer = await subirRsfSignerFalso();
  const api = await subirApi({
    ASSINATURA_PROVEDOR: 'rsf-signer',
    CONTAS_DE_TESTE: '', // desligadas nesta instância, mesmo que o ambiente as ligue
    RSF_SIGNER_URL: `http://127.0.0.1:${PORTA_SIGNER}`,
    RSF_SIGNER_API_KEY: 'chave-de-teste',
    RSF_SIGNER_WEBHOOK_SECRET: SEGREDO_WEBHOOK,
  });
  try {
    const [construtora, incorp] = await Promise.all(['construtora@exemplo.com', 'incorporadora@exemplo.com'].map(entrar));
    // Aqui o servidor sobe sem CONTAS_DE_TESTE: a conta de teste é só um usuário de leitura
    const teste = await exigir(200, 'POST', '/auth/login', { corpo: { email: 'teste@sysentrega.local', senha: SENHA } });
    assert.equal(teste.usuario.contaTeste, undefined);
    await exigir(403, 'POST', '/auth/ver-como', { token: teste.accessToken, corpo: { perfil: 'ADMINISTRADOR' } });
    await exigir(403, 'GET', '/auth/perfis-de-teste', { token: teste.accessToken });
    ok('com as contas de teste desligadas no servidor, a troca de perfil não existe');
    const emp = (await exigir(200, 'GET', '/empreendimentos', { token: incorp })).find((e) => e.codigo === '01');
    const [un] = await exigir(201, 'POST', '/unidades', {
      token: incorp, corpo: { empreendimentoId: emp.id, bloco: 'Teste', numeros: [`S${Date.now().toString().slice(-7)}`] },
    });
    await exigir(201, 'POST', `/unidades/${un.id}/liberar`, { token: construtora, corpo: {} });
    await agendarEntreEmpresas(un.id, construtora, incorp);
    await (await vistoriar(un.id, incorp, {}, { acompanhante: 'Eng. José' })).concluir();

    let d = await estado(un.id, incorp);
    const env = d.documentos[0].envelope;
    assert.equal(env.provedor, 'RSF_SIGNER');
    assert.equal(signer.recebidos.length, 1);
    const enviado = signer.recebidos[0];
    assert.equal(enviado.referencia, d.documentos[0].protocolo);
    assert.equal(sha256(Buffer.from(enviado.documento.conteudoBase64, 'base64')), d.documentos[0].sha256);
    assert.equal(enviado.signatarios.length, 2);
    assert.ok(env.signatarios.every((s) => s.urlAssinatura?.startsWith('https://signer.exemplo/')));
    ok('termo emitido é enviado ao rsf-signer com o PDF, o hash e os signatários; links de assinatura guardados');

    await exigir(403, 'POST', `/signatarios/${env.signatarios[0].id}/assinar`, { token: construtora, corpo: { senha: SENHA } });
    ok('termo no rsf-signer não aceita a assinatura interna');

    const webhook = (corpo, segredo = SEGREDO_WEBHOOK) => {
      const bruto = JSON.stringify(corpo);
      return chamar('POST', '/assinaturas/webhooks/rsf-signer', {
        bruto,
        cabecalhos: {
          'Content-Type': 'application/json',
          'X-RSF-Signature': `sha256=${createHmac('sha256', segredo).update(bruto).digest('hex')}`,
        },
      });
    };
    const assinou = (s, nome) => ({
      evento: 'signatario.assinou',
      envelopeId: signer.ids.at(-1),
      signatario: { referencia: s.id, nome, assinadoEm: new Date().toISOString(), ip: '203.0.113.9' },
    });
    assert.equal((await webhook(assinou(env.signatarios[0], 'Carlos Construtor'), 'segredo-errado')).status, 403);
    assert.equal((await chamar('POST', '/assinaturas/webhooks/rsf-signer', { corpo: assinou(env.signatarios[0], 'X') })).status, 403);
    assert.equal((await estado(un.id, incorp)).documentos[0].envelope.signatarios[0].status, 'PENDENTE');
    ok('webhook sem HMAC válido é recusado e não altera nada');

    assert.equal((await webhook(assinou(env.signatarios[0], 'Carlos Construtor'))).status, 200);
    assert.equal((await webhook(assinou(env.signatarios[0], 'Carlos Construtor'))).status, 200);
    assert.equal((await estado(un.id, incorp)).onde, 'CONSTRUTORA_INCORPORADORA/AGUARDANDO_ASSINATURA');
    assert.equal((await webhook(assinou(env.signatarios[1], 'Inês Incorporadora'))).status, 200);
    d = await estado(un.id, incorp);
    assert.equal(d.onde, 'INCORPORADORA_RELACIONAMENTO/AGUARDANDO_LIBERACAO');
    assert.equal(d.documentos[0].envelope.status, 'CONCLUIDO');
    assert.equal(d.documentos[0].envelope.signatarios[0].metodo, 'RSF_SIGNER');
    assert.equal(d.documentos[0].sha256Assinado, sha256(signer.pdfAssinado));
    ok('webhooks do rsf-signer concluem a etapa (repetidos não duplicam) e o PDF assinado de lá é guardado');

    const hist = await exigir(200, 'GET', `/unidades/${un.id}/historico`, { token: incorp });
    assert.ok(hist.some((e) => e.acao === 'RSF_SIGNER_ENVIADO'));
    assert.ok(hist.some((e) => e.acao === 'TERMO_ASSINADO' && e.atorTipo === 'INTEGRACAO'));
    ok('envio e assinaturas do rsf-signer ficam na trilha de auditoria');
  } finally {
    await api.parar();
    await signer.parar();
  }
}

// ---------- 3ª parte: e-mail (servidor SMTP de mentira) ----------

function subirSmtpFalso() {
  const mensagens = [];
  const servidor = criarServidorTcp((socket) => {
    let emDados = false;
    let corpo = '';
    let para = [];
    socket.write('220 smtp.teste ESMTP\r\n');
    socket.on('data', (pedaco) => {
      for (const linha of pedaco.toString().split(/(?<=\r\n)/)) {
        if (emDados) {
          corpo += linha;
          if (corpo.endsWith('\r\n.\r\n')) {
            mensagens.push({ para, corpo });
            emDados = false; corpo = ''; para = [];
            socket.write('250 OK\r\n');
          }
          continue;
        }
        const comando = linha.trim().toUpperCase();
        if (comando.startsWith('EHLO') || comando.startsWith('HELO')) socket.write('250 smtp.teste\r\n');
        else if (comando.startsWith('RCPT TO')) { para.push(linha.match(/<(.+)>/)?.[1]); socket.write('250 OK\r\n'); }
        else if (comando === 'DATA') { emDados = true; socket.write('354 Envie\r\n'); }
        else if (comando === 'QUIT') { socket.write('221 Tchau\r\n'); socket.end(); }
        else if (comando) socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => undefined);
  });
  return new Promise((resolve) =>
    servidor.listen(PORTA_SMTP, '127.0.0.1', () =>
      resolve({ mensagens, parar: () => new Promise((r) => servidor.close(r)) }),
    ),
  );
}

// Corpo de e-mail em texto: desfaz o quoted-printable para poder procurar nele
const texto = (m) => m.corpo.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
const esperar = async (condicao, ms = 6000) => {
  for (const fim = Date.now() + ms; Date.now() < fim; ) {
    if (condicao()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};

async function fluxoEmail(prisma) {
  console.log('\nE-mail de verdade (servidor SMTP simulado): código do cliente e avisos');
  const smtp = await subirSmtpFalso();
  const api = await subirApi({
    ASSINATURA_PROVEDOR: 'interno',
    CODIGO_NO_LOG: '',
    SMTP_HOST: '127.0.0.1',
    SMTP_PORT: String(PORTA_SMTP),
    SMTP_FROM: 'sysentrega@teste.local',
    NOTIFICAR_POR_EMAIL: '1',
  });
  try {
    const [construtora, incorp, relac] = await Promise.all(
      ['construtora@exemplo.com', 'incorporadora@exemplo.com', 'relacionamento@exemplo.com'].map(entrar),
    );
    const emp = (await exigir(200, 'GET', '/empreendimentos', { token: incorp })).find((e) => e.codigo === '01');
    const numero = `M${Date.now().toString().slice(-7)}`;
    const [un] = await exigir(201, 'POST', '/unidades', { token: incorp, corpo: { empreendimentoId: emp.id, bloco: 'Teste', numeros: [numero] } });

    await exigir(201, 'POST', `/unidades/${un.id}/liberar`, { token: construtora, corpo: {} });
    assert.ok(await esperar(() => smtp.mensagens.some((m) => texto(m).includes(numero) && texto(m).includes('Falta combinar'))), 'aviso de liberação não chegou');
    // Na etapa 1 as duas partes podem oferecer horários: as duas são avisadas
    const avisados = smtp.mensagens.filter((m) => texto(m).includes(numero)).flatMap((m) => m.para);
    assert.ok(avisados.includes('construtora@exemplo.com') && avisados.includes('incorporadora@exemplo.com'));
    assert.equal(avisados.includes('relacionamento@exemplo.com'), false, 'quem não participa da etapa não é avisado');
    assert.equal(smtp.mensagens.some((m) => m.para.includes('outra.construtora@exemplo.com')), false, 'outra construtora não recebe avisos');
    ok('mudança de situação avisa por e-mail quem precisa agir, sem vazar para outra construtora');

    // Leva a unidade até a assinatura do cliente
    await agendarEntreEmpresas(un.id, construtora, incorp);
    await (await vistoriar(un.id, incorp, {}, { acompanhante: 'Eng. José' })).concluir();
    let d = await estado(un.id, incorp);
    for (const s of d.documentos[0].envelope.signatarios) {
      await exigir(200, 'POST', `/signatarios/${s.id}/assinar`, { token: s.parte === 'CONSTRUTORA' ? construtora : incorp, corpo: { senha: SENHA } });
    }
    await exigir(201, 'POST', `/unidades/${un.id}/liberar`, { token: incorp, corpo: {} });
    await (await vistoriar(un.id, relac)).concluir();
    d = await estado(un.id, relac);
    for (const s of d.documentos[0].envelope.signatarios) {
      await exigir(200, 'POST', `/signatarios/${s.id}/assinar`, { token: s.parte === 'INCORPORADORA' ? incorp : relac, corpo: { senha: SENHA } });
    }
    const emailCliente = `cliente${Date.now()}@teste.local`;
    const cliente = await exigir(201, 'POST', '/clientes', { token: relac, corpo: { nome: 'Ana Beatriz Costa', cpfCnpj: cpfAleatorio(), email: emailCliente } });
    await exigir(200, 'PATCH', `/unidades/${un.id}`, { token: relac, corpo: { clienteId: cliente.id } });
    const ag = await exigir(201, 'POST', `/unidades/${un.id}/agendamentos`, { token: relac, corpo: { opcoes: [emHoras(24)] } });
    await exigir(200, 'POST', `/publico/agendamento/${ag.tokenCliente}/confirmar`, { corpo: { opcaoId: ag.opcoes[0].id } });
    await (await vistoriar(un.id, relac)).concluir();
    d = await estado(un.id, relac);
    const sigCliente = d.documentos[0].envelope.signatarios.find((s) => s.parte === 'CLIENTE');

    assert.ok(await esperar(() => smtp.mensagens.some((m) => m.para.includes(emailCliente) && texto(m).includes(`/assinar/${sigCliente.token}`))), 'link de assinatura não chegou ao cliente');
    const link = `/publico/assinatura/${sigCliente.token}`;
    const envio = await exigir(200, 'POST', `${link}/codigo`);
    assert.equal(envio.ensaio, false);
    assert.ok(await esperar(() => smtp.mensagens.some((m) => m.para.includes(emailCliente) && /\s\d{6}\s/.test(texto(m)) && texto(m).includes('para assinar o termo'))));
    const codigo = texto(smtp.mensagens.findLast((m) => m.para.includes(emailCliente) && texto(m).includes('para assinar o termo'))).match(/\s(\d{6})\s/)[1];
    assert.equal(api.log().includes(codigo), false, 'com e-mail configurado o código não vai para o log');
    await exigir(200, 'POST', `/signatarios/${d.documentos[0].envelope.signatarios.find((s) => s.parte === 'RELACIONAMENTO').id}/assinar`, { token: relac, corpo: { senha: SENHA } });
    await exigir(200, 'POST', `${link}/assinar`, { corpo: { codigo, assinaturaImagem: RUBRICA } });
    assert.equal((await estado(un.id, relac)).onde, 'RELACIONAMENTO_CLIENTE/ENTREGUE');
    const noBanco = await prisma.signatario.findUnique({ where: { id: sigCliente.id } });
    assert.equal(noBanco.codigoCanal, 'email');
    ok('cliente recebe o link e o código por e-mail e assina; o código não aparece no log do servidor');
  } finally {
    await api.parar();
    await smtp.parar();
  }
}

const prisma = new PrismaClient();
try {
  await fluxoCompleto(prisma);
  await fluxoRsfSigner();
  await fluxoEmail(prisma);
  console.log(`\n${passos} verificações passaram.\n`);
} catch (erro) {
  console.error('\nFALHOU:', erro.message, '\n');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
