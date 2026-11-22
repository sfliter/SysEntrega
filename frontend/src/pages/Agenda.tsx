import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { Carregando, Erro, Pill, useCarregar, Vazio } from '../components/Basicos';
import { dataHora, dataLonga, ETAPAS, hora, ordemDaEtapa, rotuloUnidade } from '../fluxo';
import type { Agendamento } from '../tipos';

const diaLocal = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function Agenda() {
  const [etapa, setEtapa] = useState('');
  const [periodo, setPeriodo] = useState('30');
  const { dados, erro, carregando } = useCarregar<Agendamento[]>(async () => {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio.getTime() + Number(periodo) * 86400_000);
    return (
      await api.get('/agendamentos', {
        params: { de: inicio.toISOString(), ate: fim.toISOString(), ...(etapa ? { etapa } : {}) },
      })
    ).data;
  }, [etapa, periodo]);

  const { propostos, dias } = useMemo(() => {
    const lista = dados ?? [];
    const confirmados = lista.filter((a) => a.dataHora && a.status !== 'PROPOSTO');
    const porDia = new Map<string, Agendamento[]>();
    for (const a of confirmados) {
      const dia = diaLocal(a.dataHora!);
      porDia.set(dia, [...(porDia.get(dia) ?? []), a]);
    }
    return {
      propostos: lista.filter((a) => a.status === 'PROPOSTO'),
      dias: [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)),
    };
  }, [dados]);

  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">Agenda</p>
          <h1>Vistorias agendadas</h1>
        </div>
      </header>

      <div className="filtros">
        <label className="campo">
          <span>Etapa</span>
          <select value={etapa} onChange={(e) => setEtapa(e.target.value)}>
            <option value="">Todas</option>
            {ETAPAS.filter((e) => e.ordem !== 2).map((e) => (
              <option key={e.chave} value={e.chave}>
                {e.ordem}. {e.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Período</span>
          <select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            <option value="7">Próximos 7 dias</option>
            <option value="30">Próximos 30 dias</option>
            <option value="90">Próximos 90 dias</option>
          </select>
        </label>
      </div>

      <Erro>{erro}</Erro>
      {carregando && !dados ? (
        <Carregando />
      ) : (
        <>
          {propostos.length > 0 && (
            <section className="cartao">
              <h2>Aguardando escolha do horário</h2>
              <ul className="lista">
                {propostos.map((a) => (
                  <li key={a.id}>
                    <Link to={`/unidades/${a.unidadeId}`} className="lista-linha">
                      <div>
                        <strong>
                          {a.unidade!.empreendimento.nome} · {rotuloUnidade(a.unidade!)}
                        </strong>
                        <span>
                          Etapa {ordemDaEtapa(a.etapa)} · {a.opcoes.map((o) => dataHora(o.inicio)).join('  ·  ')}
                        </span>
                      </div>
                      {a.podeConfirmar ? <Pill tom="atencao">Escolher horário</Pill> : <Pill tom="neutro">Com a outra parte</Pill>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {dias.length === 0 && propostos.length === 0 && <Vazio>Nenhuma vistoria agendada neste período.</Vazio>}

          {dias.map(([dia, lista]) => (
            <section key={dia} className="cartao">
              <h2 className="dia">{dataLonga(lista[0].dataHora!)}</h2>
              <ul className="lista">
                {lista.map((a) => (
                  <li key={a.id}>
                    <Link to={`/unidades/${a.unidadeId}`} className="lista-linha">
                      <span className="hora mono">{hora(a.dataHora!)}</span>
                      <div className="cresce">
                        <strong>
                          {a.unidade!.empreendimento.nome} · {rotuloUnidade(a.unidade!)}
                        </strong>
                        <span>
                          {[
                            a.etapa === 'RELACIONAMENTO_CLIENTE' ? 'Vistoria com o cliente' : 'Vistoria técnica',
                            a.unidade!.cliente?.nome,
                            a.local,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      {a.status === 'REALIZADO' ? <Pill tom="ok">Realizada</Pill> : <Pill tom="andamento">Confirmada</Pill>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </>
  );
}
