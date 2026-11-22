import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { Carregando, Erro, Marca, useAcao, useCarregar } from '../components/Basicos';
import { dataLonga, hora } from '../fluxo';

interface Dados {
  status: 'PROPOSTO' | 'CONFIRMADO' | 'CANCELADO' | 'REALIZADO';
  dataHora: string | null;
  local: string | null;
  observacao: string | null;
  empreendimento: string;
  endereco: string | null;
  unidade: string;
  cliente: string | null;
  opcoes: { id: string; inicio: string; escolhida: boolean; disponivel: boolean }[];
}

// Página do cliente final, sem login: ele escolhe um dos horários oferecidos
export default function AgendarPublico() {
  const { token } = useParams();
  const { dados, erro, carregando, recarregar } = useCarregar<Dados>(
    async () => (await api.get(`/publico/agendamento/${token}`)).data,
    [token],
  );
  const [escolhida, setEscolhida] = useState('');
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const acao = useAcao();

  return (
    <div className="publico">
      <div className="publico-cartao">
        <Marca clara />
        {carregando && !dados ? (
          <Carregando />
        ) : erro || !dados ? (
          <Erro>{erro || 'Link inválido'}</Erro>
        ) : (
          <>
            <p className="etiqueta">Vistoria de entrega</p>
            <h1>
              {dados.empreendimento}
              <br />
              <span className="publico-unidade">Unidade {dados.unidade}</span>
            </h1>
            {dados.cliente && <p className="suave">Olá, {dados.cliente}.</p>}
            <Erro>{acao.erro}</Erro>

            {dados.status === 'PROPOSTO' && !recusando && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await acao.executar(() => api.post(`/publico/agendamento/${token}/confirmar`, { opcaoId: escolhida }))) recarregar();
                }}
              >
                <p>Escolha o melhor horário para vistoriar a sua unidade:</p>
                <div className="escolhas" role="radiogroup" aria-label="Horários disponíveis">
                  {dados.opcoes.map((o) => (
                    <label key={o.id} className={`escolha ${escolhida === o.id ? 'ativa' : ''} ${o.disponivel ? '' : 'indisponivel'}`}>
                      <input type="radio" name="opcao" value={o.id} disabled={!o.disponivel} checked={escolhida === o.id} onChange={() => setEscolhida(o.id)} />
                      <span>
                        <strong>{dataLonga(o.inicio)}</strong>
                        <span className="mono">{hora(o.inicio)}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {(dados.local || dados.endereco) && (
                  <p className="suave">Local: {[dados.local, dados.endereco].filter(Boolean).join(' — ')}</p>
                )}
                {dados.observacao && <p className="suave">{dados.observacao}</p>}
                <button className="botao botao-primario botao-cheio" disabled={!escolhida || acao.enviando}>
                  {acao.enviando ? 'Confirmando…' : 'Confirmar horário'}
                </button>
                <button type="button" className="link" onClick={() => setRecusando(true)}>
                  Nenhum horário serve para mim
                </button>
              </form>
            )}

            {dados.status === 'PROPOSTO' && recusando && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await acao.executar(() => api.post(`/publico/agendamento/${token}/recusar`, { motivo }))) recarregar();
                }}
              >
                <label className="campo">
                  <span>Conte quais dias e horários seriam melhores para você</span>
                  <textarea rows={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={5} autoFocus />
                </label>
                <button className="botao botao-primario botao-cheio" disabled={acao.enviando}>
                  Pedir outros horários
                </button>
                <button type="button" className="link" onClick={() => setRecusando(false)}>
                  Voltar aos horários
                </button>
              </form>
            )}

            {(dados.status === 'CONFIRMADO' || dados.status === 'REALIZADO') && dados.dataHora && (
              <div className="aviso aviso-ok" role="status">
                <strong>{dados.status === 'REALIZADO' ? 'Vistoria realizada' : 'Vistoria confirmada'}</strong>
                <br />
                {dataLonga(dados.dataHora)}, às {hora(dados.dataHora)}
                {(dados.local || dados.endereco) && (
                  <>
                    <br />
                    {[dados.local, dados.endereco].filter(Boolean).join(' — ')}
                  </>
                )}
              </div>
            )}
            {dados.status === 'CONFIRMADO' && (
              <p className="suave">Precisa mudar? Fale com a Central de Relacionamento.</p>
            )}
            {dados.status === 'CANCELADO' && (
              <div className="aviso" role="status">
                Este agendamento foi cancelado. A Central de Relacionamento vai entrar em contato com novos horários.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
