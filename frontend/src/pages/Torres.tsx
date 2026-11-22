import { useMemo, useState, type FormEvent } from 'react';
import { api } from '../api';
import { Carregando, Erro, useAcao, useCarregar, Vazio } from '../components/Basicos';
import Torre from '../components/Torre';
import { FAIXA_PADRAO, gerarUnidades, type Faixa } from '../torre';
import type { UnidadeResumo } from '../tipos';

interface Empreendimento {
  id: string;
  nome: string;
  codigo: string;
}

// Configuração das torres: mostra as torres de cada empreendimento e monta
// (ou completa) uma torre a partir de faixas de pavimentos.
export default function Torres({ podeEditar }: { podeEditar: boolean }) {
  const emps = useCarregar<Empreendimento[]>(async () => (await api.get('/empreendimentos')).data, []);
  const [escolhido, setEscolhido] = useState('');
  const empId = escolhido || emps.dados?.[0]?.id || '';
  const unidades = useCarregar<UnidadeResumo[]>(
    async () => (empId ? (await api.get('/unidades', { params: { empreendimentoId: empId } })).data : []),
    [empId],
  );
  const [montando, setMontando] = useState(false);
  const [feito, setFeito] = useState('');

  const torres = useMemo(() => {
    const porBloco = new Map<string, UnidadeResumo[]>();
    for (const un of unidades.dados ?? []) porBloco.set(un.bloco, [...(porBloco.get(un.bloco) ?? []), un]);
    return [...porBloco.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }));
  }, [unidades.dados]);

  if (emps.carregando && !emps.dados) return <Carregando />;
  if (!emps.dados?.length) {
    return (
      <>
        <Erro>{emps.erro}</Erro>
        <Vazio>Cadastre primeiro o empreendimento, na aba Empreendimentos.</Vazio>
      </>
    );
  }

  return (
    <>
      <div className="filtros">
        <label className="campo">
          <span>Empreendimento</span>
          <select
            value={empId}
            onChange={(e) => {
              setEscolhido(e.target.value);
              setMontando(false);
              setFeito('');
            }}
          >
            {emps.dados.map((e) => (
              <option key={e.id} value={e.id}>
                {e.codigo} · {e.nome}
              </option>
            ))}
          </select>
        </label>
        {podeEditar && !montando && (
          <button type="button" className="botao botao-primario" onClick={() => { setMontando(true); setFeito(''); }}>
            Montar ou completar torre
          </button>
        )}
      </div>
      {feito && (
        <div className="aviso aviso-ok" role="status">
          {feito}
        </div>
      )}

      {montando && (
        <Montagem
          empreendimentoId={empId}
          existentes={unidades.dados ?? []}
          aoFechar={() => setMontando(false)}
          aoCriar={(mensagem) => {
            setMontando(false);
            setFeito(mensagem);
            unidades.recarregar();
          }}
        />
      )}

      {!montando && (
        <>
          <Erro>{unidades.erro}</Erro>
          {unidades.carregando && !unidades.dados ? (
            <Carregando />
          ) : torres.length === 0 ? (
            <Vazio>
              Este empreendimento ainda não tem unidades.{podeEditar ? ' Use "Montar ou completar torre" para criá-las.' : ''}
            </Vazio>
          ) : (
            <div className="torres">
              {torres.map(([bloco, lista]) => (
                <Torre key={bloco} nome={bloco} unidades={lista} mostrarEtapa />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

const inteiro = (v: string) => (v === '' ? NaN : Number(v));

function Montagem({
  empreendimentoId,
  existentes,
  aoFechar,
  aoCriar,
}: {
  empreendimentoId: string;
  existentes: UnidadeResumo[];
  aoFechar: () => void;
  aoCriar: (mensagem: string) => void;
}) {
  const blocos = [...new Set(existentes.map((u) => u.bloco).filter(Boolean))];
  const [nome, setNome] = useState('');
  const [faixas, setFaixas] = useState<Faixa[]>([{ ...FAIXA_PADRAO }]);
  const { enviando, erro, executar } = useAcao();

  const { unidades, erros } = useMemo(() => gerarUnidades(faixas), [faixas]);
  const jaExistem = useMemo(
    () => new Set(existentes.filter((u) => u.bloco === nome.trim()).map((u) => u.numero)),
    [existentes, nome],
  );
  const novas = unidades.filter((u) => !jaExistem.has(u.numero));
  const pavimentos = new Set(unidades.map((u) => u.andar)).size;

  const mudar = (i: number, parte: Partial<Faixa>) => setFaixas(faixas.map((f, j) => (j === i ? { ...f, ...parte } : f)));
  const adicionar = () => {
    // a nova faixa continua de onde a anterior parou
    const ultima = faixas[faixas.length - 1];
    setFaixas([...faixas, { ...FAIXA_PADRAO, andarInicial: ultima.andarFinal + 1, andarFinal: ultima.andarFinal + 2, porAndar: Math.max(1, Math.floor(ultima.porAndar / 2)) }]);
  };

  async function criar(e: FormEvent) {
    e.preventDefault();
    let resposta = { criadas: 0, jaExistiam: 0 };
    const ok = await executar(async () => {
      resposta = (
        await api.post('/unidades/lote', {
          empreendimentoId,
          bloco: nome.trim(),
          unidades: unidades.map((u) => ({ numero: u.numero, andar: u.andar, tipologia: u.tipologia || undefined })),
          configuracao: { faixas },
          completar: true,
        }, { timeout: 150000 })
      ).data;
    });
    if (ok) {
      aoCriar(
        `Torre "${nome.trim()}": ${resposta.criadas} unidade(s) criada(s)` +
          (resposta.jaExistiam ? `; ${resposta.jaExistiam} já existiam e foram mantidas.` : '.'),
      );
    }
  }

  return (
    <form className="montagem" onSubmit={criar}>
      <section className="cartao cartao-destaque">
        <h2>Montar torre</h2>
        <p className="suave">
          Descreva a torre por faixas de pavimentos. Cada faixa tem a sua quantidade de unidades por andar e a sua
          numeração — por exemplo, do 1º ao 10º com 8 unidades e do 12º ao 14º com 4. Unidades que já existem na
          torre são mantidas como estão.
        </p>
        <Erro>{erro}</Erro>
        <label className="campo campo-estreito">
          <span>Nome da torre ou bloco</span>
          <input list="torres-existentes" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Torre A" maxLength={40} required />
          <datalist id="torres-existentes">
            {blocos.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </label>

        {faixas.map((f, i) => {
          const daFaixa = gerarUnidades([f]).unidades;
          return (
            <fieldset key={i} className="grupo faixa-torre">
              <legend>Faixa {i + 1}</legend>
              <div className="faixa-torre-campos">
                <label className="campo">
                  <span>Do andar</span>
                  <input type="number" min={0} value={Number.isNaN(f.andarInicial) ? '' : f.andarInicial} onChange={(e) => mudar(i, { andarInicial: inteiro(e.target.value) })} required />
                </label>
                <label className="campo">
                  <span>Até o andar</span>
                  <input type="number" min={0} value={Number.isNaN(f.andarFinal) ? '' : f.andarFinal} onChange={(e) => mudar(i, { andarFinal: inteiro(e.target.value) })} required />
                </label>
                <label className="campo">
                  <span>Unidades por andar</span>
                  <input type="number" min={1} max={40} value={Number.isNaN(f.porAndar) ? '' : f.porAndar} onChange={(e) => mudar(i, { porAndar: inteiro(e.target.value) })} required />
                </label>
                <label className="campo campo-largo">
                  <span>Numeração</span>
                  <select value={f.formato} onChange={(e) => mudar(i, { formato: e.target.value as Faixa['formato'] })}>
                    <option value="ANDAR_FINAL">Andar + final (101, 102…)</option>
                    <option value="SEQUENCIAL">Corrida, sem o andar (1, 2, 3…)</option>
                  </select>
                </label>
                <label className="campo">
                  <span>{f.formato === 'ANDAR_FINAL' ? 'Final começa em' : 'Começa em'}</span>
                  <input type="number" min={0} value={Number.isNaN(f.inicio) ? '' : f.inicio} onChange={(e) => mudar(i, { inicio: inteiro(e.target.value) })} required />
                </label>
                <label className="campo">
                  <span>Casas do final</span>
                  <input type="number" min={1} max={4} value={Number.isNaN(f.digitos) ? '' : f.digitos} onChange={(e) => mudar(i, { digitos: inteiro(e.target.value) })} required />
                </label>
                <label className="campo">
                  <span>Prefixo</span>
                  <input value={f.prefixo} onChange={(e) => mudar(i, { prefixo: e.target.value })} placeholder="ex.: COB " maxLength={8} />
                </label>
                <label className="campo">
                  <span>Sufixo</span>
                  <input value={f.sufixo} onChange={(e) => mudar(i, { sufixo: e.target.value })} placeholder="ex.: A" maxLength={6} />
                </label>
                <label className="campo campo-largo">
                  <span>Tipologia</span>
                  <input value={f.tipologia} onChange={(e) => mudar(i, { tipologia: e.target.value })} placeholder="ex.: 2 dormitórios" maxLength={80} />
                </label>
                <label className="campo campo-largo">
                  <span>Andares que não existem</span>
                  <input value={f.pular} onChange={(e) => mudar(i, { pular: e.target.value })} placeholder="ex.: 11, 13" />
                </label>
              </div>
              <div className="faixa-torre-pe">
                <span className="suave">
                  {daFaixa.length > 0
                    ? `${daFaixa.length} unidades: ${daFaixa[0].numero}${daFaixa.length > 1 ? ` … ${daFaixa[daFaixa.length - 1].numero}` : ''}`
                    : 'Confira os campos desta faixa'}
                </span>
                {faixas.length > 1 && (
                  <button type="button" className="link link-perigo" onClick={() => setFaixas(faixas.filter((_, j) => j !== i))}>
                    Remover faixa
                  </button>
                )}
              </div>
            </fieldset>
          );
        })}
        <button type="button" className="link" onClick={adicionar}>
          + Outra faixa de pavimentos
        </button>

        {erros.map((m) => (
          <Erro key={m}>{m}</Erro>
        ))}
        <div className="passo-acoes">
          <button className="botao botao-primario" disabled={enviando || erros.length > 0 || novas.length === 0 || !nome.trim()}>
            {enviando ? 'Criando…' : `Criar ${novas.length} ${novas.length === 1 ? 'unidade' : 'unidades'}`}
          </button>
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <span className="suave">
            {unidades.length} unidades em {pavimentos} pavimentos
            {jaExistem.size > 0 && unidades.length !== novas.length ? ` · ${unidades.length - novas.length} já existem e serão mantidas` : ''}
          </span>
        </div>
      </section>

      {unidades.length > 0 && erros.length === 0 && (
        <section className="cartao" aria-label="Prévia da torre">
          <h2>Prévia</h2>
          <div className="torres">
            <Torre nome={nome.trim() || 'Nova torre'} unidades={unidades.map((u) => ({ ...u, existente: jaExistem.has(u.numero) }))} />
          </div>
        </section>
      )}
    </form>
  );
}
