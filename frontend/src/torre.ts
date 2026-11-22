// Montagem de torre por faixas de pavimentos.
//
// Uma torre raramente é igual do térreo à cobertura: do 1º ao 10º andar são
// 8 apartamentos, do 12º em diante são menos e a numeração muda. Cada faixa
// descreve um trecho — de que andar a que andar, quantas unidades por andar
// e como elas são numeradas — e a torre é a soma das faixas.

export interface Faixa {
  andarInicial: number;
  andarFinal: number;
  porAndar: number;
  // ANDAR_FINAL: o número leva o andar na frente (101, 102… 1201, 1202…)
  // SEQUENCIAL: numeração corrida pela faixa, sem o andar (1, 2, 3…)
  formato: 'ANDAR_FINAL' | 'SEQUENCIAL';
  inicio: number; // primeiro "final" de cada andar, ou primeiro número da sequência
  digitos: number; // casas do final (2 → 01, 02…)
  prefixo: string;
  sufixo: string;
  tipologia: string;
  pular: string; // andares que não existem na faixa, separados por vírgula
}

export interface UnidadeGerada {
  numero: string;
  andar: string;
  tipologia: string;
}

export const FAIXA_PADRAO: Faixa = {
  andarInicial: 1,
  andarFinal: 10,
  porAndar: 8,
  formato: 'ANDAR_FINAL',
  inicio: 1,
  digitos: 2,
  prefixo: '',
  sufixo: '',
  tipologia: '',
  pular: '',
};

export const LIMITE_UNIDADES = 1500;

export function gerarUnidades(faixas: Faixa[]): { unidades: UnidadeGerada[]; erros: string[] } {
  const unidades: UnidadeGerada[] = [];
  const erros: string[] = [];
  faixas.forEach((f, indice) => {
    const nome = `Faixa ${indice + 1}`;
    const inteiro = (v: number) => Number.isInteger(v);
    if (!inteiro(f.andarInicial) || !inteiro(f.andarFinal) || f.andarInicial < 0) {
      erros.push(`${nome}: informe os andares com números inteiros.`);
      return;
    }
    if (f.andarFinal < f.andarInicial) {
      erros.push(`${nome}: o andar final vem antes do inicial.`);
      return;
    }
    if (f.andarFinal - f.andarInicial > 150) {
      erros.push(`${nome}: no máximo 150 pavimentos por faixa.`);
      return;
    }
    if (!inteiro(f.porAndar) || f.porAndar < 1 || f.porAndar > 40) {
      erros.push(`${nome}: de 1 a 40 unidades por andar.`);
      return;
    }
    if (!inteiro(f.inicio) || f.inicio < 0 || !inteiro(f.digitos) || f.digitos < 1 || f.digitos > 4) {
      erros.push(`${nome}: confira o número inicial e a quantidade de casas.`);
      return;
    }
    const pulados = new Set(
      f.pular
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number),
    );
    let corrido = f.inicio;
    for (let andar = f.andarInicial; andar <= f.andarFinal; andar++) {
      if (pulados.has(andar)) continue;
      for (let i = 0; i < f.porAndar; i++) {
        const miolo =
          f.formato === 'ANDAR_FINAL'
            ? `${andar}${String(f.inicio + i).padStart(f.digitos, '0')}`
            : String(corrido++).padStart(f.digitos, '0');
        unidades.push({
          numero: `${f.prefixo}${miolo}${f.sufixo}`.trim().slice(0, 20),
          andar: String(andar),
          tipologia: f.tipologia.trim(),
        });
      }
    }
  });

  const vistos = new Set<string>();
  const repetidos = new Set<string>();
  for (const u of unidades) (vistos.has(u.numero) ? repetidos : vistos).add(u.numero);
  if (repetidos.size) {
    const lista = [...repetidos];
    erros.push(
      `Numeração repetida entre as faixas: ${lista.slice(0, 8).join(', ')}${lista.length > 8 ? '…' : ''}. Mude o prefixo, o número inicial ou os andares.`,
    );
  }
  if (unidades.length > LIMITE_UNIDADES) {
    erros.push(`São ${unidades.length} unidades; o limite por montagem é ${LIMITE_UNIDADES}. Monte a torre em duas partes.`);
  }
  return { unidades, erros };
}

// Agrupa unidades por andar, do mais alto para o mais baixo (como no prédio)
export function porPavimento<T extends { numero: string; andar: string | null }>(unidades: T[]) {
  const andares = new Map<string, T[]>();
  for (const u of unidades) {
    const chave = u.andar ?? '';
    andares.set(chave, [...(andares.get(chave) ?? []), u]);
  }
  const valor = (a: string) => (a === '' ? -Infinity : Number.parseFloat(a) || 0);
  return [...andares.entries()]
    .sort(([a], [b]) => valor(b) - valor(a))
    .map(([andar, lista]) => ({
      andar,
      unidades: lista.sort((a, b) => a.numero.localeCompare(b.numero, 'pt-BR', { numeric: true })),
    }));
}
