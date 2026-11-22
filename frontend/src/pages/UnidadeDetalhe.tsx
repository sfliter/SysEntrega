import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { abrirPdf, api, mensagemDeErro } from '../api';
import { Carregando, Erro, Modal, Pill, PillStatus, useAcao, useCarregar, Vazio } from '../components/Basicos';
import CampoAssinatura, { obterLocalizacao } from '../components/CampoAssinatura';
import Historico from '../components/Historico';
import Trilho from '../components/Trilho';
import {
  dataHora,
  ESTACOES,
  formatarCpfCnpj,
  METODO,
  ordemDaEtapa,
  PARTE,
  RESULTADO_VISTORIA,
  rotuloDaEtapa,
  rotuloUnidade,
} from '../fluxo';
import type { Agendamento, DetalheUnidade, Documento, Pendencia, Signatario } from '../tipos';

type ModalAberto =
  | { tipo: 'liberar' }
  | { tipo: 'propor'; reagendar?: Agendamento }
  | { tipo: 'confirmar'; agendamento: Agendamento; opcaoId: string }
  | { tipo: 'cancelarAgendamento'; agendamento: Agendamento }
  | { tipo: 'resolver'; pendencia: Pendencia }
  | { tipo: 'assinar'; signatario: Signatario; documento: Documento }
  | { tipo: 'recusar'; signatario: Signatario; documento: Documento }
  | { tipo: 'anular'; documento: Documento }
  | { tipo: 'cliente' }
  | null;

export default function UnidadeDetalhe() {
  const { id } = useParams();
  const navegar = useNavigate();
  const [modal, setModal] = useState<ModalAberto>(null);
  const [versao, setVersao] = useState(0);
  const acao = useAcao();
  const { dados, erro, carregando, recarregar } = useCarregar<DetalheUnidade>(
    async () => (await api.get(`/unidades/${id}`)).data,
    [id],
  );

  if (carregando && !dados) return <Carregando />;
  if (erro || !dados) return <Erro>{erro || 'Unidade não encontrada'}</Erro>;

  const { unidade, permissoes, etapa } = dados;
  const ordem = ordemDaEtapa(unidade.etapa);
  const quemEntrega = ESTACOES[ordem - 1];
  const quemRecebe = ESTACOES[ordem];
  const comCliente = etapa.recebedor === null;

  const atualizar = () => {
    setModal(null);
    setVersao((v) => v + 1);
    recarregar();
  };

  const agendamentoAberto = dados.agendamentos.find(
    (a) => a.etapa === unidade.etapa && (a.status === 'PROPOSTO' || a.status === 'CONFIRMADO'),
  );
  const vistoriaAberta = dados.vistorias.find((v) => v.etapa === unidade.etapa && v.status === 'EM_ANDAMENTO');
  const termoAberto = dados.documentos.find((d) => d.etapa === unidade.etapa && d.envelope?.status === 'PENDENTE');
  const pendenciasDaEtapa = dados.pendencias.filter((p) => p.etapa === unidade.etapa);
  const abertas = pendenciasDaEtapa.filter((p) => p.status === 'ABERTA');

  async function iniciarVistoria() {
    let nova: { id: string } | undefined;
    const ok = await acao.executar(async () => {
      nova = (await api.post(`/unidades/${unidade.id}/vistorias`)).data;
    });
    if (ok && nova) navegar(`/vistorias/${nova.id}`);
  }

  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">
            <Link to="/unidades">Unidades</Link> / {unidade.empreendimento.nome}
          </p>
          <h1>{rotuloUnidade(unidade)}</h1>
          <p className="suave">
            {[unidade.andar && `${unidade.andar}º andar`, unidade.tipologia, unidade.empreendimento.endereco]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <PillStatus status={unidade.status} />
      </header>

      <section className="cartao cartao-trilho">
        <Trilho etapa={unidade.etapa} status={unidade.status} />
      </section>

      {/* ---------- o que acontece agora ---------- */}
      <section className="cartao cartao-destaque">
        <p className="etiqueta">
          {unidade.status === 'ENTREGUE' ? 'Concluído' : `Etapa ${ordem} de 3 · ${rotuloDaEtapa(unidade.etapa)}`}
        </p>
        <Erro>{acao.erro}</Erro>

        {unidade.status === 'AGUARDANDO_LIBERACAO' && (
          <Passo
            titulo={`Aguardando a ${quemEntrega} liberar a unidade`}
            texto={
              ordem === 1
                ? 'Com a obra da unidade concluída, a construtora a libera para a vistoria técnica da incorporadora.'
                : 'A incorporadora repassa a unidade à Central de Relacionamento, que confere e a recebe.'
            }
          >
            {permissoes.liberar && (
              <button type="button" className="botao botao-primario" onClick={() => setModal({ tipo: 'liberar' })}>
                Liberar unidade
              </button>
            )}
          </Passo>
        )}

        {unidade.status === 'AGUARDANDO_AGENDAMENTO' && !agendamentoAberto && (
          <Passo
            titulo="Falta combinar a data da vistoria"
            texto={
              comCliente
                ? unidade.cliente
                  ? 'Ofereça horários: o cliente escolhe um deles pelo link de agendamento.'
                  : 'Vincule o cliente à unidade para poder agendar a vistoria com ele.'
                : 'Uma das partes oferece os horários e a outra escolhe.'
            }
          >
            {permissoes.proporHorarios && (!comCliente || unidade.cliente) && (
              <button type="button" className="botao botao-primario" onClick={() => setModal({ tipo: 'propor' })}>
                Oferecer horários
              </button>
            )}
            {comCliente && !unidade.cliente && permissoes.vincularCliente && (
              <button type="button" className="botao botao-primario" onClick={() => setModal({ tipo: 'cliente' })}>
                Vincular cliente
              </button>
            )}
          </Passo>
        )}

        {agendamentoAberto?.status === 'PROPOSTO' && (
          <Passo
            titulo={`Horários oferecidos — aguardando ${comCliente ? 'o cliente' : 'a outra parte'} escolher`}
            texto={[agendamentoAberto.local, agendamentoAberto.observacao].filter(Boolean).join(' · ') || undefined}
          >
            <div className="opcoes">
              {agendamentoAberto.opcoes.map((o) =>
                agendamentoAberto.podeConfirmar ? (
                  <button
                    key={o.id}
                    type="button"
                    className="botao opcao"
                    onClick={() => setModal({ tipo: 'confirmar', agendamento: agendamentoAberto, opcaoId: o.id })}
                  >
                    {dataHora(o.inicio)}
                  </button>
                ) : (
                  <span key={o.id} className="opcao opcao-fixa">
                    {dataHora(o.inicio)}
                  </span>
                ),
              )}
            </div>
            {agendamentoAberto.podeConfirmar && (
              <p className="suave">
                {comCliente
                  ? 'O cliente escolhe pelo link abaixo. Se ele confirmou por telefone, clique no horário para registrar.'
                  : 'Clique no horário que serve para confirmar.'}
              </p>
            )}
            {agendamentoAberto.tokenCliente && (
              <LinkCliente rotulo="Link de agendamento do cliente" caminho={`/agendar/${agendamentoAberto.tokenCliente}`} />
            )}
            <AcoesAgendamento ag={agendamentoAberto} abrir={setModal} />
          </Passo>
        )}

        {unidade.status === 'VISTORIA_AGENDADA' && agendamentoAberto && (
          <Passo
            titulo={`${etapa.nomeVistoria} marcada para ${dataHora(agendamentoAberto.dataHora)}`}
            texto={
              [
                agendamentoAberto.local,
                agendamentoAberto.confirmadoPeloCliente && 'confirmada pelo cliente no link',
              ]
                .filter(Boolean)
                .join(' · ') || undefined
            }
          >
            {permissoes.iniciarVistoria && (
              <button type="button" className="botao botao-primario" onClick={iniciarVistoria} disabled={acao.enviando}>
                Iniciar vistoria
              </button>
            )}
            <AcoesAgendamento ag={agendamentoAberto} abrir={setModal} />
          </Passo>
        )}

        {unidade.status === 'AGUARDANDO_CONFERENCIA' && (
          <Passo
            titulo={`Aguardando a conferência da ${quemRecebe === 'Relacionamento' ? 'Central de Relacionamento' : quemRecebe}`}
            texto="Quem recebe confere a unidade, as chaves e os documentos, item a item."
          >
            {permissoes.iniciarVistoria && (
              <button type="button" className="botao botao-primario" onClick={iniciarVistoria} disabled={acao.enviando}>
                Iniciar conferência
              </button>
            )}
          </Passo>
        )}

        {unidade.status === 'EM_VISTORIA' && vistoriaAberta && (
          <Passo
            titulo={`${etapa.nomeVistoria} em andamento`}
            texto={`Iniciada por ${vistoriaAberta.vistoriadorNome} em ${dataHora(vistoriaAberta.iniciadaEm)}.`}
          >
            <Link to={`/vistorias/${vistoriaAberta.id}`} className="botao botao-primario">
              {vistoriaAberta.podeConduzir ? 'Continuar vistoria' : 'Acompanhar vistoria'}
            </Link>
          </Passo>
        )}

        {unidade.status === 'COM_PENDENCIAS' && (
          <Passo
            titulo={
              abertas.length
                ? `${abertas.length} pendência(s) em aberto`
                : 'Pendências sanadas — a unidade pode ser reapresentada'
            }
            texto={
              abertas.length
                ? 'Cada pendência precisa da resolução registrada antes de a unidade voltar para vistoria.'
                : undefined
            }
          >
            {permissoes.resolverPendencias && abertas.length === 0 && (
              <button type="button" className="botao botao-primario" onClick={() => setModal({ tipo: 'liberar' })}>
                Reapresentar unidade
              </button>
            )}
          </Passo>
        )}

        {unidade.status === 'AGUARDANDO_ASSINATURA' && termoAberto && (
          <Passo
            titulo={`Termo ${termoAberto.protocolo} aguardando assinaturas`}
            texto="A etapa só é concluída com a assinatura das duas partes."
          />
        )}

        {unidade.status === 'ENTREGUE' && (
          <Passo
            titulo="Unidade entregue ao cliente"
            texto="Vistoria aceita, termo assinado e chaves entregues. O histórico completo está abaixo."
          />
        )}
      </section>

      {/* ---------- pendências ---------- */}
      {pendenciasDaEtapa.length > 0 && (
        <section className="cartao">
          <h2>Pendências desta etapa</h2>
          <ul className="lista">
            {pendenciasDaEtapa.map((p) => (
              <li key={p.id} className="lista-linha lista-linha-topo">
                <div>
                  <strong>{p.descricao}</strong>
                  {p.status === 'RESOLVIDA' ? (
                    <span>
                      Resolvida por {p.resolvidaPorNome} em {dataHora(p.resolvidaEm)}: {p.resolucao}
                    </span>
                  ) : (
                    <span>Aberta em {dataHora(p.criadoEm)}</span>
                  )}
                </div>
                {p.status === 'RESOLVIDA' ? (
                  <Pill tom="ok">Resolvida</Pill>
                ) : permissoes.resolverPendencias ? (
                  <button type="button" className="botao" onClick={() => setModal({ tipo: 'resolver', pendencia: p })}>
                    Registrar resolução
                  </button>
                ) : (
                  <Pill tom="perigo">Aberta</Pill>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---------- termos ---------- */}
      <section className="cartao">
        <h2>Termos e assinaturas</h2>
        {dados.documentos.length === 0 ? (
          <Vazio>O termo é emitido quando a vistoria é aprovada.</Vazio>
        ) : (
          dados.documentos.map((d) => <Termo key={d.id} d={d} abrir={setModal} aoMudar={atualizar} />)
        )}
      </section>

      <div className="duas-colunas">
        {/* ---------- vistorias ---------- */}
        <section className="cartao">
          <h2>Vistorias</h2>
          {dados.vistorias.length === 0 ? (
            <Vazio>Nenhuma vistoria realizada.</Vazio>
          ) : (
            <ul className="lista">
              {dados.vistorias.map((v) => (
                <li key={v.id}>
                  <Link to={`/vistorias/${v.id}`} className="lista-linha">
                    <div>
                      <strong>
                        Etapa {ordemDaEtapa(v.etapa)} · {dataHora(v.iniciadaEm)}
                      </strong>
                      <span>
                        {v.vistoriadorNome}
                        {v.acompanhante ? ` · acompanhada por ${v.acompanhante}` : ''} · {v.totalItens} itens
                      </span>
                    </div>
                    {v.status === 'EM_ANDAMENTO' ? (
                      <Pill tom="andamento">Em andamento</Pill>
                    ) : v.status === 'CANCELADA' ? (
                      <Pill tom="neutro">Cancelada</Pill>
                    ) : (
                      <Pill tom={RESULTADO_VISTORIA[v.resultado!].tom}>{RESULTADO_VISTORIA[v.resultado!].rotulo}</Pill>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------- agendamentos + cliente ---------- */}
        <section className="cartao">
          <h2>Agendamentos</h2>
          {dados.agendamentos.length === 0 ? (
            <Vazio>Nenhum agendamento.</Vazio>
          ) : (
            <ul className="lista">
              {dados.agendamentos.map((a) => (
                <li key={a.id} className="lista-linha lista-linha-topo">
                  <div>
                    <strong>
                      Etapa {ordemDaEtapa(a.etapa)} ·{' '}
                      {a.dataHora ? dataHora(a.dataHora) : `${a.opcoes.length} horário(s) oferecido(s)`}
                    </strong>
                    <span>
                      {a.status === 'CANCELADO'
                        ? a.motivoCancelamento
                        : [a.local, a.confirmadoPeloCliente && 'confirmado pelo cliente'].filter(Boolean).join(' · ') ||
                          `Oferecido em ${dataHora(a.criadoEm)}`}
                    </span>
                  </div>
                  <Pill
                    tom={
                      a.status === 'CANCELADO'
                        ? 'neutro'
                        : a.status === 'REALIZADO'
                          ? 'ok'
                          : a.status === 'CONFIRMADO'
                            ? 'andamento'
                            : 'atencao'
                    }
                  >
                    {{ PROPOSTO: 'Proposto', CONFIRMADO: 'Confirmado', CANCELADO: 'Cancelado', REALIZADO: 'Realizado' }[a.status]}
                  </Pill>
                </li>
              ))}
            </ul>
          )}

          <h2 className="h2-seguinte">Cliente</h2>
          {unidade.cliente ? (
            <p>
              <strong>{unidade.cliente.nome}</strong>
              <br />
              <span className="suave">
                {[formatarCpfCnpj(unidade.cliente.cpfCnpj), unidade.cliente.email, unidade.cliente.telefone]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </p>
          ) : (
            <Vazio>{permissoes.vincularCliente ? 'Nenhum cliente vinculado.' : 'Informação não disponível para o seu perfil.'}</Vazio>
          )}
          {permissoes.vincularCliente && (
            <button type="button" className="link" onClick={() => setModal({ tipo: 'cliente' })}>
              {unidade.cliente ? 'Trocar cliente' : 'Vincular cliente'}
            </button>
          )}
        </section>
      </div>

      <section className="cartao">
        <h2>Histórico da unidade</h2>
        <Historico unidadeId={unidade.id} versao={versao} />
      </section>

      {/* ---------- modais ---------- */}
      {modal?.tipo === 'liberar' && (
        <ModalTexto
          titulo={unidade.status === 'COM_PENDENCIAS' ? 'Reapresentar unidade' : 'Liberar unidade'}
          rotulo="Observação (opcional)"
          confirmar={unidade.status === 'COM_PENDENCIAS' ? 'Reapresentar' : 'Liberar'}
          aoFechar={() => setModal(null)}
          aoEnviar={(observacao) =>
            api.post(`/unidades/${unidade.id}/liberar`, { observacao: observacao || undefined }).then(atualizar)
          }
        />
      )}
      {modal?.tipo === 'propor' && (
        <ModalHorarios
          unidadeId={unidade.id}
          reagendar={modal.reagendar}
          aoFechar={() => setModal(null)}
          aoSalvar={atualizar}
        />
      )}
      {modal?.tipo === 'confirmar' && (
        <ModalTexto
          titulo={`Confirmar ${dataHora(modal.agendamento.opcoes.find((o) => o.id === modal.opcaoId)?.inicio)}`}
          rotulo={comCliente ? 'Como o cliente confirmou? (telefone, WhatsApp, e-mail…)' : 'Observação (opcional)'}
          minimo={comCliente ? 5 : 0}
          confirmar="Confirmar horário"
          aoFechar={() => setModal(null)}
          aoEnviar={(observacao) =>
            api
              .post(`/agendamentos/${modal.agendamento.id}/confirmar`, {
                opcaoId: modal.opcaoId,
                observacao: observacao || undefined,
              })
              .then(atualizar)
          }
        />
      )}
      {modal?.tipo === 'cancelarAgendamento' && (
        <ModalTexto
          titulo="Cancelar agendamento"
          rotulo="Motivo do cancelamento"
          minimo={5}
          confirmar="Cancelar agendamento"
          perigo
          aoFechar={() => setModal(null)}
          aoEnviar={(motivo) => api.post(`/agendamentos/${modal.agendamento.id}/cancelar`, { motivo }).then(atualizar)}
        />
      )}
      {modal?.tipo === 'resolver' && (
        <ModalTexto
          titulo="Registrar resolução"
          descricao={modal.pendencia.descricao}
          rotulo="O que foi feito"
          minimo={5}
          confirmar="Marcar como resolvida"
          aoFechar={() => setModal(null)}
          aoEnviar={(resolucao) => api.post(`/pendencias/${modal.pendencia.id}/resolver`, { resolucao }).then(atualizar)}
        />
      )}
      {modal?.tipo === 'assinar' && (
        <ModalAssinar documento={modal.documento} signatario={modal.signatario} aoFechar={() => setModal(null)} aoAssinar={atualizar} />
      )}
      {modal?.tipo === 'recusar' && (
        <ModalTexto
          titulo={`Recusar o termo ${modal.documento.protocolo}`}
          descricao="A recusa encerra este termo e devolve a unidade com uma pendência. Será preciso nova vistoria e novo termo."
          rotulo="Motivo da recusa"
          minimo={5}
          confirmar="Recusar assinatura"
          perigo
          aoFechar={() => setModal(null)}
          aoEnviar={(motivo) => api.post(`/signatarios/${modal.signatario.id}/recusar`, { motivo }).then(atualizar)}
        />
      )}
      {modal?.tipo === 'anular' && (
        <ModalTexto
          titulo={`Anular o termo ${modal.documento.protocolo}`}
          descricao="Use quando o termo saiu com erro. A unidade volta para nova vistoria e as assinaturas já colhidas neste termo deixam de valer."
          rotulo="Motivo da anulação"
          minimo={5}
          confirmar="Anular termo"
          perigo
          aoFechar={() => setModal(null)}
          aoEnviar={(motivo) => api.post(`/envelopes/${modal.documento.envelope!.id}/cancelar`, { motivo }).then(atualizar)}
        />
      )}
      {modal?.tipo === 'cliente' && (
        <ModalCliente unidadeId={unidade.id} atual={unidade.clienteId} aoFechar={() => setModal(null)} aoSalvar={atualizar} />
      )}
    </>
  );
}

function Passo({ titulo, texto, children }: { titulo: string; texto?: string; children?: ReactNode }) {
  return (
    <div className="passo">
      <h2>{titulo}</h2>
      {texto && <p className="suave">{texto}</p>}
      {children && <div className="passo-acoes">{children}</div>}
    </div>
  );
}

function AcoesAgendamento({ ag, abrir }: { ag: Agendamento; abrir: (m: ModalAberto) => void }) {
  if (!ag.podeCancelar) return null;
  return (
    <div className="acoes-secundarias">
      <button type="button" className="link" onClick={() => abrir({ tipo: 'propor', reagendar: ag })}>
        Reagendar
      </button>
      <button type="button" className="link link-perigo" onClick={() => abrir({ tipo: 'cancelarAgendamento', agendamento: ag })}>
        Cancelar agendamento
      </button>
    </div>
  );
}

function LinkCliente({ rotulo, caminho }: { rotulo: string; caminho: string }) {
  const [copiado, setCopiado] = useState(false);
  const url = `${window.location.origin}${caminho}`;
  return (
    <div className="link-cliente">
      <span className="etiqueta">{rotulo}</span>
      <div className="link-cliente-linha">
        <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={rotulo} />
        <button
          type="button"
          className="botao"
          onClick={async () => {
            await navigator.clipboard?.writeText(url).catch(() => undefined);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 2000);
          }}
        >
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </div>
  );
}

function Termo({ d, abrir, aoMudar }: { d: Documento; abrir: (m: ModalAberto) => void; aoMudar: () => void }) {
  const [erro, setErro] = useState('');
  const env = d.envelope;
  const pdf = (versao: string) => abrirPdf(`/documentos/${d.id}/pdf?versao=${versao}`).catch((e) => setErro(mensagemDeErro(e)));
  const rsf = (acao: 'reenviar' | 'sincronizar') =>
    api
      .post(`/envelopes/${env!.id}/${acao}`)
      .then(aoMudar)
      .catch((e) => setErro(mensagemDeErro(e)));
  const tomEnvelope = { PENDENTE: 'atencao', CONCLUIDO: 'ok', RECUSADO: 'perigo', CANCELADO: 'neutro' } as const;
  const rotuloEnvelope = { PENDENTE: 'Aguardando assinaturas', CONCLUIDO: 'Assinado', RECUSADO: 'Recusado', CANCELADO: 'Anulado' };

  return (
    <article className="termo">
      <header className="termo-topo">
        <div>
          <strong>{d.titulo}</strong>
          <span className="mono">
            {d.protocolo} · etapa {ordemDaEtapa(d.etapa)} · emitido em {dataHora(d.criadoEm)}
          </span>
        </div>
        {env && <Pill tom={tomEnvelope[env.status]}>{rotuloEnvelope[env.status]}</Pill>}
      </header>
      <Erro>{erro}</Erro>

      {env && (
        <ul className="signatarios">
          {env.signatarios.map((s) => (
            <li key={s.id}>
              <div>
                <span className="etiqueta">{PARTE[s.parte]}</span>
                <strong>{s.nome}</strong>
                <span className="suave">
                  {s.status === 'ASSINADO'
                    ? `Assinou em ${dataHora(s.assinadoEm)}${s.metodo ? ` · ${METODO[s.metodo] ?? s.metodo}` : ''}`
                    : s.status === 'RECUSADO'
                      ? `Recusou: ${s.motivoRecusa}`
                      : env.status === 'PENDENTE'
                        ? 'Assinatura pendente'
                        : 'Não assinou'}
                </span>
              </div>
              <div className="signatario-acoes">
                {s.podeAssinar && (
                  <>
                    <button type="button" className="botao botao-primario" onClick={() => abrir({ tipo: 'assinar', signatario: s, documento: d })}>
                      Assinar
                    </button>
                    <button type="button" className="link link-perigo" onClick={() => abrir({ tipo: 'recusar', signatario: s, documento: d })}>
                      Recusar
                    </button>
                  </>
                )}
                {s.status === 'PENDENTE' && s.urlAssinatura && env.status === 'PENDENTE' && (
                  <a className="botao" href={s.urlAssinatura} target="_blank" rel="noreferrer">
                    Assinar no rsf-signer
                  </a>
                )}
              </div>
              {s.token && env.status === 'PENDENTE' && (
                <LinkCliente rotulo="Link de assinatura do cliente" caminho={`/assinar/${s.token}`} />
              )}
            </li>
          ))}
        </ul>
      )}

      <footer className="termo-pe">
        <button type="button" className="botao" onClick={() => pdf('original')}>
          Abrir termo (PDF)
        </button>
        {d.assinado && (
          <button type="button" className="botao" onClick={() => pdf('assinado')}>
            Abrir termo assinado
          </button>
        )}
        {env?.provedor === 'RSF_SIGNER' && env.status === 'PENDENTE' && (
          <>
            <button type="button" className="link" onClick={() => rsf('sincronizar')}>
              Atualizar situação no rsf-signer
            </button>
            {env.signatarios.every((s) => !s.urlAssinatura) && (
              <button type="button" className="link" onClick={() => rsf('reenviar')}>
                Reenviar ao rsf-signer
              </button>
            )}
          </>
        )}
        {env?.status === 'PENDENTE' && (
          <button type="button" className="link link-perigo" onClick={() => abrir({ tipo: 'anular', documento: d })}>
            Anular termo
          </button>
        )}
      </footer>
      <p className="hash">
        SHA-256 <span className="mono">{d.sha256Assinado ?? d.sha256}</span>
      </p>
    </article>
  );
}

function ModalTexto({
  titulo,
  descricao,
  rotulo,
  minimo = 0,
  confirmar,
  perigo = false,
  aoFechar,
  aoEnviar,
}: {
  titulo: string;
  descricao?: string;
  rotulo: string;
  minimo?: number;
  confirmar: string;
  perigo?: boolean;
  aoFechar: () => void;
  aoEnviar: (texto: string) => Promise<unknown>;
}) {
  const [texto, setTexto] = useState('');
  const { enviando, erro, executar } = useAcao();
  return (
    <Modal titulo={titulo} aoFechar={aoFechar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          executar(() => aoEnviar(texto.trim()));
        }}
      >
        {descricao && <p className="suave">{descricao}</p>}
        <Erro>{erro}</Erro>
        <label className="campo">
          <span>{rotulo}</span>
          <textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} required={minimo > 0} minLength={minimo || undefined} autoFocus />
        </label>
        <footer className="modal-pe">
          <button type="button" className="botao" onClick={aoFechar}>
            Voltar
          </button>
          <button className={`botao ${perigo ? 'botao-perigo' : 'botao-primario'}`} disabled={enviando}>
            {enviando ? 'Enviando…' : confirmar}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ModalHorarios({
  unidadeId,
  reagendar,
  aoFechar,
  aoSalvar,
}: {
  unidadeId: string;
  reagendar?: Agendamento;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [opcoes, setOpcoes] = useState(['', '']);
  const [local, setLocal] = useState(reagendar?.local ?? '');
  const [observacao, setObservacao] = useState('');
  const [motivo, setMotivo] = useState('');
  const { enviando, erro, executar } = useAcao();
  const agora = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo = {
      opcoes: opcoes.filter(Boolean).map((o) => new Date(o).toISOString()),
      local: local || undefined,
      observacao: observacao || undefined,
    };
    const ok = await executar(() =>
      reagendar
        ? api.post(`/agendamentos/${reagendar.id}/reagendar`, { ...corpo, motivo })
        : api.post(`/unidades/${unidadeId}/agendamentos`, corpo),
    );
    if (ok) aoSalvar();
  }

  return (
    <Modal titulo={reagendar ? 'Reagendar vistoria' : 'Oferecer horários'} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <Erro>{erro}</Erro>
        {reagendar && (
          <label className="campo">
            <span>Motivo do reagendamento</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={5} autoFocus />
          </label>
        )}
        <fieldset className="grupo">
          <legend>Horários disponíveis</legend>
          {opcoes.map((o, i) => (
            <div key={i} className="linha-opcao">
              <input
                type="datetime-local"
                aria-label={`Opção ${i + 1}`}
                min={agora}
                value={o}
                onChange={(e) => setOpcoes(opcoes.map((x, j) => (j === i ? e.target.value : x)))}
                required={i === 0}
              />
              {opcoes.length > 1 && (
                <button type="button" className="link" onClick={() => setOpcoes(opcoes.filter((_, j) => j !== i))}>
                  Remover
                </button>
              )}
            </div>
          ))}
          {opcoes.length < 6 && (
            <button type="button" className="link" onClick={() => setOpcoes([...opcoes, ''])}>
              + Outro horário
            </button>
          )}
        </fieldset>
        <label className="campo">
          <span>Local / ponto de encontro (opcional)</span>
          <input value={local} onChange={(e) => setLocal(e.target.value)} maxLength={200} />
        </label>
        <label className="campo">
          <span>Observação (opcional)</span>
          <input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={1000} />
        </label>
        <footer className="modal-pe">
          <button type="button" className="botao" onClick={aoFechar}>
            Voltar
          </button>
          <button className="botao botao-primario" disabled={enviando}>
            {enviando ? 'Enviando…' : 'Oferecer horários'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ModalAssinar({
  documento,
  signatario,
  aoFechar,
  aoAssinar,
}: {
  documento: Documento;
  signatario: Signatario;
  aoFechar: () => void;
  aoAssinar: () => void;
}) {
  const [senha, setSenha] = useState('');
  const [rubrica, setRubrica] = useState<string | null>(null);
  const [li, setLi] = useState(false);
  const { enviando, erro, executar } = useAcao();

  async function assinar(e: FormEvent) {
    e.preventDefault();
    const ok = await executar(async () => {
      const localizacao = await obterLocalizacao();
      await api.post(`/signatarios/${signatario.id}/assinar`, {
        senha,
        assinaturaImagem: rubrica ?? undefined,
        localizacao: localizacao ?? undefined,
      });
    });
    if (ok) aoAssinar();
  }

  return (
    <Modal titulo={`Assinar pela ${PARTE[signatario.parte]}`} aoFechar={aoFechar}>
      <form onSubmit={assinar}>
        <p>
          <strong>{documento.titulo}</strong>
          <br />
          <span className="mono">{documento.protocolo}</span>
        </p>
        <button
          type="button"
          className="botao"
          onClick={() => abrirPdf(`/documentos/${documento.id}/pdf`).catch(() => undefined)}
        >
          Ler o termo antes de assinar
        </button>
        <Erro>{erro}</Erro>
        <div className="campo">
          <span>Rubrica (opcional)</span>
          <CampoAssinatura aoMudar={setRubrica} />
        </div>
        <label className="campo">
          <span>Confirme a sua senha</span>
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
          <small className="suave">A senha é conferida de novo para comprovar que é você quem está assinando.</small>
        </label>
        <label className="marcar">
          <input type="checkbox" checked={li} onChange={(e) => setLi(e.target.checked)} required />
          <span>Li o termo e concordo com o seu conteúdo.</span>
        </label>
        <p className="suave">
          Ficam registrados a data e a hora, o IP, o navegador e, se você permitir, a localização do aparelho.
        </p>
        <footer className="modal-pe">
          <button type="button" className="botao" onClick={aoFechar}>
            Voltar
          </button>
          <button className="botao botao-primario" disabled={enviando || !li}>
            {enviando ? 'Assinando…' : 'Assinar termo'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function ModalCliente({
  unidadeId,
  atual,
  aoFechar,
  aoSalvar,
}: {
  unidadeId: string;
  atual: string | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const { dados, carregando } = useCarregar<{ id: string; nome: string; cpfCnpj: string }[]>(
    async () => (await api.get('/clientes', { params: termo ? { busca: termo } : {} })).data,
    [termo],
  );
  const { enviando, erro, executar } = useAcao();
  const vincular = async (clienteId: string | null) => {
    if (await executar(() => api.patch(`/unidades/${unidadeId}`, { clienteId }))) aoSalvar();
  };

  return (
    <Modal titulo="Cliente da unidade" aoFechar={aoFechar}>
      <Erro>{erro}</Erro>
      <form
        className="linha-busca"
        onSubmit={(e) => {
          e.preventDefault();
          setTermo(busca.trim());
        }}
      >
        <input type="search" placeholder="Nome ou CPF/CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar cliente" autoFocus />
        <button className="botao">Buscar</button>
      </form>
      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio>
          Nenhum cliente encontrado. Cadastre em <Link to="/cadastros?aba=clientes">Cadastros → Clientes</Link>.
        </Vazio>
      ) : (
        <ul className="lista lista-rolavel">
          {dados.map((c) => (
            <li key={c.id} className="lista-linha">
              <div>
                <strong>{c.nome}</strong>
                <span>{formatarCpfCnpj(c.cpfCnpj)}</span>
              </div>
              {c.id === atual ? (
                <Pill tom="ok">Vinculado</Pill>
              ) : (
                <button type="button" className="botao" disabled={enviando} onClick={() => vincular(c.id)}>
                  Vincular
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <footer className="modal-pe">
        {atual && (
          <button type="button" className="link link-perigo" disabled={enviando} onClick={() => vincular(null)}>
            Desvincular cliente
          </button>
        )}
        <button type="button" className="botao" onClick={aoFechar}>
          Fechar
        </button>
      </footer>
    </Modal>
  );
}
