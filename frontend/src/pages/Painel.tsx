import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Carregando, Erro, Pill, useCarregar, Vazio } from '../components/Basicos';
import { dataHora, ESTACOES, STATUS } from '../fluxo';
import type { Etapa, StatusUnidade } from '../tipos';

interface Resumo {
  etapas: {
    etapa: Etapa;
    ordem: number;
    rotulo: string;
    visivel: boolean;
    total: number;
    porStatus: { status: StatusUnidade; total: number }[];
  }[];
  totalUnidades: number;
  entregues: number;
  fila: { unidadeId: string; unidade: string; empreendimento: string; acao: string; desde: string }[];
  proximosAgendamentos: {
    id: string;
    unidadeId: string;
    unidade: string;
    empreendimento: string;
    etapa: Etapa;
    dataHora: string;
    local: string | null;
  }[];
}

const ORDEM_STATUS: StatusUnidade[] = [
  'AGUARDANDO_LIBERACAO',
  'AGUARDANDO_AGENDAMENTO',
  'AGUARDANDO_CONFERENCIA',
  'VISTORIA_AGENDADA',
  'EM_VISTORIA',
  'COM_PENDENCIAS',
  'AGUARDANDO_ASSINATURA',
];

export default function Painel() {
  const { usuario } = useAuth();
  const { dados, erro, carregando } = useCarregar<Resumo>(async () => (await api.get('/dashboard')).data, []);
  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <Erro>{erro}</Erro>;

  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">Painel</p>
          <h1>Olá, {usuario?.nome.split(' ')[0]}</h1>
        </div>
        <p className="placar">
          <strong>{dados.totalUnidades - dados.entregues}</strong> em andamento
          <span aria-hidden="true"> · </span>
          <strong>{dados.entregues}</strong> entregues
        </p>
      </header>

      {/* A esteira: as quatro estações e, entre elas, quantas unidades há em cada etapa */}
      <section className="esteira" aria-label="Unidades por etapa">
        {dados.etapas.map((e, i) => (
          <div key={e.etapa} className="esteira-etapa">
            <div className="esteira-cabeca">
              <span className="esteira-estacao">{ESTACOES[i]}</span>
              <span className="esteira-seta" aria-hidden="true" />
              <span className="esteira-estacao">{ESTACOES[i + 1]}</span>
            </div>
            <Link to={`/unidades?etapa=${e.etapa}`} className="esteira-total">
              <strong>{e.total}</strong>
              <span>{e.total === 1 ? 'unidade' : 'unidades'}</span>
            </Link>
            {e.visivel ? (
              <ul className="esteira-status">
                {ORDEM_STATUS.map((s) => {
                  const n = e.porStatus.find((p) => p.status === s)?.total ?? 0;
                  if (!n) return null;
                  return (
                    <li key={s}>
                      <Link to={`/unidades?etapa=${e.etapa}&status=${s}`}>
                        <span className={`ponto ponto-${STATUS[s].tom}`} />
                        {STATUS[s].rotulo}
                        <b>{n}</b>
                      </Link>
                    </li>
                  );
                })}
                {e.total === 0 && <li className="suave">Nenhuma unidade nesta etapa</li>}
              </ul>
            ) : (
              <p className="suave">Etapa fora do seu perfil</p>
            )}
          </div>
        ))}
      </section>

      <div className="duas-colunas">
        <section className="cartao">
          <h2>Aguardando você</h2>
          {dados.fila.length === 0 ? (
            <Vazio>Nada parado com você agora.</Vazio>
          ) : (
            <ul className="lista">
              {dados.fila.map((f, i) => (
                <li key={`${f.unidadeId}-${i}`}>
                  <Link to={`/unidades/${f.unidadeId}`} className="lista-linha">
                    <div>
                      <strong>{f.acao}</strong>
                      <span>
                        {f.empreendimento} · {f.unidade}
                      </span>
                    </div>
                    <time className="suave">desde {dataHora(f.desde)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cartao">
          <h2>Próximas vistorias</h2>
          {dados.proximosAgendamentos.length === 0 ? (
            <Vazio>Nenhuma vistoria confirmada.</Vazio>
          ) : (
            <ul className="lista">
              {dados.proximosAgendamentos.map((a) => (
                <li key={a.id}>
                  <Link to={`/unidades/${a.unidadeId}`} className="lista-linha">
                    <div>
                      <strong>{dataHora(a.dataHora)}</strong>
                      <span>
                        {a.empreendimento} · {a.unidade}
                        {a.local ? ` · ${a.local}` : ''}
                      </span>
                    </div>
                    <Pill tom="andamento">{a.etapa === 'RELACIONAMENTO_CLIENTE' ? 'Com o cliente' : 'Técnica'}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/agenda" className="link">
            Ver a agenda completa
          </Link>
        </section>
      </div>
    </>
  );
}
