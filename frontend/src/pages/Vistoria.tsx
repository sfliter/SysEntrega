import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, baixarBlob, mensagemDeErro } from '../api';
import { Carregando, Erro, Modal, Pill, useAcao, useCarregar } from '../components/Basicos';
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

// Reduz a foto no próprio aparelho antes de enviar: as fotos de celular têm
// vários MB e a rede da obra costuma ser ruim.
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
  const { dados, erro, carregando, recarregar } = useCarregar<VistoriaCompleta>(
    async () => (await api.get(`/vistorias/${id}`)).data,
    [id],
  );
  const [itens, setItens] = useState<Item[]>([]);
  const [aviso, setAviso] = useState('');
  const [acompanhante, setAcompanhante] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const concluir = useAcao();

  useEffect(() => {
    if (dados) setItens(dados.itens);
  }, [dados]);

  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <Erro>{erro || 'Vistoria não encontrada'}</Erro>;

  const editavel = dados.podeConduzir;
  const avaliados = itens.filter((i) => i.resultado).length;
  const ambientes = [...new Set(itens.map((i) => i.ambiente))];

  // Cada toque é salvo na hora: se a conexão cair, a vistoria continua de onde parou
  async function salvarItem(item: Item, mudanca: { resultado?: ResultadoItem | null; observacao?: string }) {
    const anterior = itens;
    setItens((atual) =>
      atual.map((i) =>
        i.id === item.id
          ? { ...i, ...mudanca, observacao: mudanca.observacao !== undefined ? mudanca.observacao || null : i.observacao }
          : i,
      ),
    );
    try {
      await api.patch(`/vistorias/${id}/itens/${item.id}`, mudanca);
      setAviso('');
    } catch (e) {
      setItens(anterior);
      setAviso(`Não foi possível salvar "${item.descricao}": ${mensagemDeErro(e)}`);
    }
  }

  async function finalizar() {
    const ok = await concluir.executar(() =>
      api.post(`/vistorias/${id}/concluir`, {
        acompanhante: acompanhante.trim() || undefined,
        observacoes: observacoes.trim() || undefined,
      }),
    );
    if (ok) navegar(`/unidades/${dados!.unidade.id}`);
  }

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

      {dados.status === 'EM_ANDAMENTO' && (
        <div className="progresso" aria-label={`${avaliados} de ${itens.length} itens avaliados`}>
          <div className="progresso-barra">
            <span style={{ width: `${itens.length ? (avaliados / itens.length) * 100 : 0}%` }} />
          </div>
          <span className="mono">
            {avaliados}/{itens.length}
          </span>
        </div>
      )}
      {dados.status !== 'EM_ANDAMENTO' && (dados.observacoes || dados.acompanhante) && (
        <section className="cartao">
          {dados.acompanhante && <p>Acompanhada por <strong>{dados.acompanhante}</strong></p>}
          {dados.observacoes && <p>{dados.observacoes}</p>}
        </section>
      )}
      <Erro>{aviso}</Erro>

      {ambientes.map((ambiente) => (
        <section key={ambiente} className="cartao">
          <h2>{ambiente}</h2>
          {itens
            .filter((i) => i.ambiente === ambiente)
            .map((item) => (
              <ItemVistoria key={item.id} vistoriaId={dados.id} item={item} editavel={editavel} salvar={salvarItem} aoMudarFotos={recarregar} />
            ))}
        </section>
      ))}

      {editavel && (
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
            emitido para assinatura das partes.
          </p>
          <div className="passo-acoes">
            <button type="button" className="botao botao-primario" disabled={concluir.enviando || avaliados < itens.length} onClick={finalizar}>
              {concluir.enviando ? 'Concluindo…' : avaliados < itens.length ? `Faltam ${itens.length - avaliados} itens` : 'Concluir vistoria'}
            </button>
            <button type="button" className="link link-perigo" onClick={() => setCancelando(true)}>
              Cancelar vistoria
            </button>
          </div>
        </section>
      )}

      {cancelando && (
        <CancelarVistoria id={dados.id} aoFechar={() => setCancelando(false)} aoCancelar={() => navegar(`/unidades/${dados.unidade.id}`)} />
      )}
    </div>
  );
}

function ItemVistoria({
  vistoriaId,
  item,
  editavel,
  salvar,
  aoMudarFotos,
}: {
  vistoriaId: string;
  item: Item;
  editavel: boolean;
  salvar: (item: Item, m: { resultado?: ResultadoItem | null; observacao?: string }) => void;
  aoMudarFotos: () => void;
}) {
  const [obs, setObs] = useState(item.observacao ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const entrada = useRef<HTMLInputElement>(null);
  const exigeObs = item.resultado === 'NAO_CONFORME' || item.resultado === 'RESSALVA';

  async function enviarFotos(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    setEnviando(true);
    setErro('');
    try {
      const form = new FormData();
      for (const a of Array.from(arquivos).slice(0, 6)) {
        form.append('fotos', await reduzir(a), a.name.replace(/\.\w+$/, '') + '.jpg');
      }
      await api.post(`/vistorias/${vistoriaId}/itens/${item.id}/fotos`, form);
      aoMudarFotos();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
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
      {(exigeObs || obs || !editavel) && (editavel ? (
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
      <Erro>{erro}</Erro>
      {(item.fotos.length > 0 || editavel) && (
        <div className="fotos">
          {item.fotos.map((f) => (
            <Foto key={f.id} foto={f} editavel={editavel} aoRemover={aoMudarFotos} />
          ))}
          {editavel && (
            <label className={`foto foto-nova ${enviando ? 'ocupado' : ''}`}>
              <input ref={entrada} type="file" accept="image/*" multiple hidden disabled={enviando} onChange={(e) => enviarFotos(e.target.files)} />
              {enviando ? 'Enviando…' : '+ Foto'}
            </label>
          )}
        </div>
      )}
    </div>
  );
}

function Foto({ foto, editavel, aoRemover }: { foto: FotoInfo; editavel: boolean; aoRemover: () => void }) {
  const [url, setUrl] = useState('');
  const [ampliada, setAmpliada] = useState(false);
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
        {url && <img src={url} alt="" />}
      </button>
      {ampliada && (
        <Modal titulo="Foto" aoFechar={() => setAmpliada(false)} largo>
          {url && <img src={url} alt={foto.nomeOriginal} className="foto-grande" />}
          {editavel && (
            <footer className="modal-pe">
              <button
                type="button"
                className="botao botao-perigo"
                onClick={async () => {
                  await api.delete(`/fotos/${foto.id}`).catch(() => undefined);
                  setAmpliada(false);
                  aoRemover();
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
