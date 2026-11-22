import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api, mensagemDeErro } from '../api';
import { useAuth } from '../auth';
import { Modal } from '../components/Basicos';
import { useFila } from '../components/Conexao';
import { fila } from '../fila';
import { dataHora, formatarCpfCnpj, METODO } from '../fluxo';
import LogoRsf from '../components/LogoRsf';
import { CONTA_DE_TESTE, fotoDaPrevia, recomecar } from './servidor';

// Faixa da demonstração: troca de perfil, simulação de falta de sinal,
// roteiro e a janela do termo (que na operação é um PDF).
export function Moldura({ children }: { children: ReactNode }) {
  const { usuario, entrar, verComo } = useAuth();
  const navegar = useNavigate();
  const local = useLocation();
  useFila(); // redesenha a faixa quando o sinal simulado muda
  const [roteiro, setRoteiro] = useState(false);
  const [termo, setTermo] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const paginaDoCliente = /^\/(agendar|assinar|verificar)/.test(local.pathname);
  const semSinal = fila.semSinalSimulado();

  useEffect(() => {
    const abrir = (e: Event) => setTermo((e as CustomEvent<string>).detail);
    window.addEventListener('demo:documento', abrir);
    return () => window.removeEventListener('demo:documento', abrir);
  }, []);

  async function reiniciar() {
    fila.simularSemSinal(false);
    for (const op of fila.estado().ops) await fila.descartar(op.id);
    const perfil = usuario?.perfil;
    const construtora = usuario?.organizacaoNome;
    recomecar();
    // volta ao mesmo perfil em que a pessoa estava
    await entrar(CONTA_DE_TESTE, 'demo');
    const { data } = await api.get('/auth/perfis-de-teste');
    const opcao = data.find((o: any) => o.perfil === perfil && (perfil !== 'CONSTRUTORA' || o.rotulo.includes(construtora ?? ''))) ?? data[0];
    await verComo(opcao.perfil, opcao.organizacaoId);
    navegar('/');
    setVersao((v) => v + 1);
  }

  return (
    <>
      <div className="demo-barra">
        <span className="demo-selo">Demonstração</span>
        {paginaDoCliente ? (
          <>
            <span className="demo-texto">Você está vendo a página que o cliente abre pelo link, sem login.</span>
            <button type="button" className="demo-botao" onClick={() => navegar(-1)}>
              Voltar ao sistema
            </button>
          </>
        ) : (
          <>
            <span className="demo-texto demo-dica">
              Troque de perfil em <strong>Conta de teste · ver como</strong>, no menu.
            </span>
            <button
              type="button"
              id="demo-sinal"
              className={`demo-botao ${semSinal ? 'demo-botao-ativo' : ''}`}
              aria-pressed={semSinal}
              onClick={() => fila.simularSemSinal(!semSinal)}
            >
              {semSinal ? 'Sem sinal — religar' : 'Simular queda de sinal'}
            </button>
          </>
        )}
        <span className="demo-espaco" />
        <button type="button" className="demo-botao" onClick={() => setRoteiro(true)}>
          Roteiro e pontos a aprovar
        </button>
        <button type="button" className="demo-botao" onClick={reiniciar}>
          Recomeçar
        </button>
      </div>
      {/* a chave refaz as telas quando os dados recomeçam */}
      <div key={`${versao}-${usuario?.sub}`} className="demo-corpo">
        {children}
      </div>
      {roteiro && <Roteiro aoFechar={() => setRoteiro(false)} />}
      {termo && <Termo caminho={termo} aoFechar={() => setTermo(null)} />}
    </>
  );
}

function Roteiro({ aoFechar }: { aoFechar: () => void }) {
  return (
    <Modal titulo="Como percorrer a demonstração" aoFechar={aoFechar} largo>
      <div className="roteiro">
        <p>
          Estas são as telas do sistema, com dados fictícios e um servidor simulado dentro da própria página. Nada do
          que você fizer aqui é gravado, e <strong>Recomeçar</strong> devolve tudo ao início. Onde o sistema pede
          senha, qualquer texto serve.
        </p>
        <p>
          Você está na <strong>conta de teste</strong>: um login só, que vê e opera o sistema como qualquer perfil. A
          troca fica em <em>Conta de teste · ver como</em>, no menu. O que você fizer aparece no histórico como
          &ldquo;Conta de Teste&rdquo;, no perfil escolhido; as pessoas que já aparecem nos dados (Carlos, Inês,
          Renata) são usuários comuns de cada empresa.
        </p>

        <h3>Um caminho de ponta a ponta</h3>
        <ol>
          <li>
            <strong>Ver como Construtora — Construtora Exemplo.</strong> Abra a unidade <em>Torre A · 202</em>,
            libere-a e ofereça horários de vistoria.
          </li>
          <li>
            <strong>Ver como Incorporadora.</strong> Na mesma unidade, escolha um horário, inicie a vistoria, avalie os
            itens (marque um como <em>Não conforme</em> para ver as pendências, ou todos conformes para emitir o
            termo) e assine.
          </li>
          <li>
            <strong>Construtora.</strong> Assine o termo. A unidade passa para a etapa 2.
          </li>
          <li>
            <strong>Incorporadora</strong> repassa; <strong>Central de Relacionamento</strong> confere e as
            duas assinam.
          </li>
          <li>
            <strong>Relacionamento.</strong> Vincule um cliente, ofereça horários e use <em>Abrir</em> no link do
            cliente para ver a página dele. Depois da vistoria, o cliente assina pelo link com o código.
          </li>
          <li>
            <strong>Auditor.</strong> Veja a trilha completa em Auditoria e confira a integridade.
          </li>
        </ol>
        <p className="suave">
          Atalhos: a <em>Torre A · 201</em> já está com vistoria agendada (entre como Incorporadora e inicie); a{' '}
          <em>101</em> está agendada com a cliente; a <em>102</em> tem pendência; a <em>203</em> aguarda a assinatura
          da construtora.
        </p>

        <h3>Dashboard ao vivo</h3>
        <p>
          O Dashboard mostra cada empreendimento com o espelho das unidades, na cor da situação de cada uma, e se
          atualiza sozinho quando alguém age em qualquer unidade. Incorporadora, Central de Relacionamento, Auditor e
          Administrador acompanham tudo. A <strong>Construtora</strong> acompanha as suas obras só até a unidade ser
          recebida e a vistoria aceita: depois disso ela vê apenas &ldquo;Recebida pela incorporadora&rdquo;. Compare
          trocando o perfil em <em>ver como</em>.
        </p>

        <h3>Vistoria sem sinal</h3>
        <p>
          Durante uma vistoria, clique em <strong>Simular queda de sinal</strong> e continue avaliando e anexando
          fotos: tudo fica na fila do aparelho. Religue o sinal e a fila é enviada sozinha. Na operação a fila fica
          gravada no celular e sobrevive a fechar o navegador; aqui ela vive só enquanto a página estiver aberta.
        </p>

        <h3>O que é diferente da operação</h3>
        <ul>
          <li>O termo abre numa janela desta página; na operação é um PDF com protocolo e hash.</li>
          <li>O código de assinatura do cliente aparece na tela; na operação ele chega ao e-mail do cliente.</li>
          <li>Planilhas (CSV) e a instalação no celular não existem na demonstração.</li>
          <li>Os hashes e a verificação de integridade são ilustrativos.</li>
        </ul>

        <h3>Pontos que dependem da sua aprovação</h3>
        <ul>
          <li>
            <strong>Etapa 2 sem agendamento:</strong> o repasse à Central é uma conferência de itens (documentos,
            chaves, estado da unidade), sem data marcada. Se quiser vistoria agendada também aqui, é uma mudança de
            configuração.
          </li>
          <li>
            <strong>Quem confirma horários:</strong> entre construtora e incorporadora, quem oferece não escolhe. Com
            o cliente, ele escolhe pelo link ou o Relacionamento registra a escolha feita por telefone.
          </li>
          <li>
            <strong>Itens da vistoria:</strong> a pauta de cada etapa é um ponto de partida e é editável em Cadastros.
          </li>
          <li>
            <strong>Textos dos termos:</strong> as declarações de aceite precisam de revisão do jurídico.
          </li>
          <li>
            <strong>Assinatura:</strong> hoje colhida pelo próprio sistema (senha no ato, ou código por e-mail para o
            cliente). A ligação com o rsf-signer está preparada e depende da API dele.
          </li>
          <li>
            <strong>Avisos por e-mail</strong> a cada mudança de situação: prontos, ligados por configuração.
          </li>
          <li>
            <strong>Conta de teste na operação:</strong> ela opera como qualquer perfil, inclusive assinando. Por isso
            só funciona com o recurso ligado no servidor, e o recomendado é usá-la em homologação.
          </li>
        </ul>
      </div>
    </Modal>
  );
}

interface Previa {
  conteudo: any;
  sha256: string;
  situacao: string;
  assinaturas: { parte: string; nome: string; status: string; assinadoEm: string | null; metodo: string | null; assinaturaImagem: string | null }[];
}

const COR: Record<string, string> = { CONFORME: 'ok', RESSALVA: 'atencao', NAO_CONFORME: 'perigo', NAO_SE_APLICA: 'neutro' };

// O termo, como sai no PDF da operação
function Termo({ caminho, aoFechar }: { caminho: string; aoFechar: () => void }) {
  const [dados, setDados] = useState<Previa | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    api.get(caminho).then((r) => setDados(r.data)).catch((e) => setErro(mensagemDeErro(e)));
  }, [caminho]);
  const c = dados?.conteudo;
  const ambientes: string[] = c ? [...new Set<string>(c.itens.map((i: any) => i.ambiente))] : [];

  return (
    <Modal titulo="Termo" aoFechar={aoFechar} largo>
      {erro && <div className="aviso aviso-perigo">{erro}</div>}
      {c && dados && (
        <article className="papel">
          <header className="papel-topo">
            <LogoRsf className="papel-marca" />
            <h3>{c.titulo}</h3>
            <span>
              Protocolo {c.protocolo} · Emitido em {dataHora(c.emitidoEm)}
            </span>
          </header>
          <div className="papel-corpo">
            <Secao titulo="Unidade">
              <Par r="Empreendimento" v={`${c.empreendimento.nome} (${c.empreendimento.codigo})`} />
              <Par r="Unidade" v={c.unidade.bloco ? `${c.unidade.bloco} · ${c.unidade.numero}` : c.unidade.numero} />
              <Par r="Endereço" v={c.empreendimento.endereco} />
              <Par r="Etapa" v={c.etapa} />
            </Secao>
            <Secao titulo="Quem entrega">
              <Par r={c.cedente.parte} v={c.cedente.nome} />
              <Par r="Documento" v={formatarCpfCnpj(c.cedente.documento)} />
              <Par r="Representante" v={c.cedente.representante} />
            </Secao>
            <Secao titulo="Quem recebe">
              <Par r={c.recebedor.parte} v={c.recebedor.nome} />
              <Par r="Documento" v={formatarCpfCnpj(c.recebedor.documento)} />
              <Par r="Representante" v={c.recebedor.representante} />
            </Secao>
            <Secao titulo={c.vistoria.nome}>
              <Par r="Resultado" v={c.vistoria.resultado} />
              <Par r="Itens conformes" v={`${c.vistoria.conformes} de ${c.vistoria.aplicaveis} aplicáveis`} />
              <Par r="Realizada por" v={c.vistoria.vistoriador} />
              <Par r="Acompanhada por" v={c.vistoria.acompanhante} />
              <Par r="Início" v={dataHora(c.vistoria.iniciadaEm)} />
              <Par r="Conclusão" v={dataHora(c.vistoria.concluidaEm)} />
            </Secao>
            <h4 className="papel-secao">Itens verificados</h4>
            {ambientes.map((a) => (
              <div key={a} className="papel-ambiente">
                <strong>{a}</strong>
                {c.itens
                  .filter((i: any) => i.ambiente === a)
                  .map((i: any, n: number) => (
                    <div key={n} className="papel-item">
                      <div>
                        {i.descricao}
                        {i.observacao && <em>{i.observacao}</em>}
                        {i.fotos.length > 0 && (
                          <div className="fotos">
                            {i.fotos.map((id: string) => (
                              <FotoDoTermo key={id} id={id} />
                            ))}
                          </div>
                        )}
                      </div>
                      <span className={`pill pill-${COR[i.chave]}`}>{i.resultado}</span>
                    </div>
                  ))}
              </div>
            ))}
            {c.pendenciasSanadas.length > 0 && (
              <>
                <h4 className="papel-secao">Pendências de vistorias anteriores, sanadas</h4>
                {c.pendenciasSanadas.map((p: any, n: number) => (
                  <p key={n}>
                    <strong>{p.descricao}</strong>
                    <br />
                    <span className="suave">
                      Resolução: {p.resolucao} — {p.resolvidaPor}, {dataHora(p.resolvidaEm)}
                    </span>
                  </p>
                ))}
              </>
            )}
            <h4 className="papel-secao">Declaração de aceite</h4>
            <p className="papel-declaracao">{c.declaracao}</p>

            <h4 className="papel-secao">Assinaturas eletrônicas</h4>
            <div className="papel-assinaturas">
              {dados.assinaturas.map((a, n) => (
                <div key={n}>
                  <span className="etiqueta">{a.parte}</span>
                  <strong>{a.nome}</strong>
                  {a.status === 'ASSINADO' ? (
                    <span className="suave">
                      Assinou em {dataHora(a.assinadoEm)} · {METODO[a.metodo ?? ''] ?? a.metodo}
                    </span>
                  ) : (
                    <span className="suave">{a.status === 'RECUSADO' ? 'Recusou' : 'Assinatura pendente'}</span>
                  )}
                  {a.assinaturaImagem && <img src={a.assinaturaImagem} alt={`Rubrica de ${a.nome}`} />}
                </div>
              ))}
            </div>
            <p className="hash">
              SHA-256 do termo <span className="mono">{dados.sha256}</span>
            </p>
          </div>
        </article>
      )}
    </Modal>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <>
      <h4 className="papel-secao">{titulo}</h4>
      <dl className="papel-pares">{children}</dl>
    </>
  );
}

function Par({ r, v }: { r: string; v?: string | null }) {
  if (!v) return null;
  return (
    <div>
      <dt>{r}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function FotoDoTermo({ id }: { id: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const blob = fotoDaPrevia(id);
    if (!blob) return;
    const criada = URL.createObjectURL(blob);
    setUrl(criada);
    return () => URL.revokeObjectURL(criada);
  }, [id]);
  return <span className="foto">{url && <img src={url} alt="" />}</span>;
}
