import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, baixarBlob, mensagemDeErro, semConexao } from '../api';
import Abas from '../components/Abas';
import { Carregando, Erro, Modal, Pill, useAcao } from '../components/Basicos';
import { useFila } from '../components/Conexao';
import { fila, type Operacao } from '../fila';
import { dataHora, RESULTADO_VISTORIA } from '../fluxo';
import type { ResultadoItem } from '../tipos';

interface FotoInfo {
  id: string;
  nomeOriginal: string;
}
interface Item {
  id: string;
  ambiente: string;
  descricao: string;
  resultado: ResultadoItem | null;
  observacao: string | null;
  fotos: FotoInfo[];
}
interface VistoriaCompleta {
  id: string;
  nome: string;
  etapaRotulo: string;
  comCliente: boolean;
  status: 'EM_ANDAMENTO' | 'CONCLUIDA' | 'CANCELADA';
  resultado: keyof typeof RESULTADO_VISTORIA | null;
  vistoriadorNome: string;
  acompanhante: string | null;
  observacoes: string | null;
  iniciadaEm: string;
  concluidaEm: string | null;
  unidade: { id: string; rotulo: string; empreendimento: string };
  podeConduzir: boolean;
  itens: Item[];
}

const RESULTADOS: { valor: ResultadoItem; rotulo: string; tom: string }[] = [
  { valor: 'CONFORME', rotulo: 'Conforme', tom: 'ok' },
  { valor: 'RESSALVA', rotulo: 'Ressalva', tom: 'atencao' },
  { valor: 'NAO_CONFORME', rotulo: 'Não conforme', tom: 'perigo' },
  { valor: 'NAO_SE_APLICA', rotulo: 'N/A', tom: 'neutro' },
];

// Reduz a foto no próprio aparelho antes de guardar: as fotos de celular têm
// vários MB, e é a versão reduzida que fica na fila e vai para o servidor.
async function reduzir(arquivo: File, maximo = 1600): Promise<Blob> {
  try {
    const imagem = await createImageBitmap(arquivo);
    const escala = Math.min(1, maximo / Math.max(imagem.width, imagem.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(imagem.width * escala);
    canvas.height = Math.round(imagem.height * escala);
    canvas.getContext('2d')!.drawImage(imagem, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.82));
    return blob ?? arquivo;
  } catch {
    return arquivo;
  }
}

export default function Vistoria() {
  const { id } = useParams();
  const navegar = useNavigate();
  const f = useFila();
  const [dados, setDados] = useState<VistoriaCompleta | null>(null);
  const [erro, setErro] = useState('');
  // Quando a tela mostra a cópia guardada no aparelho (sem sinal na abertura)
  const [copiaDe, setCopiaDe] = useState<number | null>(null);
  const [acompanhante, setAcompanhante] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [cancelando, setCancelando] = useState(false);
  // Um ambiente por vez: no celular, cada um cabe na tela sem rolagem longa
  const [ambienteEscolhido, setAmbienteEscolhido] = useState('');
  const concluir = useAcao();
  const versao = useRef(0);

  const opsDaVistoria = useMemo(() => f.ops.filter((o) => o.vistoriaId === id), [f.ops, id]);
  const naFila = opsDaVistoria.filter((o) => !o.erro);
  const recusadas = opsDaVistoria.filter((o) => o.erro);

  async function carregar() {
    const minha = ++versao.current;
    try {
      const { data } = await api.get<VistoriaCompleta>(`/vistorias/${id}`, { timeout: 15000 });
      if (minha !== versao.current) return;
      // O que ainda está na fila é mais novo do que o servidor conhece
      const pendentes = fila.estado().ops.filter((o) => o.vistoriaId === id && o.tipo === 'item' && !o.erro);
      for (const op of pendentes) {
        const item = data.itens.find((i) => i.id === op.itemId);
        if (item && op.tipo === 'item') {
          if (op.mudanca.resultado !== undefined) item.resultado = op.mudanca.resultado;
          if (op.mudanca.observacao !== undefined) item.observacao = op.mudanca.observacao || null;
        }
      }
      setDados(data);
      setCopiaDe(null);
      setErro('');
      if (data.status === 'EM_ANDAMENTO') void fila.guardarVistoria(data.id, data);
      else void fila.esquecerVistoria(data.id);
    } catch (e) {
      if (minha !== versao.current) return;
      if (semConexao(e)) {
        const copia = await fila.lerVistoria<VistoriaCompleta>(id!);
        if (copia) {
          setDados((atual) => atual ?? copia.dados);
          setCopiaDe(copia.salvoEm);
          setErro('');
          return;
        }
      }
      setErro(mensagemDeErro(e));
    }
  }

  useEffect(() => {
    setDados(null);
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Fila da vistoria esvaziou (ou o sinal voltou): busca a versão do servidor
  const tinhaFila = useRef(false);
  useEffect(() => {
    if (naFila.length > 0) {
      tinhaFila.current = true;
    } else if (tinhaFila.current) {
      tinhaFila.current = false;
      void carregar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naFila.length]);
  useEffect(() => {
    if (f.online && copiaDe !== null) void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.online]);

  if (!dados && !erro) return <Carregando />;
  if (!dados) {
    return (
      <>
        <Erro>{erro}</Erro>
        {!f.online && (
          <p className="suave">
            Esta vistoria ainda não foi aberta neste aparelho, então não há cópia guardada para mostrar sem conexão.
          </p>
        )}
      </>
    );
  }

  const editavel = dados.podeConduzir && dados.status === 'EM_ANDAMENTO';
  const itens = dados.itens;
  const avaliados = itens.filter((i) => i.resultado).length;
  const ambientes = [...new Set(itens.map((i) => i.ambiente))];
  const CONCLUIR = '__concluir__';
  const abas = [
    ...ambientes.map((a) => {
      const doAmbiente = itens.filter((i) => i.ambiente === a);
      const feitos = doAmbiente.filter((i) => i.resultado).length;
      return { chave: a, rotulo: a, selo: `${feitos}/${doAmbiente.length}`, tom: feitos === doAmbiente.length ? 'ok' : undefined };
    }),
    ...(editavel ? [{ chave: CONCLUIR, rotulo: 'Concluir' }] : []),
  ];
  const ambienteAtual = abas.some((a) => a.chave === ambienteEscolhido) ? ambienteEscolhido : abas[0]?.chave ?? '';
  const proximo = abas[abas.findIndex((a) => a.chave === ambienteAtual) + 1];
  const irPara = (chave: string) => {
    setAmbienteEscolhido(chave);
    document.querySelector('.conteudo')?.scrollTo({ top: 0 });
  };
  const semJustificativa = itens.filter(
    (i) => (i.resultado === 'NAO_CONFORME' || i.resultado === 'RESSALVA') && !i.observacao,
  ).length;

  // Cada toque muda a tela e a cópia no aparelho na hora, e entra na fila de
  // envio. Não depende de haver sinal naquele momento.
  function salvarItem(item: Item, mudanca: { resultado?: ResultadoItem | null; observacao?: string }) {
    const novo: VistoriaCompleta = {
      ...dados!,
      itens: dados!.itens.map((i) =>
        i.id === item.id
          ? {
              ...i,
              ...(mudanca.resultado !== undefined ? { resultado: mudanca.resultado } : {}),
              ...(mudanca.observacao !== undefined ? { observacao: mudanca.observacao || null } : {}),
            }
          : i,
      ),
    };
    setDados(novo);
    void fila.guardarVistoria(novo.id, novo);
    void fila.enfileirarItem(novo.id, item.id, `${item.ambiente} · ${item.descricao}`, mudanca);
  }

  async function finalizar() {
    const ok = await concluir.executar(() =>
      api.post(`/vistorias/${id}/concluir`, {
        acompanhante: acompanhante.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
      }),
    );
    if (ok) {
      void fila.esquecerVistoria(id!);
      navegar(`/unidades/${dados!.unidade.id}`);
    }
  }

  const bloqueio = !editavel
    ? ''
    : avaliados < itens.length
      ? `Faltam ${itens.length - avaliados} itens`
      : semJustificativa > 0
        ? `Descreva o problema em ${semJustificativa} item(ns)`
        : recusadas.length > 0
          ? 'Resolva as alterações recusadas'
          : naFila.length > 0
            ? f.online
              ? 'Enviando alterações…'
              : 'Aguardando o sinal voltar'
            : !f.online
              ? 'Sem conexão para concluir'
              : '';

  return (
    <div className="vistoria">
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">
            <Link to={`/unidades/${dados.unidade.id}`}>
              {dados.unidade.empreendimento} · {dados.unidade.rotulo}
            </Link>
          </p>
          <h1>{dados.nome}</h1>
          <p className="suave">
            {dados.etapaRotulo} · {dados.vistoriadorNome} · iniciada em {dataHora(dados.iniciadaEm)}
          </p>
        </div>
        {dados.status === 'CONCLUIDA' && dados.resultado && (
          <Pill tom={RESULTADO_VISTORIA[dados.resultado].tom}>{RESULTADO_VISTORIA[dados.resultado].rotulo}</Pill>
        )}
        {dados.status === 'CANCELADA' && <Pill tom="neutro">Cancelada</Pill>}
      </header>

      {/* fica à vista enquanto a lista rola: o avanço, a situação do envio e os ambientes */}
      <div className="vistoria-fixo">
      {dados.status === 'EM_ANDAMENTO' && (
        <div className="progresso">
          <div className="progresso-linha" aria-label={`${avaliados} de ${itens.length} itens avaliados`}>
            <div className="progresso-barra">
              <span style={{ width: `${itens.length ? (avaliados / itens.length) * 100 : 0}%` }} />
            </div>
            <span className="mono">
              {avaliados}/{itens.length}
            </span>
          </div>
          {editavel && (
            <p className={`sinc ${recusadas.length ? 'sinc-perigo' : naFila.length ? 'sinc-fila' : 'sinc-ok'}`} role="status">
              <span className="faixa-ponto" />
              {recusadas.length > 0
                ? `${recusadas.length} alteração(ões) recusada(s) — veja abaixo`
                : naFila.length > 0
                  ? f.online
                    ? `Enviando ${naFila.length} alteração(ões)…`
                    : `Sem sinal: ${naFila.length} alteração(ões) salva(s) neste aparelho. Pode continuar.`
                  : f.online
                    ? 'Tudo salvo no servidor'
                    : 'Sem sinal: pode continuar, o que você marcar fica salvo neste aparelho.'}
            </p>
          )}
        </div>
      )}

      <Abas abas={abas} atual={ambienteAtual} aoMudar={irPara} rotulo="Ambientes da vistoria" classe="abas-ambiente" />
      </div>

      {copiaDe !== null && (
        <div className="aviso" role="status">
          Sem conexão: esta é a cópia guardada neste aparelho em {dataHora(new Date(copiaDe).toISOString())}
          {naFila.length > 0 ? ', com as suas alterações ainda não enviadas' : ''}.
        </div>
      )}

      {recusadas.length > 0 && (
        <section className="cartao cartao-perigo" aria-label="Alterações recusadas">
          <h2>Alterações que o servidor recusou</h2>
          <p className="suave">
            Estas alterações chegaram ao servidor, mas não foram aceitas. Elas não foram perdidas: confira o motivo e
            decida.
          </p>
          <ul className="lista">
            {recusadas.map((op) => (
              <li key={op.id} className="lista-linha lista-linha-topo">
                <div>
                  <strong>{op.tipo === 'foto' ? `Foto — ${op.rotulo}` : op.rotulo}</strong>
                  <span>{op.erro}</span>
                </div>
                <div className="signatario-acoes">
                  <button type="button" className="link" onClick={() => fila.tentarDeNovo(op.id)}>
                    Tentar de novo
                  </button>
                  <button type="button" className="link link-perigo" onClick={() => fila.descartar(op.id).then(carregar)}>
                    Descartar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dados.status !== 'EM_ANDAMENTO' && (dados.observacoes || dados.acompanhante) && (
        <section className="cartao">
          {dados.acompanhante && (
            <p>
              Acompanhada por <strong>{dados.acompanhante}</strong>
            </p>
          )}
          {dados.observacoes && <p>{dados.observacoes}</p>}
        </section>
      )}


      {ambientes.filter((a) => a === ambienteAtual).map((ambiente) => (
        <section key={ambiente} className="cartao">
          <h2>{ambiente}</h2>
          {itens
            .filter((i) => i.ambiente === ambiente)
            .map((item) => (
              <ItemVistoria
                key={item.id}
                vistoriaId={dados.id}
                item={item}
                editavel={editavel}
                online={f.online}
                fotosNaFila={naFila.filter((o) => o.tipo === 'foto' && o.itemId === item.id)}
                salvar={salvarItem}
                aoMudarFotos={carregar}
              />
            ))}
          {proximo && (
            <div className="passo-acoes">
              <button type="button" className="botao botao-primario" onClick={() => irPara(proximo.chave)}>
                {proximo.chave === CONCLUIR ? 'Ir para a conclusão' : `Próximo: ${proximo.rotulo}`}
              </button>
            </div>
          )}
        </section>
      ))}

      {editavel && ambienteAtual === CONCLUIR && (
        <section className="cartao cartao-destaque">
          <h2>Concluir</h2>
          <Erro>{concluir.erro}</Erro>
          {!dados.comCliente && (
            <label className="campo">
              <span>Quem acompanhou pela outra parte</span>
              <input value={acompanhante} onChange={(e) => setAcompanhante(e.target.value)} maxLength={160} />
            </label>
          )}
          <label className="campo">
            <span>Observações gerais (opcional)</span>
            <textarea rows={3} value={observacoes} onChange={(e) => setObservacoes(e.target.value)} />
          </label>
          <p className="suave">
            Qualquer item não conforme reprova a vistoria e vira pendência. Aprovada (com ou sem ressalvas), o termo é
            emitido para assinatura das partes. A conclusão precisa de conexão e só acontece depois que tudo o que
            está na fila deste aparelho chegar ao servidor.
          </p>
          <div className="passo-acoes">
            <button type="button" className="botao botao-primario" disabled={concluir.enviando || !!bloqueio} onClick={finalizar}>
              {concluir.enviando ? 'Concluindo…' : bloqueio || 'Concluir vistoria'}
            </button>
            <button type="button" className="link link-perigo" onClick={() => setCancelando(true)}>
              Cancelar vistoria
            </button>
          </div>
        </section>
      )}

      {cancelando && (
        <CancelarVistoria
          id={dados.id}
          aoFechar={() => setCancelando(false)}
          aoCancelar={() => {
            // A vistoria deixou de existir: o que estava na fila dela não tem mais para onde ir
            opsDaVistoria.forEach((o) => void fila.descartar(o.id));
            void fila.esquecerVistoria(dados.id);
            navegar(`/unidades/${dados.unidade.id}`);
          }}
        />
      )}
    </div>
  );
}

function ItemVistoria({
  vistoriaId,
  item,
  editavel,
  online,
  fotosNaFila,
  salvar,
  aoMudarFotos,
}: {
  vistoriaId: string;
  item: Item;
  editavel: boolean;
  online: boolean;
  fotosNaFila: Operacao[];
  salvar: (item: Item, m: { resultado?: ResultadoItem | null; observacao?: string }) => void;
  aoMudarFotos: () => void;
}) {
  const [obs, setObs] = useState(item.observacao ?? '');
  const [preparando, setPreparando] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const exigeObs = item.resultado === 'NAO_CONFORME' || item.resultado === 'RESSALVA';
  const rotulo = `${item.ambiente} · ${item.descricao}`;

  async function guardarFotos(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setPreparando(true);
    try {
      for (const a of Array.from(arquivos).slice(0, 6)) {
        const reduzida = await reduzir(a);
        await fila.enfileirarFoto(vistoriaId, item.id, rotulo, reduzida, a.name.replace(/\.\w+$/, '') + '.jpg');
      }
    } finally {
      setPreparando(false);
      if (entrada.current) entrada.current.value = '';
    }
  }

  return (
    <div className="item">
      <p className="item-descricao">{item.descricao}</p>
      <div className="item-botoes" role="group" aria-label={`Avaliação: ${item.descricao}`}>
        {RESULTADOS.map((r) => (
          <button
            key={r.valor}
            type="button"
            className={`resultado resultado-${r.tom} ${item.resultado === r.valor ? 'ativo' : ''}`}
            aria-pressed={item.resultado === r.valor}
            disabled={!editavel}
            onClick={() => salvar(item, { resultado: item.resultado === r.valor ? null : r.valor })}
          >
            {r.rotulo}
          </button>
        ))}
      </div>
      {(exigeObs || obs || !editavel) &&
        (editavel ? (
          <textarea
            className="item-obs"
            rows={2}
            placeholder={exigeObs ? 'Descreva o problema (obrigatório)' : 'Observação'}
            aria-label={`Observação: ${item.descricao}`}
            value={obs}
            onChange={(e) => setObs(e.target.value)}
            onBlur={() => obs.trim() !== (item.observacao ?? '') && salvar(item, { observacao: obs.trim() })}
          />
        ) : (
          item.observacao && <p className="item-obs-lida">{item.observacao}</p>
        ))}
      {(item.fotos.length > 0 || fotosNaFila.length > 0 || editavel) && (
        <div className="fotos">
          {item.fotos.map((foto) => (
            <Foto key={foto.id} foto={foto} editavel={editavel && online} aoRemover={aoMudarFotos} />
          ))}
          {fotosNaFila.map((op) => (
            <FotoNaFila key={op.id} op={op} />
          ))}
          {editavel && (
            <label className={`foto foto-nova ${preparando ? 'ocupado' : ''}`}>
              <input ref={entrada} type="file" accept="image/*" multiple hidden disabled={preparando} onChange={(e) => guardarFotos(e.target.files)} />
              {preparando ? 'Guardando…' : '+ Foto'}
            </label>
          )}
        </div>
      )}
    </div>
  );
}

// Foto que ainda não chegou ao servidor: mostrada a partir da cópia no aparelho
function FotoNaFila({ op }: { op: Operacao }) {
  const [url, setUrl] = useState('');
  const [ampliada, setAmpliada] = useState(false);
  useEffect(() => {
    if (op.tipo !== 'foto') return;
    const criada = URL.createObjectURL(new Blob([op.dados], { type: op.mime }));
    setUrl(criada);
    return () => URL.revokeObjectURL(criada);
  }, [op]);
  return (
    <>
      <button type="button" className="foto foto-fila" onClick={() => setAmpliada(true)} aria-label="Foto aguardando envio">
        {url && <img src={url} alt="" />}
        <span className="foto-selo">na fila</span>
      </button>
      {ampliada && (
        <Modal titulo="Foto aguardando envio" aoFechar={() => setAmpliada(false)} largo>
          {url && <img src={url} alt="" className="foto-grande" />}
          <footer className="modal-pe">
            <button type="button" className="botao botao-perigo" onClick={() => fila.descartar(op.id)}>
              Remover foto
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}

function Foto({ foto, editavel, aoRemover }: { foto: FotoInfo; editavel: boolean; aoRemover: () => void }) {
  const [url, setUrl] = useState('');
  const [ampliada, setAmpliada] = useState(false);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let criada = '';
    let ativo = true;
    baixarBlob(`/fotos/${foto.id}`)
      .then((b) => {
        if (!ativo) return;
        criada = URL.createObjectURL(b);
        setUrl(criada);
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
      if (criada) URL.revokeObjectURL(criada);
    };
  }, [foto.id]);

  return (
    <>
      <button type="button" className="foto" onClick={() => setAmpliada(true)} aria-label={`Ampliar foto ${foto.nomeOriginal}`}>
        {url ? <img src={url} alt="" /> : <span className="foto-selo foto-selo-neutro">salva</span>}
      </button>
      {ampliada && (
        <Modal titulo="Foto" aoFechar={() => setAmpliada(false)} largo>
          {url ? (
            <img src={url} alt={foto.nomeOriginal} className="foto-grande" />
          ) : (
            <p className="suave">A foto está salva no servidor; a imagem aparece quando houver conexão.</p>
          )}
          <Erro>{erro}</Erro>
          {editavel && (
            <footer className="modal-pe">
              <button
                type="button"
                className="botao botao-perigo"
                onClick={async () => {
                  try {
                    await api.delete(`/fotos/${foto.id}`);
                    setAmpliada(false);
                    aoRemover();
                  } catch (e) {
                    setErro(mensagemDeErro(e));
                  }
                }}
              >
                Remover foto
              </button>
            </footer>
          )}
        </Modal>
      )}
    </>
  );
}

function CancelarVistoria({ id, aoFechar, aoCancelar }: { id: string; aoFechar: () => void; aoCancelar: () => void }) {
  const [motivo, setMotivo] = useState('');
  const { enviando, erro, executar } = useAcao();
  return (
    <Modal titulo="Cancelar vistoria" aoFechar={aoFechar}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await executar(() => api.post(`/vistorias/${id}/cancelar`, { motivo }))) aoCancelar();
        }}
      >
        <p className="suave">A unidade volta a aguardar agendamento (ou conferência). O que foi avaliado fica guardado no histórico.</p>
        <Erro>{erro}</Erro>
        <label className="campo">
          <span>Motivo</span>
          <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={5} autoFocus />
        </label>
        <footer className="modal-pe">
          <button type="button" className="botao" onClick={aoFechar}>
            Voltar
          </button>
          <button className="botao botao-perigo" disabled={enviando}>
            Cancelar vistoria
          </button>
        </footer>
      </form>
    </Modal>
  );
}
