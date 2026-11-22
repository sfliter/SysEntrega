import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Abas, { useAba } from '../components/Abas';
import Torre from '../components/Torre';
import { api } from '../api';
import { useAoVivo } from '../aoVivo';
import { useAuth } from '../auth';
import { Carregando, Erro, Pill, useCarregar, Vazio } from '../components/Basicos';
import { useFila } from '../components/Conexao';
import { dataHora, ESTACOES, STATUS } from '../fluxo';
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
  return <Conteudo dados={dados} construtora={construtora} nome={usuario?.nome.split(' ')[0] ?? ''} aoVivo={conexao.online && !erro} atualizadoEm={atualizadoEm} />;
}

function Conteudo({
  dados,
  construtora,
  nome,
  aoVivo,
  atualizadoEm,
}: {
  dados: Resumo;
  construtora: boolean;
  nome: string;
  aoVivo: boolean;
  atualizadoEm: Date;
}) {
  // Submenus da página: cada um cabe na tela, sem rolagem longa
  const abas = [
    { chave: 'geral', rotulo: 'Visão geral', selo: dados.fila.length, tom: 'atencao' },
    { chave: 'torres', rotulo: 'Torres', selo: dados.pendenciasAbertas, tom: 'perigo' },
    { chave: 'movimentacoes', rotulo: 'Movimentações' },
  ];
  const [aba, setAba] = useAba(abas);
  const emps = dados.empreendimentos.map((e) => ({ chave: e.id, rotulo: e.nome, selo: e.pendenciasAbertas, tom: 'perigo' }));
  // sem escolha, abre no empreendimento com mais unidades
  const maior = [...dados.empreendimentos].sort((a, b) => b.total - a.total)[0]?.id;
  const [empId, setEmpId] = useAba(emps, maior, 'emp');
  const emp = dados.empreendimentos.find((e) => e.id === empId);

  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">Dashboard</p>
          <h1>Olá, {nome}</h1>
        </div>
        <p className={`ao-vivo ${aoVivo ? '' : 'ao-vivo-parado'}`} role="status">
          <span className="faixa-ponto" />
          {aoVivo ? 'Ao vivo' : 'Sem conexão'} · atualizado às {hora.format(atualizadoEm)}
        </p>
      </header>
      <Abas abas={abas} atual={aba} aoMudar={setAba} rotulo="Seções do dashboard" />

      {aba === 'geral' && (
        <>
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
                    {ORDEM_STATUS.map((st) => {
                      const n = e.porStatus.find((p) => p.status === st)?.total ?? 0;
                      if (!n) return null;
                      return (
                        <li key={st}>
                          <Link to={`/unidades?etapa=${e.etapa}&status=${st}`}>
                            <span className={`ponto ponto-${STATUS[st].tom}`} />
                            {STATUS[st].rotulo}
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

          <div className="duas-colunas">
            <section className="cartao">
              <h2>Aguardando você</h2>
              {dados.fila.length === 0 ? (
                <Vazio>Nada parado com você agora.</Vazio>
              ) : (
                <ul className="lista lista-curta">
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
                <ul className="lista lista-curta">
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
      )}

      {aba === 'torres' && (
        <section aria-label="Torres">
          {dados.empreendimentos.length === 0 && <Vazio>Nenhum empreendimento com unidades cadastradas.</Vazio>}
          {emps.length > 1 && <Abas abas={emps} atual={empId} aoMudar={setEmpId} rotulo="Empreendimento" classe="abas-secundarias" />}
          {emp && <CartaoEmpreendimento emp={emp} construtora={construtora} />}
        </section>
      )}

      {aba === 'movimentacoes' && (
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
                      <span>{[m.empreendimento, m.unidade, m.quem].filter(Boolean).join(' · ')}</span>
                    </div>
                    <time className="suave nao-quebra">{dataHora(m.criadoEm)}</time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
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

// Um empreendimento: a barra de avanço por etapa e as torres desenhadas,
// cada unidade na cor da sua situação.
function CartaoEmpreendimento({ emp, construtora }: { emp: Empreendimento; construtora: boolean }) {
  const torres = useMemo(() => {
    const porBloco = new Map<string, UnidadeDoPainel[]>();
    for (const un of emp.unidades) porBloco.set(un.bloco, [...(porBloco.get(un.bloco) ?? []), un]);
    return [...porBloco.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [emp.unidades]);
  const rotuloFim = construtora ? 'Recebidas' : 'Entregues';

  return (
    <article className="cartao emp">
      <header className="emp-topo">
        <div>
          <h2>{emp.nome}</h2>
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

      <ul className="legenda" aria-label="Legenda das cores">
        <li><span className="ponto ponto-neutro" />Aguardando liberação</li>
        <li><span className="ponto ponto-atencao" />Aguardando ação</li>
        <li><span className="ponto ponto-andamento" />Vistoria agendada ou em curso</li>
        <li><span className="ponto ponto-perigo" />Com pendências</li>
        <li><span className="ponto ponto-ok" />{construtora ? 'Recebida' : 'Entregue'}</li>
      </ul>

      <div className="torres">
        {torres.map(([bloco, unidades]) => (
          <Torre key={bloco} nome={bloco} unidades={unidades} mostrarEtapa={!construtora} />
        ))}
      </div>
    </article>
  );
}
