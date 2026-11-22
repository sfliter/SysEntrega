import { useSearchParams } from 'react-router-dom';

export interface Aba {
  chave: string;
  rotulo: string;
  selo?: number | string | null;
  tom?: string;
}

// Submenu dentro da página: troca o conteúdo sem rolar. A aba fica na URL
// (?aba=…, ou outro nome de parâmetro), então voltar e compartilhar funcionam.
export function useAba(abas: Aba[], padrao?: string, parametro = 'aba') {
  const [params, setParams] = useSearchParams();
  const pedida = params.get(parametro);
  const atual = abas.find((a) => a.chave === pedida)?.chave ?? padrao ?? abas[0]?.chave;
  const mudar = (chave: string) => {
    const novo = new URLSearchParams(params);
    novo.set(parametro, chave);
    setParams(novo, { replace: true });
  };
  return [atual, mudar] as const;
}

export default function Abas({
  abas,
  atual,
  aoMudar,
  rotulo,
  classe = '',
}: {
  abas: Aba[];
  atual: string;
  aoMudar: (chave: string) => void;
  rotulo: string;
  classe?: string;
}) {
  return (
    <div className={`abas ${classe}`} role="tablist" aria-label={rotulo}>
      {abas.map((a) => (
        <button
          key={a.chave}
          type="button"
          role="tab"
          aria-selected={a.chave === atual}
          className={`aba ${a.chave === atual ? 'ativa' : ''}`}
          onClick={() => aoMudar(a.chave)}
        >
          {a.rotulo}
          {a.selo !== undefined && a.selo !== null && a.selo !== 0 && (
            <span className={`aba-selo ${a.tom ? `aba-selo-${a.tom}` : ''}`}>{a.selo}</span>
          )}
        </button>
      ))}
    </div>
  );
}
