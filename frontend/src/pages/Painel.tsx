import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { useAuth } from '../auth';
import { Carregando, Erro, Pill, useCarregar, Vazio } from '../components/Basicos';
import { useFila } from '../components/Conexao';
import { dataHora, ESTACOES, ordemDaEtapa, STATUS } from '../fluxo';
import type { Etapa, StatusUnidade } from '../tipos';

interface UnidadeDoPainel {
  id: string;
  bloco: string;
  numero: string;
  andar: string | null;
  etapa: Etapa;
  status: StatusUnidade;
  pendenciasAbertas: number;
}

interface Empreendimento {
  id: string;
  codigo: string;
  nome: string;
  construtora: string;
  total: number;
  porEtapa: { etapa: Etapa; ordem: number; total: number }[];
  concluidas: number;
  pendenciasAbertas: number;
  unidades: UnidadeDoPainel[];
}

interface Resumo {
  etapas: { etapa: Etapa; ordem: number; rotulo: string; total: number; porStatus: { status: StatusUnidade; total: number }[] }[];
  totalUnidades: number;
  emAndamento: number;
  entregues: number;
  recebidas: number | null;
  pendenciasAbertas: number;
  empreendimentos: Empreendimento[];
  fila: { unidadeId: string; unidade: string; empreendimento: string; acao: string; desde: string }[];
  proximosAgendamentos: { id: string; unidadeId: string; unidade: string; empreendimento: string; etapa: Etapa; dataHora: string; local: string | null }[];
  movimentacoes: { seq: number; criadoEm: string; unidadeId: string | null; unidade: string | null; empreendimento: string | null; descricao: string; quem: string }[];
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

const hora = new Intl.DateTimeFormat('pt-BR', { timeStyle: 'medium' });

export default function Painel() {
  const { usuario } = useAuth();
  const conexao = useFila();
  const { dados, erro, carregando, recarregar } = useCarregar<Resumo>(async () => (await api.get('/dashboard')).data, []);
  const atualizadoEm = useAoVivo(recarregar);
  if (carregando && !dados) return <Carregando />;
  if (!dados) return <Erro>{erro}</Erro>;

  const construtora = usuario?.perfil === 'CONSTRUTORA';
  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">Dashboard</p>
          <h1>Olá, {usuario?.nome.split(' ')[0]}</h1>
          <p className="suave">
            {construtora
              ? 'As unidades das suas obras, até serem recebidas pela incorporadora.'
              : 'A situação de cada empreendimento e de cada unidade, da obra à entrega das chaves.'}
          </p>
        </div>
        <p className={`ao-vivo ${conexao.online && !erro ? '' : 'ao-vivo-parado'}`} role="status">
          <span className="faixa-ponto" />
          {conexao.online && !erro ? 'Ao vivo' : 'Sem conexão'} · atualizado às {hora.format(atualizadoEm)}
        </p>
      </header>

      {/* ---------- indicadores ---------- */}
      <section className="indicadores" aria-label="Indicadores">
        <Indicador rotulo="Em andamento" valor={dados.emAndamento} nota={`de ${dados.totalUnidades} unidades`} para="/unidades" />
        <Indicador
          rotulo="Com pendências"
          valor={dados.pendenciasAbertas}
          tom={dados.pendenciasAbertas ? 'perigo' : undefined}
          nota={dados.pendenciasAbertas === 1 ? 'pendência em aberto' : 'pendências em aberto'}
          para="/unidades?status=COM_PENDENCIAS"
        />
        <Indicador rotulo="Aguardando você" valor={dados.fila.length} tom={dados.fila.length ? 'atencao' : undefined} nota="ações na sua fila" />
        {construtora ? (
          <Indicador rotulo="Recebidas" valor={dados.recebidas ?? 0} tom="ok" nota="pela incorporadora" para="/unidades?status=RECEBIDA_INCORPORADORA" />
        ) : (
          <Indicador rotulo="Entregues" valor={dados.entregues} tom="ok" nota="chaves com o cliente" para="/unidades?status=ENTREGUE" />
        )}
      </section>

      {/* ---------- por etapa ---------- */}
      {!construtora && (
        <section className="esteira" aria-label="Unidades por etapa">
          {dados.etapas.map((e) => (
            <div key={e.etapa} className="esteira-etapa">
              <div className="esteira-cabeca">
                <span className="esteira-estacao">{ESTACOES[e.ordem - 1]}</span>
                <span className="esteira-seta" aria-hidden="true" />
                <span className="esteira-estacao">{ESTACOES[e.ordem]}</span>
              </div>
              <Link to={`/unidades?etapa=${e.etapa}`} className="esteira-total">
                <strong>{e.total}</strong>
                <span>{e.total === 1 ? 'unidade' : 'unidades'}</span>
              </Link>
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
            </div>
          ))}
        </section>
      )}

      {/* ---------- empreendimentos: o espelho das unidades ---------- */}
      <section aria-label="Empreendimentos">
        <div className="secao-topo">
          <h2>Empreendimentos</h2>
          <ul className="legenda" aria-label="Legenda das cores">
            <li><span className="ponto ponto-neutro" />Aguardando liberação</li>
            <li><span className="ponto ponto-atencao" />Aguardando ação</li>
            <li><span className="ponto ponto-andamento" />Vistoria agendada ou em curso</li>
            <li><span className="ponto ponto-perigo" />Com pendências</li>
            <li><span className="ponto ponto-ok" />{construtora ? 'Recebida' : 'Entregue'}</li>
          </ul>
        </div>
        {dados.empreendimentos.length === 0 && <Vazio>Nenhum empreendimento com unidades cadastradas.</Vazio>}
        {dados.empreendimentos.map((emp) => (
          <CartaoEmpreendimento key={emp.id} emp={emp} construtora={construtora} />
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

      <section className="cartao">
        <h2>Últimas movimentações</h2>
        {dados.movimentacoes.length === 0 ? (
          <Vazio>Nenhuma movimentação registrada.</Vazio>
        ) : (
          <ul className="lista">
            {dados.movimentacoes.map((m) => (
              <li key={m.seq}>
                <Link to={m.unidadeId ? `/unidades/${m.unidadeId}` : '/unidades'} className="lista-linha lista-linha-topo">
                  <div>
                    <strong>{m.descricao}</strong>
                    <span>
                      {[m.empreendimento, m.unidade, m.quem].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  <time className="suave nao-quebra">{dataHora(m.criadoEm)}</time>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Indicador({ rotulo, valor, nota, tom, para }: { rotulo: string; valor: number; nota: string; tom?: string; para?: string }) {
  const corpo = (
    <>
      <span className="etiqueta">{rotulo}</span>
      <strong className={tom ? `valor-${tom}` : ''}>{valor}</strong>
      <span className="suave">{nota}</span>
    </>
  );
  return para ? (
    <Link to={para} className="indicador">
      {corpo}
    </Link>
  ) : (
    <div className="indicador">{corpo}</div>
  );
}

// Um empreendimento: a barra de avanço por etapa e o "espelho" — cada
// unidade um quadrinho na cor da sua situação, agrupado por bloco e andar.
function CartaoEmpreendimento({ emp, construtora }: { emp: Empreendimento; construtora: boolean }) {
  const blocos = useMemo(() => {
    const porBloco = new Map<string, Map<string, UnidadeDoPainel[]>>();
    for (const un of emp.unidades) {
      const andares = porBloco.get(un.bloco) ?? new Map<string, UnidadeDoPainel[]>();
      const chave = un.andar ?? '';
      andares.set(chave, [...(andares.get(chave) ?? []), un]);
      porBloco.set(un.bloco, andares);
    }
    const numero = (a: string) => (a === '' ? -Infinity : Number.parseFloat(a) || 0);
    return [...porBloco.entries()].map(([bloco, andares]) => ({
      bloco,
      // do andar mais alto para o mais baixo, como no prédio
      andares: [...andares.entries()]
        .sort(([a], [b]) => numero(b) - numero(a))
        .map(([andar, unidades]) => ({ andar, unidades: unidades.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })) })),
    }));
  }, [emp.unidades]);
  const rotuloFim = construtora ? 'Recebidas' : 'Entregues';

  return (
    <article className="cartao emp">
      <header className="emp-topo">
        <div>
          <h3>{emp.nome}</h3>
          <p className="suave">
            Código {emp.codigo} · {emp.construtora} · {emp.total} {emp.total === 1 ? 'unidade' : 'unidades'}
          </p>
        </div>
        <div className="emp-acoes">
          {emp.pendenciasAbertas > 0 && (
            <Pill tom="perigo">
              {emp.pendenciasAbertas} {emp.pendenciasAbertas === 1 ? 'pendência' : 'pendências'}
            </Pill>
          )}
          <Link to={`/unidades?empreendimentoId=${emp.id}`} className="link">
            Ver lista
          </Link>
        </div>
      </header>

      <div className="avanco" role="img" aria-label={`${emp.porEtapa.map((e) => `etapa ${e.ordem}: ${e.total}`).join(', ')}; ${rotuloFim.toLowerCase()}: ${emp.concluidas}`}>
        {emp.porEtapa.map((e) => e.total > 0 && <span key={e.etapa} className={`avanco-etapa avanco-${e.ordem}`} style={{ flexGrow: e.total }} />)}
        {emp.concluidas > 0 && <span className="avanco-etapa avanco-fim" style={{ flexGrow: emp.concluidas }} />}
      </div>
      <ul className="avanco-legenda">
        {emp.porEtapa.map((e) => (
          <li key={e.etapa}>
            <span className={`quadro avanco-${e.ordem}`} />
            {construtora ? 'Em recebimento' : `Etapa ${e.ordem} · ${ESTACOES[e.ordem - 1]} → ${ESTACOES[e.ordem]}`}
            <b>{e.total}</b>
          </li>
        ))}
        <li>
          <span className="quadro avanco-fim" />
          {rotuloFim}
          <b>{emp.concluidas}</b>
        </li>
      </ul>

      {blocos.map(({ bloco, andares }) => (
        <div key={bloco} className="espelho">
          {bloco && <p className="etiqueta">{bloco}</p>}
          {andares.map(({ andar, unidades }) => (
            <div key={andar} className="espelho-andar">
              <span className="espelho-rotulo">{andar ? `${andar}º` : ''}</span>
              <div className="espelho-unidades">
                {unidades.map((un) => {
                  const situacao = STATUS[un.status];
                  const etapa = ordemDaEtapa(un.etapa);
                  const descricao = `${bloco ? `${bloco} · ` : ''}${un.numero} — ${
                    un.status === 'ENTREGUE' || un.status === 'RECEBIDA_INCORPORADORA' ? '' : `etapa ${etapa}, `
                  }${situacao.rotulo.toLowerCase()}`;
                  return (
                    <Link key={un.id} to={`/unidades/${un.id}`} className={`unidade-celula celula-${situacao.tom}`} title={descricao} aria-label={descricao}>
                      <strong>
                        {un.numero}
                        {/* em que etapa a unidade está (a construtora só tem a primeira) */}
                        {!construtora && un.status !== 'ENTREGUE' && <i>E{etapa}</i>}
                      </strong>
                      <span>{situacao.curto}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </article>
  );
}
