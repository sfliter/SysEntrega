import { useState } from 'react';
import { api } from '../api';
import { dataHora, ordemDaEtapa, PERFIL } from '../fluxo';
import type { EventoHistorico, Perfil } from '../tipos';
import { Carregando, Erro, useCarregar, Vazio } from './Basicos';

// Eventos de detalhe: ficam recolhidos para a linha do tempo mostrar os
// passos do processo, e aparecem inteiros com "Mostrar tudo".
const DETALHE = new Set([
  'VISTORIA_ITEM_AVALIADO',
  'VISTORIA_FOTO_ADICIONADA',
  'VISTORIA_FOTO_REMOVIDA',
  'DOCUMENTO_BAIXADO',
  'CODIGO_ASSINATURA_ENVIADO',
  'CODIGO_ASSINATURA_INCORRETO',
  'ASSINATURA_SENHA_INCORRETA',
  'LINK_ASSINATURA_ENVIADO',
]);

export default function Historico({ unidadeId, versao }: { unidadeId: string; versao: number }) {
  const [tudo, setTudo] = useState(false);
  const { dados, erro, carregando } = useCarregar<EventoHistorico[]>(
    async () => (await api.get(`/unidades/${unidadeId}/historico`)).data,
    [unidadeId, versao],
  );
  if (carregando && !dados) return <Carregando />;
  if (erro) return <Erro>{erro}</Erro>;
  const eventos = (dados ?? []).filter((e) => tudo || !DETALHE.has(e.acao));
  const ocultos = (dados?.length ?? 0) - eventos.length;
  if (!dados?.length) return <Vazio>Nenhum evento registrado.</Vazio>;

  return (
    <>
      <ol className="linha-tempo">
        {[...eventos].reverse().map((e) => (
          <li key={e.seq} className={DETALHE.has(e.acao) ? 'evento evento-detalhe' : 'evento'}>
            <div className="evento-topo">
              <time>{dataHora(e.criadoEm)}</time>
              {e.etapa && <span className="evento-etapa">Etapa {ordemDaEtapa(e.etapa)}</span>}
              <span className="evento-seq">#{e.seq}</span>
            </div>
            <p className="evento-texto">{e.descricao}</p>
            <p className="evento-quem">
              {e.atorNome}
              {e.atorPerfil && ` · ${PERFIL[e.atorPerfil as Perfil] ?? (e.atorPerfil === 'CLIENTE' ? 'Cliente' : e.atorPerfil)}`}
              {e.organizacao && ` · ${e.organizacao}`}
              {e.atorTipo === 'INTEGRACAO' && ' · integração'}
            </p>
            {e.statusNovo && e.statusNovo !== e.statusAnterior && (
              <p className="evento-status">
                {e.statusAnterior ? `${e.statusAnterior}  →  ` : ''}
                <strong>{e.statusNovo}</strong>
              </p>
            )}
          </li>
        ))}
      </ol>
      {(ocultos > 0 || tudo) && (
        <button type="button" className="link" onClick={() => setTudo((v) => !v)}>
          {tudo ? 'Mostrar só os passos principais' : `Mostrar tudo (mais ${ocultos} registros de detalhe)`}
        </button>
      )}
    </>
  );
}
