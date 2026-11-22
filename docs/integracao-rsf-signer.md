# Integração SysEntrega ↔ rsf-signer

> **Situação:** o rsf-signer ainda não tem API publicada. Este documento descreve o **contrato que o SysEntrega espera** — serve de proposta para a API do rsf-signer. O adaptador do SysEntrega (`backend/src/assinaturas/rsf-signer.provedor.ts`) implementa exatamente o que está aqui e foi testado contra um serviço simulado (`backend/test/fluxo.e2e.mjs`), **não contra o rsf-signer real**.
>
> Se a API real sair diferente, o ajuste fica só nesse arquivo: rotas, nomes de campos e formato do webhook. Nada mais no sistema conhece o rsf-signer.

## Visão geral

```
SysEntrega                                          rsf-signer
    │  vistoria aprovada → emite o termo (PDF)          │
    │                                                   │
    │── POST /api/v1/envelopes ────────────────────────►│  cria o envelope
    │◄─ 201 { id, signatarios[{ id, urlAssinatura }] } ─│
    │                                                   │
    │   (as partes assinam no rsf-signer)               │
    │                                                   │
    │◄─ POST webhook  signatario.assinou ───────────────│
    │◄─ POST webhook  signatario.assinou ───────────────│
    │◄─ POST webhook  envelope.concluido ───────────────│
    │── GET /api/v1/envelopes/:id ─────────────────────►│  confere a situação completa
    │── GET /api/v1/envelopes/:id/documento-assinado ──►│  guarda o PDF assinado
    │                                                   │
    │  unidade avança para a próxima etapa              │
```

O SysEntrega continua sendo a fonte do **processo** (em que etapa a unidade está, o que falta); o rsf-signer é a fonte da **assinatura** (quem assinou, como, com que evidências).

## Como ligar

No `.env` do SysEntrega:

```
ASSINATURA_PROVEDOR=rsf-signer
RSF_SIGNER_URL=https://signer.exemplo.com.br
RSF_SIGNER_API_KEY=<chave emitida pelo rsf-signer para o SysEntrega>
RSF_SIGNER_WEBHOOK_SECRET=<segredo combinado para o HMAC dos webhooks>
APP_URL=https://sysentrega.exemplo.com.br
```

`APP_URL` precisa ser alcançável pelo rsf-signer: o webhook é chamado em `{APP_URL}/api/assinaturas/webhooks/rsf-signer`.

A troca vale para os termos emitidos **dali em diante**. Termos já emitidos com a assinatura interna continuam sendo assinados no SysEntrega — o provedor é gravado em cada envelope.

## Chamadas do SysEntrega ao rsf-signer

Todas com `Authorization: Bearer {RSF_SIGNER_API_KEY}`. Tempo limite de 20 s (`RSF_SIGNER_TIMEOUT_MS`).

### Criar envelope

`POST {RSF_SIGNER_URL}/api/v1/envelopes`

```json
{
  "referencia": "SE-2026-7K3MQ9",
  "titulo": "Termo de Vistoria e Recebimento de Unidade",
  "documento": {
    "nome": "SE-2026-7K3MQ9.pdf",
    "conteudoBase64": "JVBERi0xLjM…",
    "sha256": "0d8e…a13"
  },
  "signatarios": [
    {
      "referencia": "cmb1x…",
      "parte": "CONSTRUTORA",
      "nome": "Carlos Construtor",
      "email": "carlos@construtora.com.br",
      "cpf": "52998224725",
      "ordem": 1
    },
    {
      "referencia": "cmb1y…",
      "parte": "INCORPORADORA",
      "nome": "Inês Incorporadora",
      "email": "ines@rsf.com.br",
      "cpf": null,
      "ordem": 2
    }
  ],
  "webhookUrl": "https://sysentrega.exemplo.com.br/api/assinaturas/webhooks/rsf-signer",
  "metadados": {
    "sistema": "sysentrega",
    "empreendimento": "01",
    "unidade": "Torre A · 101",
    "etapa": "CONSTRUTORA_INCORPORADORA"
  }
}
```

- `referencia` (envelope) é o **protocolo** do termo — único no SysEntrega.
- `signatarios[].referencia` é o id do signatário no SysEntrega; o rsf-signer deve devolvê-lo em toda resposta e webhook.
- `parte` é `CONSTRUTORA`, `INCORPORADORA`, `RELACIONAMENTO` ou `CLIENTE`.
- `documento.sha256` é o hash do PDF enviado; o rsf-signer pode (e deveria) conferi-lo ao receber.
- `cpf` e `email` podem vir nulos quando o cadastro não os tem. Para o cliente, vêm do cadastro do cliente.

Resposta `201`:

```json
{
  "id": "env_01HZX…",
  "status": "PENDENTE",
  "signatarios": [
    { "referencia": "cmb1x…", "id": "sig_01…", "urlAssinatura": "https://signer.exemplo.com.br/a/…" },
    { "referencia": "cmb1y…", "id": "sig_02…", "urlAssinatura": "https://signer.exemplo.com.br/a/…" }
  ]
}
```

O SysEntrega guarda `id` e cada `urlAssinatura` (mostrada como botão *Assinar no rsf-signer* para o signatário pendente).

**Se a criação falhar** (rsf-signer fora do ar, erro 4xx/5xx): o termo fica emitido e aguardando, a falha vai para a auditoria e a tela do termo oferece *Reenviar ao rsf-signer*. Recomenda-se que o rsf-signer trate `referencia` repetida como idempotente (devolver o envelope já criado).

### Consultar envelope

`GET {RSF_SIGNER_URL}/api/v1/envelopes/{id}`

```json
{
  "id": "env_01HZX…",
  "status": "PENDENTE",
  "signatarios": [
    {
      "referencia": "cmb1x…",
      "status": "ASSINADO",
      "nome": "Carlos Construtor",
      "cpf": "52998224725",
      "assinadoEm": "2026-11-24T12:03:11.000Z",
      "ip": "203.0.113.9",
      "userAgent": "Mozilla/5.0 …",
      "motivoRecusa": null
    },
    { "referencia": "cmb1y…", "status": "PENDENTE" }
  ]
}
```

- `status` do envelope: `PENDENTE`, `CONCLUIDO`, `RECUSADO` ou `CANCELADO`.
- `status` do signatário: `PENDENTE`, `ASSINADO` ou `RECUSADO`.

Usada ao receber `envelope.concluido` e no botão *Atualizar situação no rsf-signer* (para quando um webhook se perde).

### Cancelar envelope

`POST {RSF_SIGNER_URL}/api/v1/envelopes/{id}/cancelar` com `{ "motivo": "…" }`

Chamada quando o termo é anulado no SysEntrega antes de concluído.

### Baixar o documento assinado

`GET {RSF_SIGNER_URL}/api/v1/envelopes/{id}/documento-assinado` → `application/pdf`

Chamada depois que o envelope é concluído. O SysEntrega guarda o PDF e o hash dele; é esse o arquivo oferecido como *termo assinado* e aceito na conferência pública.

## Webhooks do rsf-signer ao SysEntrega

`POST {APP_URL}/api/assinaturas/webhooks/rsf-signer`

### Autenticação

Cabeçalho `X-RSF-Signature: sha256=<hex>`, onde `<hex>` é o **HMAC-SHA256 do corpo bruto** da requisição com `RSF_SIGNER_WEBHOOK_SECRET`.

- Sem o cabeçalho, ou com HMAC que não confere: `403`, nada é alterado.
- Sem `RSF_SIGNER_WEBHOOK_SECRET` configurado no SysEntrega: `503`.

O HMAC é calculado sobre os bytes recebidos — o rsf-signer deve assinar exatamente o que envia, sem reformatar o JSON depois.

### Eventos

```json
{
  "evento": "signatario.assinou",
  "envelopeId": "env_01HZX…",
  "referencia": "SE-2026-7K3MQ9",
  "ocorridoEm": "2026-11-24T12:03:11.000Z",
  "signatario": {
    "referencia": "cmb1x…",
    "nome": "Carlos Construtor",
    "cpf": "52998224725",
    "assinadoEm": "2026-11-24T12:03:11.000Z",
    "ip": "203.0.113.9",
    "userAgent": "Mozilla/5.0 …"
  }
}
```

| `evento` | Efeito no SysEntrega |
|---|---|
| `signatario.assinou` | Marca o signatário como assinado (método `RSF_SIGNER`). Se era o último, conclui o envelope e a unidade avança de etapa. |
| `signatario.recusou` | (`signatario.motivo` com o motivo.) Encerra o termo como recusado; a unidade volta com uma pendência. |
| `envelope.concluido` | Consulta a situação completa no rsf-signer (cobre avisos de assinatura que se perderam) e baixa o PDF assinado. |
| `envelope.cancelado` | Anula o termo; a unidade volta para nova vistoria. |

Outros valores de `evento` são respondidos com `200` e ignorados.

### Respostas e reenvio

- `200` — processado (ou ignorado por já ter sido aplicado).
- `404` — `envelopeId` desconhecido.
- `400` — corpo inválido, ou o termo não está mais aguardando aquela assinatura.

Os webhooks são **idempotentes**: reenviar o mesmo aviso não duplica nada. O rsf-signer pode (e deveria) reenviar em caso de falha de rede ou `5xx`.

Todo webhook aplicado entra na trilha de auditoria da unidade com o ator `rsf-signer` (tipo *integração*) e o IP de origem.

## O que o rsf-signer não precisa saber

- Etapas, pendências, vistoria, permissões por perfil: é tudo do SysEntrega.
- O conteúdo do PDF: para o rsf-signer é um documento opaco com um hash.

## Pontos a decidir quando a API real for definida

1. **Identificação do signatário**: o contrato manda nome, e-mail e CPF. Se o rsf-signer exigir outro identificador (certificado, conta gov.br, usuário corporativo), acrescentar o campo ao envio.
2. **Ordem de assinatura**: `ordem` é enviada (1 = quem entrega, 2 = quem recebe), mas o SysEntrega não depende de a ordem ser respeitada.
3. **Prazo de validade** do envelope: hoje não há; se o rsf-signer expirar envelopes, mapear a expiração para `envelope.cancelado`.
4. **Formato da assinatura no PDF**: o SysEntrega guarda o arquivo como vier. Se for PAdES/ICP-Brasil, a conferência por hash em `/verificar` continua valendo para o arquivo final.
