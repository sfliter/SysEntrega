import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, baixarBlob, DEMO, mensagemDeErro } from '../api';
import { useAuth } from '../auth';
import { Carregando, Erro, Modal, PillStatus, useAcao, useCarregar, Vazio } from '../components/Basicos';
import Trilho from '../components/Trilho';
import { ETAPAS, haQuanto, STATUS } from '../fluxo';
import type { StatusUnidade, UnidadeResumo } from '../tipos';

interface Empreendimento {
  id: string;
  nome: string;
  codigo: string;
}

export default function Unidades() {
  const { usuario } = useAuth();
  const [params, setParams] = useSearchParams();
  const filtro = {
    empreendimentoId: params.get('empreendimentoId') ?? '',
    etapa: params.get('etapa') ?? '',
    status: params.get('status') ?? '',
    busca: params.get('busca') ?? '',
  };
  const [busca, setBusca] = useState(filtro.busca);
  const [nova, setNova] = useState(false);

  const emps = useCarregar<Empreendimento[]>(async () => (await api.get('/empreendimentos')).data, []);
  const lista = useCarregar<UnidadeResumo[]>(
    async () =>
      (await api.get('/unidades', { params: Object.fromEntries(Object.entries(filtro).filter(([, v]) => v)) })).data,
    [params.toString()],
  );

  function mudar(chave: string, valor: string) {
    const novo = new URLSearchParams(params);
    if (valor) novo.set(chave, valor);
    else novo.delete(chave);
    setParams(novo, { replace: true });
  }

  const [erroExportar, setErroExportar] = useState('');
  async function exportar() {
    setErroExportar('');
    try {
      const blob = await baixarBlob(`/unidades/exportar.csv?${params}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `unidades-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErroExportar(mensagemDeErro(e));
    }
  }

  const podeCadastrar = usuario?.perfil === 'ADMINISTRADOR' || usuario?.perfil === 'INCORPORADORA';

  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">Unidades</p>
          <h1>Acompanhamento das unidades</h1>
        </div>
        <div className="passo-acoes">
          {!DEMO && (
            <button type="button" className="botao" onClick={exportar}>
              Baixar planilha
            </button>
          )}
          {podeCadastrar && (
            <button type="button" className="botao botao-primario" onClick={() => setNova(true)}>
              Cadastrar unidades
            </button>
          )}
        </div>
      </header>

      <form
        className="filtros"
        onSubmit={(e) => {
          e.preventDefault();
          mudar('busca', busca.trim());
        }}
      >
        <label className="campo">
          <span>Empreendimento</span>
          <select value={filtro.empreendimentoId} onChange={(e) => mudar('empreendimentoId', e.target.value)}>
            <option value="">Todos</option>
            {emps.dados?.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} · {e.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Etapa</span>
          <select value={filtro.etapa} onChange={(e) => mudar('etapa', e.target.value)}>
            <option value="">Todas</option>
            {ETAPAS.map((e) => (
              <option key={e.chave} value={e.chave}>
                {e.ordem}. {e.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Situação</span>
          <select value={filtro.status} onChange={(e) => mudar('status', e.target.value)}>
            <option value="">Todas</option>
            {(Object.keys(STATUS) as StatusUnidade[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="campo campo-cresce">
          <span>Buscar</span>
          <input
            type="search"
            placeholder="Número, bloco ou cliente"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </label>
        <button className="botao">Buscar</button>
      </form>

      <Erro>{lista.erro || erroExportar}</Erro>
      {lista.carregando && !lista.dados ? (
        <Carregando />
      ) : !lista.dados?.length ? (
        <Vazio>Nenhuma unidade encontrada com estes filtros.</Vazio>
      ) : (
        <div className="tabela-caixa">
          <table className="tabela">
            <thead>
              <tr>
                <th>Unidade</th>
                <th>Empreendimento</th>
                <th>Caminho</th>
                <th>Situação</th>
                <th>Cliente</th>
                <th>Nesta situação</th>
              </tr>
            </thead>
            <tbody>
              {lista.dados.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link to={`/unidades/${u.id}`} className="tabela-principal">
                      {u.bloco ? `${u.bloco} · ` : ''}
                      {u.numero}
                    </Link>
                  </td>
                  <td>{u.empreendimento.nome}</td>
                  <td>
                    <Trilho etapa={u.etapa} status={u.status} compacto />
                  </td>
                  <td>
                    <PillStatus status={u.status} />
                    {u.pendenciasAbertas > 0 && (
                      <span className="suave"> {u.pendenciasAbertas} pendência(s)</span>
                    )}
                  </td>
                  <td>{u.cliente?.nome ?? <span className="suave">—</span>}</td>
                  <td className="nao-quebra suave">{u.status === 'ENTREGUE' ? '—' : haQuanto(u.atualizadoEm)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nova && (
        <NovaUnidade
          empreendimentos={emps.dados ?? []}
          aoFechar={() => setNova(false)}
          aoSalvar={() => {
            setNova(false);
            lista.recarregar();
          }}
        />
      )}
    </>
  );
}

function NovaUnidade({
  empreendimentos,
  aoFechar,
  aoSalvar,
}: {
  empreendimentos: Empreendimento[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [f, setF] = useState({ empreendimentoId: empreendimentos[0]?.id ?? '', bloco: '', numeros: '', andar: '', tipologia: '' });
  const { enviando, erro, executar } = useAcao();
  const numeros = f.numeros.split(/[\s,;]+/).filter(Boolean);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(() =>
      api.post('/unidades', {
        empreendimentoId: f.empreendimentoId,
        bloco: f.bloco || undefined,
        numeros,
        andar: f.andar || undefined,
        tipologia: f.tipologia || undefined,
      }),
    );
    if (ok) aoSalvar();
  }

  return (
    <Modal titulo="Cadastrar unidades" aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <Erro>{erro}</Erro>
        <label className="campo">
          <span>Empreendimento</span>
          <select value={f.empreendimentoId} onChange={(e) => setF({ ...f, empreendimentoId: e.target.value })} required>
            {empreendimentos.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} · {e.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Bloco / torre (opcional)</span>
          <input value={f.bloco} onChange={(e) => setF({ ...f, bloco: e.target.value })} maxLength={40} />
        </label>
        <label className="campo">
          <span>Números das unidades</span>
          <textarea
            rows={2}
            value={f.numeros}
            onChange={(e) => setF({ ...f, numeros: e.target.value })}
            placeholder="101, 102, 103"
            required
          />
          <small className="suave">
            Separe por vírgula ou espaço para cadastrar várias de uma vez
            {numeros.length > 1 ? ` — ${numeros.length} unidades` : ''}.
          </small>
        </label>
        <div className="par">
          <label className="campo">
            <span>Andar (opcional)</span>
            <input value={f.andar} onChange={(e) => setF({ ...f, andar: e.target.value })} maxLength={20} />
          </label>
          <label className="campo">
            <span>Tipologia (opcional)</span>
            <input value={f.tipologia} onChange={(e) => setF({ ...f, tipologia: e.target.value })} maxLength={80} />
          </label>
        </div>
        <footer className="modal-pe">
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={enviando || numeros.length === 0}>
            {enviando ? 'Salvando…' : 'Cadastrar'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
