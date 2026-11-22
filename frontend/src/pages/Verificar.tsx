import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { Erro, Marca, Pill, useAcao } from '../components/Basicos';
import { dataHora } from '../fluxo';

interface Resultado {
  protocolo: string;
  titulo: string;
  empreendimento: string;
  unidade: string;
  emitidoEm: string;
  situacao: 'PENDENTE' | 'CONCLUIDO' | 'RECUSADO' | 'CANCELADO' | null;
  concluidoEm: string | null;
  sha256: string;
  sha256Assinado: string | null;
  confere: 'ORIGINAL' | 'ASSINADO' | 'DIFERENTE' | null;
  signatarios: { parte: string; nome: string; status: string; assinadoEm: string | null }[];
}

const SITUACAO = {
  PENDENTE: { rotulo: 'Aguardando assinaturas', tom: 'atencao' },
  CONCLUIDO: { rotulo: 'Assinado por todas as partes', tom: 'ok' },
  RECUSADO: { rotulo: 'Recusado — sem validade', tom: 'perigo' },
  CANCELADO: { rotulo: 'Anulado — sem validade', tom: 'perigo' },
} as const;

async function hashDoArquivo(arquivo: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await arquivo.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Conferência pública: quem recebeu um termo confirma, pelo protocolo, que
// ele existe — e, enviando o arquivo, que não foi alterado. O arquivo não sai
// do aparelho: só o hash dele é comparado.
export default function Verificar() {
  const [params] = useSearchParams();
  const [protocolo, setProtocolo] = useState(params.get('protocolo') ?? '');
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const { enviando, erro, executar } = useAcao();

  async function conferir(e: FormEvent) {
    e.preventDefault();
    setResultado(null);
    await executar(async () => {
      const hash = arquivo ? await hashDoArquivo(arquivo) : undefined;
      const { data } = await api.get(`/publico/verificar/${encodeURIComponent(protocolo.trim())}`, { params: { hash } });
      setResultado(data);
    });
  }

  return (
    <div className="publico">
      <div className="publico-cartao">
        <Marca clara />
        <p className="etiqueta">Conferência de termo</p>
        <h1>O termo que você recebeu é autêntico?</h1>
        <form onSubmit={conferir}>
          <label className="campo">
            <span>Protocolo (está no rodapé do termo)</span>
            <input className="mono" placeholder="SE-2026-XXXXXX" value={protocolo} onChange={(e) => setProtocolo(e.target.value.toUpperCase())} required />
          </label>
          <label className="campo">
            <span>Arquivo PDF do termo (opcional)</span>
            <input type="file" accept="application/pdf" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
            <small className="suave">O arquivo não é enviado: a conferência usa apenas a impressão digital (hash) dele.</small>
          </label>
          <button className="botao botao-primario botao-cheio" disabled={enviando}>
            {enviando ? 'Conferindo…' : 'Conferir'}
          </button>
        </form>
        <Erro>{erro}</Erro>

        {resultado && (
          <div className="verificacao">
            <p>
              <strong>{resultado.titulo}</strong>
              <br />
              {resultado.empreendimento} · unidade {resultado.unidade}
              <br />
              <span className="suave">Emitido em {dataHora(resultado.emitidoEm)}</span>
            </p>
            {resultado.situacao && <Pill tom={SITUACAO[resultado.situacao].tom}>{SITUACAO[resultado.situacao].rotulo}</Pill>}
            {resultado.confere === 'DIFERENTE' && (
              <div className="aviso aviso-perigo" role="status">
                <strong>O arquivo enviado NÃO corresponde ao termo emitido.</strong> Ele foi alterado ou é outro
                documento.
              </div>
            )}
            {(resultado.confere === 'ORIGINAL' || resultado.confere === 'ASSINADO') && (
              <div className="aviso aviso-ok" role="status">
                <strong>O arquivo confere</strong> com {resultado.confere === 'ASSINADO' ? 'o termo assinado' : 'o termo emitido (versão sem a página de assinaturas)'}.
              </div>
            )}
            <ul className="lista">
              {resultado.signatarios.map((s, i) => (
                <li key={i} className="lista-linha">
                  <div>
                    <strong>{s.nome}</strong>
                    <span>{s.parte}</span>
                  </div>
                  <span className="suave">
                    {s.status === 'ASSINADO' ? `assinou em ${dataHora(s.assinadoEm)}` : s.status === 'RECUSADO' ? 'recusou' : 'pendente'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="hash">
              SHA-256 <span className="mono">{resultado.sha256Assinado ?? resultado.sha256}</span>
            </p>
          </div>
        )}
        <p className="entrada-pe">
          <Link to="/login">Acesso ao sistema</Link>
        </p>
      </div>
    </div>
  );
}
