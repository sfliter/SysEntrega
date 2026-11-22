import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { mensagemDeErro } from '../api';
import { STATUS } from '../fluxo';
import type { StatusUnidade } from '../tipos';
import LogoRsf from './LogoRsf';

export function Marca({ clara = false }: { clara?: boolean }) {
  return (
    <div className={`marca ${clara ? 'marca-clara' : ''}`}>
      <LogoRsf className="marca-logo" />
      <span className="marca-nome">SysEntrega</span>
    </div>
  );
}

export function Pill({ tom, children }: { tom: string; children: ReactNode }) {
  return <span className={`pill pill-${tom}`}>{children}</span>;
}

export function PillStatus({ status }: { status: StatusUnidade }) {
  return <Pill tom={STATUS[status].tom}>{STATUS[status].rotulo}</Pill>;
}

export function Erro({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="aviso aviso-perigo" role="alert">
      {children}
    </div>
  );
}

export function Modal({
  titulo,
  aoFechar,
  children,
  largo = false,
}: {
  titulo: string;
  aoFechar: () => void;
  children: ReactNode;
  largo?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${largo ? 'modal-largo' : ''}`}
      onClose={aoFechar}
      onClick={(e) => {
        // Clique fora do cartão (no fundo escurecido) fecha
        if (e.target === ref.current) aoFechar();
      }}
    >
      <div className="modal-cartao">
        <header className="modal-topo">
          <h2>{titulo}</h2>
          <button type="button" className="fechar" onClick={aoFechar} aria-label="Fechar">
            ×
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

// Carrega dados de uma função assíncrona, com estado de carregando/erro e
// uma função para recarregar depois de uma ação.
export function useCarregar<T>(buscar: () => Promise<T>, deps: unknown[]) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const versao = useRef(0);

  const recarregar = useCallback(async () => {
    const minha = ++versao.current;
    setCarregando(true);
    try {
      const d = await buscar();
      // Resposta de uma busca antiga não sobrescreve a mais nova
      if (minha === versao.current) {
        setDados(d);
        setErro('');
      }
    } catch (e) {
      if (minha === versao.current) setErro(mensagemDeErro(e));
    } finally {
      if (minha === versao.current) setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    recarregar();
  }, [recarregar]);

  return { dados, erro, carregando, recarregar };
}

// Executa uma ação (POST etc.) guardando "enviando" e a mensagem de erro
export function useAcao() {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const executar = useCallback(async (acao: () => Promise<unknown>) => {
    setEnviando(true);
    setErro('');
    try {
      await acao();
      return true;
    } catch (e) {
      setErro(mensagemDeErro(e));
      return false;
    } finally {
      setEnviando(false);
    }
  }, []);
  return { enviando, erro, executar, limparErro: () => setErro('') };
}

export function Carregando() {
  return <p className="suave">Carregando…</p>;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <p className="vazio">{children}</p>;
}
