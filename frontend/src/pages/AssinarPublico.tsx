import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { abrirPdf, api, DEMO } from '../api';
import { Carregando, Erro, Marca, useAcao, useCarregar } from '../components/Basicos';
import CampoAssinatura, { obterLocalizacao } from '../components/CampoAssinatura';
import { dataHora, RESULTADO_VISTORIA } from '../fluxo';

interface Dados {
  protocolo: string;
  titulo: string;
  empreendimento: string;
  unidade: string;
  resultadoVistoria: string | null;
  nome: string;
  email: string | null;
  status: 'PENDENTE' | 'ASSINADO' | 'RECUSADO';
  statusEnvelope: string;
  assinadoEm: string | null;
  pendente: boolean;
  temAssinado: boolean;
  codigoEnviado: boolean;
  sha256: string;
}

// Página do cliente final, sem login: lê o termo, recebe um código no e-mail
// e assina.
export default function AssinarPublico() {
  const { token } = useParams();
  const base = `/publico/assinatura/${token}`;
  const { dados, erro, carregando, recarregar } = useCarregar<Dados>(async () => (await api.get(base)).data, [token]);
  const [envio, setEnvio] = useState<{ enviadoPara: string; validadeMinutos: number; ensaio: boolean; codigoDemo?: string } | null>(null);
  const [codigo, setCodigo] = useState('');
  const [rubrica, setRubrica] = useState<string | null>(null);
  const [li, setLi] = useState(false);
  const [recusando, setRecusando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const acao = useAcao();

  const pedirCodigo = () =>
    acao.executar(async () => {
      setEnvio((await api.post(`${base}/codigo`)).data);
    });

  const assinar = async () => {
    const ok = await acao.executar(async () => {
      const localizacao = await obterLocalizacao();
      await api.post(`${base}/assinar`, {
        codigo,
        assinaturaImagem: rubrica ?? undefined,
        localizacao: localizacao ?? undefined,
      });
    });
    if (ok) recarregar();
  };

  const temCodigo = !!envio || !!dados?.codigoEnviado;

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
            <p className="etiqueta">Assinatura eletrônica</p>
            <h1>{dados.titulo}</h1>
            <p>
              {dados.empreendimento} · unidade <strong>{dados.unidade}</strong>
              <br />
              <span className="mono">Protocolo {dados.protocolo}</span>
            </p>
            {dados.resultadoVistoria && (
              <p className="suave">Vistoria: {RESULTADO_VISTORIA[dados.resultadoVistoria]?.rotulo}</p>
            )}

            {/* Link direto: abre o PDF no leitor do próprio aparelho */}
            {DEMO ? (
              <button type="button" className="botao botao-cheio" onClick={() => abrirPdf(`${base}/documento`)}>
                {dados.temAssinado ? 'Abrir o termo assinado' : 'Ler o termo completo'}
              </button>
            ) : (
              <a className="botao botao-cheio" href={`/api${base}/documento`} target="_blank" rel="noreferrer">
                {dados.temAssinado ? 'Abrir o termo assinado (PDF)' : 'Ler o termo completo (PDF)'}
              </a>
            )}
            <Erro>{acao.erro}</Erro>

            {dados.status === 'ASSINADO' && (
              <div className="aviso aviso-ok" role="status">
                <strong>Termo assinado por {dados.nome}</strong> em {dataHora(dados.assinadoEm)}.
                {dados.statusEnvelope !== 'CONCLUIDO' && ' Aguardando a assinatura da outra parte.'}
              </div>
            )}
            {dados.status === 'RECUSADO' && (
              <div className="aviso" role="status">
                Você recusou este termo. A Central de Relacionamento vai entrar em contato.
              </div>
            )}
            {dados.status === 'PENDENTE' && !dados.pendente && (
              <div className="aviso" role="status">
                Este termo não está mais disponível para assinatura. Fale com a Central de Relacionamento.
              </div>
            )}

            {dados.pendente && !recusando && (
              <>
                <ol className="etapas-assinatura">
                  <li className={temCodigo ? 'feita' : 'atual'}>
                    <strong>1. Receba o código</strong>
                    {!temCodigo ? (
                      <>
                        <p className="suave">
                          {dados.email
                            ? `Enviaremos um código de 6 dígitos para ${dados.email}.`
                            : 'Não há e-mail cadastrado para você. Fale com a Central de Relacionamento.'}
                        </p>
                        <button type="button" className="botao botao-primario" disabled={!dados.email || acao.enviando} onClick={pedirCodigo}>
                          {acao.enviando ? 'Enviando…' : 'Enviar código'}
                        </button>
                      </>
                    ) : (
                      <p className="suave">
                        {envio
                          ? `Código enviado para ${envio.enviadoPara}. Vale por ${envio.validadeMinutos} minutos.`
                          : 'Código já enviado para o seu e-mail.'}{' '}
                        <button type="button" className="link" disabled={acao.enviando} onClick={pedirCodigo}>
                          Enviar de novo
                        </button>
                      </p>
                    )}
                    {envio?.codigoDemo && (
                      <div className="aviso" role="status">
                        Demonstração: na operação este código chega ao e-mail do cliente. Aqui ele é{' '}
                        <strong className="mono">{envio.codigoDemo}</strong>.
                      </div>
                    )}
                    {envio?.ensaio && (
                      <div className="aviso aviso-perigo">
                        Ambiente de ensaio: o e-mail não está configurado e o código foi escrito apenas no log do
                        servidor. Assinatura feita assim não tem valor.
                      </div>
                    )}
                  </li>
                  <li className={temCodigo ? 'atual' : ''}>
                    <strong>2. Assine</strong>
                    {temCodigo && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          assinar();
                        }}
                      >
                        <label className="campo">
                          <span>Código recebido</span>
                          <input
                            className="codigo"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            pattern="\d{6}"
                            maxLength={6}
                            value={codigo}
                            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
                            required
                          />
                        </label>
                        <div className="campo">
                          <span>Sua assinatura</span>
                          <CampoAssinatura aoMudar={setRubrica} />
                        </div>
                        <label className="marcar">
                          <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} required />
                          <span>Li o termo completo e concordo com o seu conteúdo.</span>
                        </label>
                        <p className="suave">
                          Ao assinar, ficam registrados a data e a hora, o IP, o navegador e, se você permitir, a
                          localização do aparelho.
                        </p>
                        <button className="botao botao-primario botao-cheio" disabled={acao.enviando || codigo.length !== 6 || !li || !rubrica}>
                          {acao.enviando ? 'Assinando…' : 'Assinar o termo'}
                        </button>
                      </form>
                    )}
                  </li>
                </ol>
                <button type="button" className="link link-perigo" onClick={() => setRecusando(true)}>
                  Não concordo com o termo
                </button>
              </>
            )}

            {dados.pendente && recusando && (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await acao.executar(() => api.post(`${base}/recusar`, { motivo }))) recarregar();
                }}
              >
                <label className="campo">
                  <span>Com o que você não concorda?</span>
                  <textarea rows={4} value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={5} autoFocus />
                </label>
                <button className="botao botao-perigo botao-cheio" disabled={acao.enviando}>
                  Recusar o termo
                </button>
                <button type="button" className="link" onClick={() => setRecusando(false)}>
                  Voltar
                </button>
              </form>
            )}
            <p className="hash">
              SHA-256 do termo <span className="mono">{dados.sha256}</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
