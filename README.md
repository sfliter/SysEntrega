# RSF · SysEntrega

Sistema de gestão de **recebimento e entrega de unidades**: acompanha cada unidade desde a liberação pela construtora até a entrega das chaves ao cliente, com agendamento, vistoria, aceite assinado pelas duas partes e trilha de auditoria de todos os passos.

| Dashboard | Unidade |
|---|---|
| ![Dashboard](docs/telas/painel.png) | ![Unidade](docs/telas/unidade-aguardando-cliente.png) |

| Dashboard da construtora (só até a unidade ser recebida) |
|---|
| ![Dashboard da construtora](docs/telas/dashboard-construtora.png) |

| Vistoria sem sinal | Assinatura do cliente | Auditoria |
|---|---|---|
| ![Vistoria sem sinal](docs/telas/vistoria-sem-sinal.png) | ![Assinatura do cliente](docs/telas/cliente-assinar.png) | ![Auditoria](docs/telas/auditoria.png) |

| Conta de teste (ver como) |
|---|
| ![Conta de teste](docs/telas/conta-de-teste.png) |

*(Telas com os dados de demonstração do seed.)*

## O fluxo

A unidade percorre três etapas. Em cada uma há quem entrega e quem recebe, e a etapa só termina com o termo **assinado pelas duas partes**.

```
 Construtora ──(1)──► Incorporadora ──(2)──► Central de Relacionamento ──(3)──► Cliente
```

| Etapa | Quem entrega → quem recebe | Agendamento | Verificação | Termo |
|---|---|---|---|---|
| 1 | Construtora → Incorporadora | Uma parte oferece horários, a outra escolhe | Vistoria técnica (incorporadora) | Termo de Vistoria e Recebimento |
| 2 | Incorporadora → Central de Relacionamento | Não há | Conferência de repasse (relacionamento) | Termo de Repasse |
| 3 | Central de Relacionamento → Cliente | Relacionamento oferece, cliente escolhe pelo link | Vistoria com o cliente | Termo de Vistoria, Aceite e Entrega de Chaves |

Dentro de cada etapa:

```
Aguardando liberação ─► Aguardando agendamento ─► Vistoria agendada ─► Em vistoria ─┬─► Aguardando assinaturas ─► próxima etapa / ENTREGUE
                                  ▲                                                 │
                                  └──── Com pendências ◄── reprovada ou termo recusado ┘
```

- **Vistoria reprovada** (qualquer item não conforme): cada item vira uma **pendência**. Quem entrega registra a resolução de cada uma e reapresenta a unidade para nova vistoria.
- **Vistoria aprovada** (com ou sem ressalvas): o sistema emite o **termo em PDF** e abre a coleta de assinaturas.
- **Assinatura recusada** por qualquer parte: o termo é encerrado e a unidade volta com uma pendência descrevendo o motivo.

As regras de cada etapa (quem libera, quem oferece horários, quem vistoria, quem resolve pendências) estão declaradas em [`backend/src/comum/fluxo.ts`](backend/src/comum/fluxo.ts) e as permissões em [`backend/src/comum/regras.ts`](backend/src/comum/regras.ts) — para ajustar o processo, são esses dois arquivos.

## O que o sistema entrega

### 1. Auditoria completa e histórico por unidade

- **Todo passo é registrado**: liberações, horários oferecidos/confirmados/cancelados, cada item avaliado na vistoria, fotos, pendências, emissão e download de termos, assinaturas, recusas, tentativas de login e de assinatura com senha/código errados, alterações de cadastro (com o antes e o depois).
- Cada evento guarda **quem** (usuário, cliente, sistema ou integração), perfil, organização, **quando**, IP, navegador, e o estado da unidade antes e depois.
- A trilha é **somente inserção**: um gatilho no PostgreSQL recusa `UPDATE`, `DELETE` e `TRUNCATE` na tabela, venha de onde vier.
- Cada evento carrega o **hash do anterior** (cadeia SHA-256). A tela de Auditoria tem o botão *Verificar integridade*, que refaz a cadeia e aponta o evento exato em caso de adulteração direta no banco.
- **Histórico da unidade**: linha do tempo na própria tela da unidade, visível a quem participa dela. A **trilha completa** (com IP e hash, filtros e exportação CSV) é restrita a Administrador e Auditor.

### 2. Vistoria e aceite das duas partes

- Pauta de itens **configurável por etapa** (Cadastros → Pauta de vistoria), agrupada por ambiente. A pauta é copiada para a vistoria no início: mudar a pauta não altera vistorias já feitas.
- Cada item recebe **Conforme**, **Ressalva**, **Não conforme** ou **N/A**, observação (obrigatória em ressalva e não conforme) e fotos — capturadas pelo celular e reduzidas no aparelho antes do envio. Tudo é salvo a cada toque.
- O termo em PDF traz a identificação da unidade e das partes, o resultado item a item com as fotos, as pendências sanadas de vistorias anteriores e a declaração de aceite. A versão assinada acrescenta a página de assinaturas com as evidências.

### 3. Agendamentos

- **Construtora ↔ Incorporadora**: qualquer das duas oferece horários; **quem oferece não escolhe** — a confirmação cabe à outra parte.
- **Relacionamento ↔ Cliente**: o Relacionamento oferece horários e o cliente escolhe por um **link público** (sem login), ou o Relacionamento registra a escolha feita por telefone (fica marcado como "em nome do cliente", com a observação obrigatória de como foi confirmado). O cliente também pode dizer que nenhum horário serve.
- Cancelamento e reagendamento exigem motivo. A tela **Agenda** mostra as vistorias confirmadas por dia e as propostas aguardando escolha.

### 4. Vistoria que não se perde quando o sinal cai

Na obra o sinal do celular oscila. Por isso a vistoria **não depende da rede no momento do toque**:

- Cada avaliação, observação e foto é gravada primeiro **no aparelho** e entra numa **fila de envio**. A tela mostra o tempo todo a situação: *Tudo salvo no servidor*, *Enviando N alterações* ou *Sem sinal: N alterações salvas neste aparelho. Pode continuar.*
- A fila é enviada sozinha quando o sinal volta e tentada de novo, com intervalos crescentes, até dar certo — inclusive depois de **recarregar a página ou fechar o navegador** sem sinal.
- Reenvio **não duplica**: avaliação vale o último toque, e o servidor reconhece a mesma foto pelo conteúdo (caso típico: o envio chegou, mas a resposta se perdeu).
- Se o servidor **recusar** algo (por exemplo, a vistoria foi cancelada em outro aparelho), a alteração não some: fica na tela, com o motivo, até o usuário decidir.
- A interface fica guardada no aparelho (service worker): recarregar sem sinal abre o sistema do mesmo jeito.
- **Concluir** a vistoria exige conexão e fila vazia — é o momento em que o termo é emitido.

Limites: *iniciar* a vistoria precisa de sinal (é quando a pauta é copiada), e a vistoria precisa ter sido aberta uma vez no aparelho para ficar disponível sem conexão. O código está em [`frontend/src/fila.ts`](frontend/src/fila.ts).

### 5. Assinatura — pronta para o rsf-signer

A coleta de assinaturas fica atrás de um adaptador ([`backend/src/assinaturas/provedor.ts`](backend/src/assinaturas/provedor.ts)). O restante do sistema só conhece "assinou" e "recusou", venha de onde vier. Há dois provedores, escolhidos por `ASSINATURA_PROVEDOR`:

**`interno` (padrão)** — o próprio SysEntrega colhe:

- **Usuários das empresas** (construtora, incorporadora, relacionamento) assinam logados, com a **senha conferida de novo no ato** e rubrica opcional. Cada parte assina só por si — nem o administrador assina por outra.
- **Cliente** assina por link público com **código de uso único** enviado ao e-mail dele, mais a rubrica desenhada na tela. O código nunca fica em claro no banco, vale 15 minutos e 5 tentativas.
- Ficam registrados data e hora, IP, navegador, localização (se o aparelho permitir) e o **hash SHA-256** do PDF assinado.
- Qualquer pessoa confere um termo em **`/verificar`**, pelo protocolo — e, enviando o arquivo, confirma que ele não foi alterado (o arquivo não sai do aparelho; só o hash é comparado).

**`rsf-signer`** — o termo emitido é enviado ao rsf-signer, que colhe as assinaturas e avisa o resultado por webhook assinado (HMAC). Contrato e passos para ligar: [`docs/integracao-rsf-signer.md`](docs/integracao-rsf-signer.md).

> **Importante:** o repositório do rsf-signer ainda não tem API publicada. O adaptador segue um **contrato proposto** e foi testado contra um serviço simulado que implementa esse contrato — não contra o rsf-signer real. Quando a API real existir, os ajustes ficam em um único arquivo: `backend/src/assinaturas/rsf-signer.provedor.ts`.

### 6. Dashboard de acompanhamento

A tela inicial de cada perfil é o **Dashboard**, que se atualiza sozinho: a cada 5 segundos a tela confere se houve novidade no servidor e, havendo, recarrega os dados — sem precisar atualizar a página (o indicador *Ao vivo* mostra a hora da última atualização).

- **Indicadores**: unidades em andamento, pendências em aberto, o que está aguardando o próprio usuário e as entregues.
- **Por etapa**: quantas unidades há em cada uma das três passagens, por situação.
- **Empreendimentos**: para cada um, a barra de avanço por etapa e o **espelho das unidades** — cada unidade um quadro na cor da sua situação (cinza aguardando liberação, âmbar aguardando ação, azul vistoria agendada ou em curso, vermelho com pendências, verde concluída), agrupadas por bloco e andar. Um clique abre a unidade.
- **Aguardando você**, **próximas vistorias** e **últimas movimentações**.

Quem acompanha o quê:

| Perfil | No Dashboard |
|---|---|
| Incorporadora, Central de Relacionamento, Auditor, Administrador | Todos os empreendimentos e a situação de cada unidade, em todas as etapas |
| Construtora | Só as obras dela, e só **até a unidade ser recebida** (vistoria aceita e termo assinado pelas duas partes). Depois disso a unidade aparece apenas como *Recebida pela incorporadora*: a construtora não vê a situação, as datas nem as movimentações das etapas seguintes — nem pelos filtros, nem pela planilha. O termo e o histórico da etapa de recebimento continuam disponíveis para ela |

A lista de unidades e a tela de cada unidade também se atualizam sozinhas.

### 7. Complementos

- **Anotações** no histórico da unidade (combinados, ocorrências), gravadas na trilha de auditoria.
- **Avisos por e-mail** a quem precisa agir a cada mudança de situação (`NOTIFICAR_POR_EMAIL=1`); a construtora só recebe os das obras dela, e os avisos não levam dados do cliente.
- **Planilha (CSV)** das unidades, com os filtros da tela, e coluna de há quanto tempo cada unidade está na situação atual.
- **Monitoramento**: `GET /api/saude` responde 200 só com o banco acessível (usado no healthcheck do container).
- **Segurança de acesso**: limite de tentativas no login e nos links públicos; perfil e situação do usuário conferidos no banco a cada requisição (desativar alguém vale na hora); troca de senha pelo próprio usuário.

## Identidade visual

O sistema segue a base visual da RSF: **navy `#09244D`** e **azul RSF `#134B9E`**, tipografia **Arial**, cartões com régua no alto, rótulos em caixa alta azul e tabelas de cabeçalho navy. A cor é julgamento, não enfeite: **verde** (`#2F7A4D`) bom, **âmbar** (`#B7851A`) atenção, **vermelho** (`#B62A33`) ruim. O logotipo da RSF aparece no menu, nas telas de entrada, nas páginas do cliente e no cabeçalho do termo em PDF.

Tudo isso está em um arquivo só de aparência — [`frontend/src/styles.css`](frontend/src/styles.css), que começa pela lista de cores — e no logotipo em [`frontend/src/components/LogoRsf.tsx`](frontend/src/components/LogoRsf.tsx) (PDF: `backend/src/documentos/logo-rsf.ts`). Para ajustar uma cor da marca, basta mudar o valor no alto do `styles.css`.

## Conta de teste

Um login só, que **vê e opera o sistema como qualquer perfil**. No menu aparece o seletor **Conta de teste · ver como**, com Administrador, Incorporadora, cada Construtora cadastrada, Central de Relacionamento e Auditor; ao trocar, o sistema passa a se comportar exatamente como para aquele perfil (mesmas telas, mesmo escopo, mesmas regras).

- Criar: `SEED_CONTA_TESTE=1` no `.env` cria `teste@sysentrega.local` (senha de `SEED_SENHA_PADRAO`). Ou marque **Conta de teste** em Cadastros → Usuários.
- Ligar: `CONTAS_DE_TESTE=1` no servidor. Sem isso, a conta é apenas um usuário de leitura e a troca de perfil não existe.
- Tudo o que a conta de teste faz fica registrado como tal na auditoria, no perfil escolhido — **inclusive assinaturas de termos**. Por isso o recomendado é usá-la em **homologação e treinamento** e deixar `CONTAS_DE_TESTE` vazio em operação.

## Demonstração em HTML

`npm run build:demo` (em `frontend/`) gera **um único arquivo HTML** com as telas do sistema e um servidor simulado dentro da própria página (`frontend/src/demo`), com dados fictícios. Serve para apresentar e aprovar telas e fluxo sem instalar nada: entra já na conta de teste (troca de perfil em "Ver como"), simula queda de sinal e traz um roteiro com os pontos a aprovar. Nada é gravado.

```bash
cd frontend && npm install && npm run build:demo
# abra dist-demo/abrir-no-navegador.html
```

## Perfis

| Perfil | Enxerga | Pode |
|---|---|---|
| **Construtora** | Só as unidades das obras da sua construtora, e só até serem recebidas pela incorporadora (sem dados do cliente nem das etapas seguintes) | Liberar, oferecer/confirmar horários, resolver pendências, assinar pela construtora |
| **Incorporadora** | Tudo | Cadastrar empreendimentos, unidades e clientes; vistoriar na etapa 1; repassar na etapa 2; assinar pela incorporadora |
| **Relacionamento** | Tudo | Conferir o repasse; cadastrar e vincular clientes; agendar e vistoriar com o cliente; assinar pela central |
| **Auditor** | Tudo, inclusive a trilha completa | Nada (somente leitura — o bloqueio é no servidor) |
| **Administrador** | Tudo | Tudo, exceto assinar por uma das partes |

O **cliente final não tem usuário**: age por links com token (um por agendamento, um por assinatura).

## Arquitetura

| Serviço | Tecnologia |
|---|---|
| `frontend` | React + Vite, servido por nginx (que também faz o proxy de `/api`) |
| `backend` | NestJS + Prisma (API REST, JWT) |
| `postgres` | PostgreSQL 16 |

```
SysEntrega/
├── backend/
│   ├── prisma/            # schema, migrações e seed
│   ├── src/
│   │   ├── comum/         # fluxo.ts (etapas) e regras.ts (permissões)
│   │   ├── unidades/      # estado da unidade, liberação, pendências
│   │   ├── agendamentos/
│   │   ├── vistorias/     # vistoria, fotos, armazenamento de arquivos
│   │   ├── documentos/    # termo em PDF
│   │   ├── assinaturas/   # provedor interno, adaptador rsf-signer, webhook
│   │   ├── auditoria/     # trilha encadeada por hash
│   │   └── publico/       # rotas do cliente, sem login
│   └── test/fluxo.e2e.mjs # teste ponta a ponta
├── frontend/
├── docs/integracao-rsf-signer.md
├── docker-compose.yml
└── .env.example
```

Fotos de vistoria e termos em PDF ficam em disco, num volume do Docker (`dados_arquivos`). **Inclua esse volume e o banco no backup.**

## Como rodar

### Com Docker (tudo numa máquina)

```bash
cp .env.example .env
# no .env: defina POSTGRES_PASSWORD (e a mesma senha em DATABASE_URL),
# JWT_SECRET (openssl rand -hex 32), APP_URL e SEED_SENHA_PADRAO
docker compose --profile app --profile dados up -d --build
```

Acesse `http://localhost`. O backend aplica as migrações e o seed sozinho.

**Primeiro acesso:** `admin@sysentrega.local` (ou `SEED_ADMIN_EMAIL`) com a senha de `SEED_SENHA_PADRAO`. Se a variável ficar vazia, o seed sorteia uma senha e a escreve **uma única vez** no log do backend (`docker compose logs backend`). Troque-a no primeiro acesso (menu → *Trocar senha*).

Com `SEED_DEMO=1` o seed cria também dados de exemplo: organizações, um empreendimento com unidades, um cliente e um usuário por perfil (`construtora@exemplo.com`, `incorporadora@exemplo.com`, `relacionamento@exemplo.com`, `auditor@exemplo.com`, todos com `SEED_SENHA_PADRAO`). Use só em homologação.

Em produção, coloque um proxy reverso com TLS na frente da porta 80 e ajuste `PROXIES_CONFIAVEIS` (1 = só o nginx do frontend; 2 = mais um proxy na frente).

### Desenvolvimento, sem Docker

```bash
# backend (precisa de um PostgreSQL)
cd backend
npm install
cat > .env <<'EOF'
DATABASE_URL=postgresql://USUARIO:SENHA@localhost:5432/sysentrega?schema=public
JWT_SECRET=um-segredo-de-desenvolvimento-com-32-caracteres-ou-mais
SEED_SENHA_PADRAO=Mudar@123
SEED_DEMO=1
CODIGO_NO_LOG=1
APP_URL=http://localhost:5173
EOF
npx prisma migrate deploy && npm run build && npm run prisma:seed
npm run start:dev

# frontend (proxy de /api para localhost:3000)
cd frontend && npm install && npm run dev
```

### Teste ponta a ponta

Com o banco migrado e o seed de demonstração aplicado (`SEED_DEMO=1`, `SEED_SENHA_PADRAO=Mudar@123`):

```bash
cd backend && npm run build && npm run test:e2e
```

O teste sobe a API duas vezes (assinatura interna e rsf-signer simulado) e percorre o fluxo inteiro de uma unidade: permissões de cada perfil, agendamento, vistoria reprovada e pendências, emissão e hash do termo, assinaturas, link do cliente, imutabilidade e verificação da trilha de auditoria, webhooks do rsf-signer.

## Configuração de e-mail (código do cliente)

Com a assinatura interna, o código de uso único vai para o e-mail do cliente por SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`).

- **Sem SMTP o sistema recusa o envio**, em vez de fingir que mandou.
- `CODIGO_NO_LOG=1` serve só para ensaiar o fluxo: o código é escrito no log do servidor. Assinatura colhida assim **não tem valor** — a página avisa o cliente, o termo sai marcado como ENSAIO e a auditoria registra. Nunca use em produção.

## API (resumo)

Todas sob `/api`.

- `POST /auth/login` · `GET /auth/me` · `POST /auth/trocar-senha`
- `GET /auth/perfis-de-teste` · `POST /auth/ver-como` — conta de teste
- `GET/POST /unidades` · `GET/PATCH /unidades/:id` · `GET /unidades/:id/historico`
- `POST /unidades/:id/liberar` — libera para a etapa, ou reapresenta após pendências
- `POST /unidades/:id/anotacoes` · `GET /unidades/exportar.csv`
- `POST /pendencias/:id/resolver`
- `GET /agendamentos` · `POST /unidades/:id/agendamentos` · `POST /agendamentos/:id/confirmar | cancelar | reagendar`
- `POST /unidades/:id/vistorias` · `GET /vistorias/:id` · `PATCH /vistorias/:id/itens/:itemId` · `POST /vistorias/:id/itens/:itemId/fotos` · `POST /vistorias/:id/concluir | cancelar`
- `GET /documentos/:id/pdf?versao=original|assinado`
- `POST /signatarios/:id/assinar | recusar` · `POST /envelopes/:id/cancelar | reenviar | sincronizar`
- `GET /auditoria` · `GET /auditoria/verificar` · `GET /auditoria/exportar.csv`
- `GET /dashboard` · `GET /dashboard/versao` (número do último registro, para a atualização ao vivo) · `GET /saude`
- Cadastros: `/organizacoes`, `/empreendimentos`, `/clientes`, `/usuarios`, `/pauta`
- Sem login (cliente): `/publico/agendamento/:token…`, `/publico/assinatura/:token…`, `/publico/verificar/:protocolo`
- Webhook: `POST /assinaturas/webhooks/rsf-signer`

### Teste da vistoria sem sinal (navegador)

Com o sistema no ar usando o build de produção (`npm run build && npx vite preview --host 127.0.0.1 --port 4173` no frontend) e o Playwright disponível:

```bash
cd frontend && node test/offline.e2e.mjs
```

Corta a rede no meio de uma vistoria, recarrega e reabre a página sem sinal, devolve o sinal com uma resposta perdida no caminho e confere, do lado do servidor, que nada se perdeu nem duplicou.

## Limites conhecidos e próximos passos

- **Textos jurídicos**: as declarações de aceite dos três termos (`backend/src/documentos/termo.ts`) são um ponto de partida e **precisam de revisão do jurídico** antes do uso em produção. O mesmo vale para a avaliação do valor probatório da assinatura interna.
- **rsf-signer**: integração escrita contra um contrato proposto (ver acima).
- **Notificações**: avisos por e-mail a cada mudança de situação (opcionais). Não há WhatsApp/SMS nem notificações dentro do sistema além do painel "Aguardando você".
- **Vistoria sem sinal**: a fila fica no navegador do aparelho. Limpar os dados do navegador antes do envio apaga o que ainda não foi enviado; trocar de aparelho no meio da vistoria não leva a fila junto.
- **Login**: e-mail e senha. Não há login pelo Microsoft 365 nem segundo fator.
- **Limite de tentativas** (login e links públicos) fica na memória do processo: vale para uma instância da API.
- **Arquivos em disco**: para S3/MinIO, reimplemente os três métodos de `backend/src/vistorias/armazenamento.service.ts`.
- **Docker**: os Dockerfiles e o `docker-compose.yml` não foram executados no ambiente em que o sistema foi desenvolvido (sem Docker disponível). O sistema foi testado rodando direto em Node + PostgreSQL; valide a subida em Docker na homologação.
