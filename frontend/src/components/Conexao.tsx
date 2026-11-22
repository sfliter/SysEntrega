import { Component, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fila } from '../fila';

export function useFila() {
  return useSyncExternalStore(fila.assinar, fila.estado);
}

// Faixa no alto da tela: aparece só quando há algo que o usuário precisa
// saber — sem sinal, ou vistoria com alterações ainda não enviadas.
export function FaixaConexao() {
  const f = useFila();
  const total = f.pendentes + f.comErro;
  if (f.online && total === 0) return null;
  const vistoriaId = f.ops[0]?.vistoriaId;
  return (
    <div className={`faixa ${f.comErro ? 'faixa-perigo' : f.online ? 'faixa-envio' : 'faixa-offline'}`} role="status">
      <span className="faixa-ponto" />
      <span>
        {!f.online && <strong>Sem conexão. </strong>}
        {total === 0
          ? 'O que você fizer numa vistoria fica salvo neste aparelho e é enviado quando o sinal voltar.'
          : f.comErro > 0
            ? `${f.comErro} alteração(ões) de vistoria recusada(s) pelo servidor — abra a vistoria para ver.`
            : f.sincronizando && f.online
              ? `Enviando ${f.pendentes} alteração(ões) de vistoria…`
              : `${f.pendentes} alteração(ões) de vistoria salva(s) neste aparelho, aguardando envio.`}
        {!f.persistente && total > 0 && ' Não feche esta página até o envio terminar.'}
      </span>
      {vistoriaId && (
        <Link to={`/vistorias/${vistoriaId}`} className="faixa-link">
          Ver vistoria
        </Link>
      )}
    </div>
  );
}

// Um erro inesperado numa tela não pode derrubar o sistema inteiro — nem
// esconder que a fila da vistoria continua salva.
export class Protecao extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="cartao" role="alert">
        <h2>Esta tela encontrou um problema</h2>
        <p className="suave">
          O que já foi registrado está salvo. Vistorias com alterações na fila continuam guardadas neste aparelho.
        </p>
        <p className="mono suave">{this.state.erro.message}</p>
        <div className="passo-acoes">
          <button type="button" className="botao botao-primario" onClick={() => this.setState({ erro: null })}>
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
}
