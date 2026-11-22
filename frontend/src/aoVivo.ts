// Atualização "ao vivo" das telas de acompanhamento.
//
// A cada 5 segundos a tela pergunta ao servidor o número do último registro
// da trilha (uma consulta mínima). Só quando ele muda — alguém liberou,
// agendou, vistoriou, assinou — os dados são buscados de novo. Com a aba em
// segundo plano ou sem conexão, as perguntas param.
import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import { fila } from './fila';

const INTERVALO = 5000;
let versao: number | null = null;
let relogio: ReturnType<typeof setInterval> | undefined;
const ouvintes = new Set<() => void>();

let conferindo = false;

async function conferir() {
  if (conferindo || document.visibilityState !== 'visible' || !fila.estado().online || ouvintes.size === 0) return;
  conferindo = true;
  try {
    const { data } = await api.get<{ versao: number }>('/dashboard/versao', { timeout: 8000 });
    // Na primeira resposta ainda não se sabe se os dados já na tela são
    // anteriores a ela: atualiza uma vez para garantir. Daí em diante, só
    // quando a versão muda.
    const mudou = data.versao !== versao;
    versao = data.versao;
    if (mudou) ouvintes.forEach((f) => f());
  } catch {
    // sem resposta agora: tenta de novo no próximo ciclo
  } finally {
    conferindo = false;
  }
}

function ligar() {
  if (relogio) return;
  relogio = setInterval(conferir, INTERVALO);
  document.addEventListener('visibilitychange', conferir);
  window.addEventListener('online', conferir);
}

function desligar() {
  clearInterval(relogio);
  relogio = undefined;
  // A última versão conhecida é mantida: ao voltar a uma tela de
  // acompanhamento, qualquer diferença dispara a atualização.
  document.removeEventListener('visibilitychange', conferir);
  window.removeEventListener('online', conferir);
}

// Chama `aoMudar` sempre que houver novidade no servidor. Devolve a hora da
// última vez em que os dados foram trazidos (para mostrar na tela).
export function useAoVivo(aoMudar: () => unknown) {
  const [atualizadoEm, setAtualizadoEm] = useState(() => new Date());
  const acao = useRef(aoMudar);
  acao.current = aoMudar;
  useEffect(() => {
    const ouvir = async () => {
      await acao.current();
      setAtualizadoEm(new Date());
    };
    ouvintes.add(ouvir);
    ligar();
    // Confere já na abertura: uma mudança feita logo depois de a tela
    // carregar não pode ficar de fora.
    void conferir();
    return () => {
      ouvintes.delete(ouvir);
      if (ouvintes.size === 0) desligar();
    };
  }, []);
  return atualizadoEm;
}
