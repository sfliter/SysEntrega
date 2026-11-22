import { ESTACOES, ordemDaEtapa, STATUS } from '../fluxo';
import type { Etapa, StatusUnidade } from '../tipos';

// O caminho da unidade: quatro estações e três trechos. A unidade está no
// trecho da etapa em curso; os anteriores já foram percorridos.
export default function Trilho({
  etapa,
  status,
  compacto = false,
}: {
  etapa: Etapa;
  status: StatusUnidade;
  compacto?: boolean;
}) {
  const entregue = status === 'ENTREGUE';
  const atual = ordemDaEtapa(etapa); // 1..3
  const descricao = entregue
    ? 'Entregue ao cliente'
    : `Etapa ${atual} de 3: ${ESTACOES[atual - 1]} para ${ESTACOES[atual]} — ${STATUS[status].rotulo}`;
  return (
    <div className={`trilho ${compacto ? 'trilho-compacto' : ''}`} role="img" aria-label={descricao}>
      {ESTACOES.map((nome, i) => {
        const alcancada = entregue || i < atual;
        const trechoFeito = entregue || i + 1 < atual;
        const trechoAtual = !entregue && i + 1 === atual;
        return (
          <div key={nome} className="trilho-parte">
            <div className={`estacao ${alcancada ? 'estacao-feita' : ''}`}>
              <span className="estacao-ponto" />
              {!compacto && <span className="estacao-nome">{nome}</span>}
            </div>
            {i < ESTACOES.length - 1 && (
              <div
                className={`trecho ${trechoFeito ? 'trecho-feito' : ''} ${
                  trechoAtual ? `trecho-atual trecho-${STATUS[status].tom}` : ''
                }`}
              >
                {trechoAtual && !compacto && (
                  <span className="trecho-rotulo">{STATUS[status].rotulo}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
