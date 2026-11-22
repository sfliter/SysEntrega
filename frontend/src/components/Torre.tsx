import { Link } from 'react-router-dom';
import { ordemDaEtapa, STATUS } from '../fluxo';
import { porPavimento } from '../torre';
import type { Etapa, StatusUnidade } from '../tipos';

export interface UnidadeDaTorre {
  id?: string;
  numero: string;
  andar: string | null;
  etapa?: Etapa;
  status?: StatusUnidade;
  // na prévia da montagem: unidade que já existe e será mantida
  existente?: boolean;
}

// A torre desenhada: cada pavimento é uma linha, do mais alto para o mais
// baixo, e cada unidade é uma janela na cor da sua situação. Pavimentos com
// menos unidades ficam mais estreitos, como no prédio.
export default function Torre({
  nome,
  unidades,
  mostrarEtapa = false,
}: {
  nome: string;
  unidades: UnidadeDaTorre[];
  mostrarEtapa?: boolean;
}) {
  const pavimentos = porPavimento(unidades);
  return (
    <figure className="torre" aria-label={`${nome || 'Unidades'}: ${unidades.length} unidades em ${pavimentos.length} pavimentos`}>
      <div className="torre-topo" aria-hidden="true" />
      <div className="torre-corpo">
        {pavimentos.map(({ andar, unidades: doAndar }) => (
          <div key={andar} className="pavimento">
            <span className="pavimento-rotulo">{andar ? `${andar}º` : '—'}</span>
            <div className="pavimento-unidades">
              {doAndar.map((un) => {
                const situacao = un.status ? STATUS[un.status] : null;
                const concluida = un.status === 'ENTREGUE' || un.status === 'RECEBIDA_INCORPORADORA';
                const descricao = situacao
                  ? `${nome ? `${nome} · ` : ''}${un.numero} — ${concluida || !un.etapa ? '' : `etapa ${ordemDaEtapa(un.etapa)}, `}${situacao.rotulo.toLowerCase()}`
                  : `${un.numero}${un.existente ? ' — já existe' : ''}`;
                const classe = `unidade-celula ${situacao ? `celula-${situacao.tom}` : un.existente ? 'celula-existente' : 'celula-nova'}`;
                const conteudo = (
                  <>
                    <strong>
                      {un.numero}
                      {mostrarEtapa && un.etapa && !concluida && <i>E{ordemDaEtapa(un.etapa)}</i>}
                    </strong>
                    <span>{situacao ? situacao.curto : un.existente ? 'Já existe' : 'Nova'}</span>
                  </>
                );
                return un.id ? (
                  <Link key={un.id} to={`/unidades/${un.id}`} className={classe} title={descricao} aria-label={descricao}>
                    {conteudo}
                  </Link>
                ) : (
                  <div key={un.numero} className={classe} title={descricao}>
                    {conteudo}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <figcaption className="torre-base">
        <strong>{nome || 'Sem torre'}</strong>
        <span>
          {unidades.length} {unidades.length === 1 ? 'unidade' : 'unidades'} · {pavimentos.length}{' '}
          {pavimentos.length === 1 ? 'pavimento' : 'pavimentos'}
        </span>
      </figcaption>
    </figure>
  );
}
