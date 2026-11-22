import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, baixarBlob, DEMO, mensagemDeErro } from '../api';
import { Carregando, Erro, useCarregar, Vazio } from '../components/Basicos';
import { dataHora, PERFIL } from '../fluxo';
import type { Perfil } from '../tipos';

interface Evento {
  seq: number;
  criadoEm: string;
  acao: string;
  descricao: string;
  unidadeId: string | null;
  atorTipo: string;
  atorNome: string;
  atorPerfil: string | null;
  organizacao: string | null;
  ip: string | null;
  statusAnterior: string | null;
  statusNovo: string | null;
  hash: string;
}

interface Verificacao {
  integra: boolean;
  conferidos: number;
  primeiroEventoInvalido: number | null;
  ultimoHash: string;
}

export default function Auditoria() {
  const [filtro, setFiltro] = useState({ busca: '', acao: '', de: '', ate: '' });
  const [aplicado, setAplicado] = useState(filtro);
  const [pagina, setPagina] = useState(1);
  const [verificacao, setVerificacao] = useState<Verificacao | null>(null);
  const [verificando, setVerificando] = useState(false);
  const [aviso, setAviso] = useState('');

  const params = () => ({
    ...(aplicado.busca ? { busca: aplicado.busca } : {}),
    ...(aplicado.acao ? { acao: aplicado.acao } : {}),
    ...(aplicado.de ? { de: new Date(`${aplicado.de}T00:00:00`).toISOString() } : {}),
    ...(aplicado.ate ? { ate: new Date(`${aplicado.ate}T23:59:59.999`).toISOString() } : {}),
  });

  const acoes = useCarregar<string[]>(async () => (await api.get('/auditoria/acoes')).data, []);
  const { dados, erro, carregando } = useCarregar<{ total: number; porPagina: number; eventos: Evento[] }>(
    async () => (await api.get('/auditoria', { params: { ...params(), pagina } })).data,
    [aplicado, pagina],
  );

  async function verificar() {
    setVerificando(true);
    setAviso('');
    try {
      setVerificacao((await api.get('/auditoria/verificar')).data);
    } catch (e) {
      setAviso(mensagemDeErro(e));
    } finally {
      setVerificando(false);
    }
  }

  async function exportar() {
    setAviso('');
    try {
      const blob = await baixarBlob(`/auditoria/exportar.csv?${new URLSearchParams(params())}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setAviso(mensagemDeErro(e));
    }
  }

  const paginas = dados ? Math.max(1, Math.ceil(dados.total / dados.porPagina)) : 1;

  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">Auditoria</p>
          <h1>Trilha de auditoria</h1>
          <p className="suave">
            Todo passo fica registrado e não pode ser alterado nem apagado. Cada evento carrega o hash do anterior.
          </p>
        </div>
        <div className="passo-acoes">
          <button type="button" className="botao" onClick={verificar} disabled={verificando}>
            {verificando ? 'Conferindo…' : 'Verificar integridade'}
          </button>
          {!DEMO && (
            <button type="button" className="botao" onClick={exportar}>
              Exportar CSV
            </button>
          )}
        </div>
      </header>

      <Erro>{aviso}</Erro>
      {verificacao && (
        <div className={`aviso ${verificacao.integra ? 'aviso-ok' : 'aviso-perigo'}`} role="status">
          {verificacao.integra ? (
            <>
              <strong>Trilha íntegra.</strong> {verificacao.conferidos} eventos conferidos, do primeiro ao último.
            </>
          ) : (
            <>
              <strong>Cadeia quebrada no evento #{verificacao.primeiroEventoInvalido}.</strong> Os{' '}
              {verificacao.conferidos} eventos anteriores estão íntegros; a partir dele houve alteração fora do sistema.
            </>
          )}
          <br />
          <span className="mono">último hash íntegro: {verificacao.ultimoHash}</span>
        </div>
      )}

      <form
        className="filtros"
        onSubmit={(e) => {
          e.preventDefault();
          setPagina(1);
          setAplicado(filtro);
        }}
      >
        <label className="campo campo-cresce">
          <span>Buscar na descrição ou no nome</span>
          <input type="search" value={filtro.busca} onChange={(e) => setFiltro({ ...filtro, busca: e.target.value })} />
        </label>
        <label className="campo">
          <span>Ação</span>
          <select value={filtro.acao} onChange={(e) => setFiltro({ ...filtro, acao: e.target.value })}>
            <option value="">Todas</option>
            {acoes.dados?.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>De</span>
          <input type="date" value={filtro.de} onChange={(e) => setFiltro({ ...filtro, de: e.target.value })} />
        </label>
        <label className="campo">
          <span>Até</span>
          <input type="date" value={filtro.ate} onChange={(e) => setFiltro({ ...filtro, ate: e.target.value })} />
        </label>
        <button className="botao">Filtrar</button>
      </form>

      <Erro>{erro}</Erro>
      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.eventos.length ? (
        <Vazio>Nenhum evento com estes filtros.</Vazio>
      ) : (
        <>
          <div className="tabela-caixa">
            <table className="tabela tabela-auditoria">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>O que aconteceu</th>
                  <th>Origem</th>
                </tr>
              </thead>
              <tbody>
                {dados.eventos.map((e) => (
                  <tr key={e.seq}>
                    <td className="mono">{e.seq}</td>
                    <td className="nao-quebra">{dataHora(e.criadoEm)}</td>
                    <td>
                      <strong>{e.atorNome}</strong>
                      <br />
                      <span className="suave">
                        {[
                          e.atorPerfil ? (PERFIL[e.atorPerfil as Perfil] ?? (e.atorPerfil === 'CLIENTE' ? 'Cliente' : e.atorPerfil)) : null,
                          e.organizacao,
                          e.atorTipo === 'INTEGRACAO' ? 'integração' : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td>
                      <span className="etiqueta">{e.acao}</span>
                      <br />
                      {e.descricao}
                      {e.statusNovo && e.statusNovo !== e.statusAnterior && (
                        <>
                          <br />
                          <span className="suave">
                            {e.statusAnterior ? `${e.statusAnterior} → ` : ''}
                            {e.statusNovo}
                          </span>
                        </>
                      )}
                      {e.unidadeId && (
                        <>
                          {' '}
                          <Link to={`/unidades/${e.unidadeId}`} className="link">
                            ver unidade
                          </Link>
                        </>
                      )}
                    </td>
                    <td>
                      <span className="mono">{e.ip ?? '—'}</span>
                      <br />
                      <span className="mono suave" title={e.hash}>
                        {e.hash.slice(0, 12)}…
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="paginacao" aria-label="Paginação">
            <button type="button" className="botao" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>
              Anterior
            </button>
            <span className="suave">
              Página {pagina} de {paginas} · {dados.total} eventos
            </span>
            <button type="button" className="botao" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>
              Próxima
            </button>
          </nav>
        </>
      )}
    </>
  );
}
