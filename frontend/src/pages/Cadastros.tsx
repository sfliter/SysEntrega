import { useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Carregando, Erro, Modal, Pill, useAcao, useCarregar, Vazio } from '../components/Basicos';
import { ETAPAS, formatarCpfCnpj, ordemDaEtapa, PERFIL } from '../fluxo';
import type { Etapa, Perfil } from '../tipos';
import Torres from './Torres';

type Linha = Record<string, any>;

interface Campo {
  nome: string;
  rotulo: string;
  tipo?: 'texto' | 'email' | 'senha' | 'numero' | 'select' | 'marcar';
  opcoes?: { valor: string; rotulo: string }[];
  obrigatorio?: boolean;
  ajuda?: string;
  // Só aparece ao criar (ex.: nada) ou muda de regra ao editar (ex.: senha)
  opcionalAoEditar?: boolean;
}

interface DefinicaoAba {
  chave: string;
  rotulo: string;
  caminho: string;
  singular: string;
  colunas: { rotulo: string; valor: (l: Linha) => ReactNode }[];
  campos: Campo[];
  podeEditar: boolean;
  inicial?: Linha;
}

const TIPO_ORG: Record<string, string> = {
  CONSTRUTORA: 'Construtora',
  INCORPORADORA: 'Incorporadora',
  CENTRAL_RELACIONAMENTO: 'Central de Relacionamento',
};

const ativo = (l: Linha) => (l.ativo ? <Pill tom="ok">Ativo</Pill> : <Pill tom="neutro">Inativo</Pill>);

export default function Cadastros() {
  const { usuario } = useAuth();
  const [params, setParams] = useSearchParams();
  const perfil = usuario!.perfil;
  const admin = perfil === 'ADMINISTRADOR';
  const orgs = useCarregar<Linha[]>(async () => (await api.get('/organizacoes')).data, []);
  const opcoesOrg = (tipo?: string) =>
    (orgs.dados ?? [])
      .filter((o) => !tipo || o.tipo === tipo)
      .map((o) => ({ valor: o.id, rotulo: tipo ? o.nome : `${o.nome} (${TIPO_ORG[o.tipo]})` }));

  const abas: DefinicaoAba[] = [
    {
      chave: 'empreendimentos',
      rotulo: 'Empreendimentos',
      caminho: '/empreendimentos',
      singular: 'empreendimento',
      podeEditar: admin || perfil === 'INCORPORADORA',
      colunas: [
        { rotulo: 'Código', valor: (l) => <span className="mono">{l.codigo}</span> },
        { rotulo: 'Nome', valor: (l) => <strong>{l.nome}</strong> },
        { rotulo: 'Construtora', valor: (l) => l.construtora?.nome },
        { rotulo: 'Incorporadora', valor: (l) => l.incorporadora?.nome ?? '—' },
        { rotulo: 'Unidades', valor: (l) => l._count?.unidades },
      ],
      campos: [
        { nome: 'codigo', rotulo: 'Código', obrigatorio: true },
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
        { nome: 'endereco', rotulo: 'Endereço' },
        { nome: 'construtoraId', rotulo: 'Construtora', tipo: 'select', opcoes: opcoesOrg('CONSTRUTORA'), obrigatorio: true },
        { nome: 'incorporadoraId', rotulo: 'Incorporadora', tipo: 'select', opcoes: opcoesOrg('INCORPORADORA') },
      ],
    },
    {
      chave: 'clientes',
      rotulo: 'Clientes',
      caminho: '/clientes',
      singular: 'cliente',
      podeEditar: perfil !== 'AUDITOR',
      colunas: [
        { rotulo: 'Nome', valor: (l) => <strong>{l.nome}</strong> },
        { rotulo: 'CPF/CNPJ', valor: (l) => <span className="mono">{formatarCpfCnpj(l.cpfCnpj)}</span> },
        { rotulo: 'E-mail', valor: (l) => l.email ?? '—' },
        { rotulo: 'Telefone', valor: (l) => l.telefone ?? '—' },
        { rotulo: 'Unidades', valor: (l) => l._count?.unidades },
      ],
      campos: [
        { nome: 'nome', rotulo: 'Nome completo', obrigatorio: true },
        { nome: 'cpfCnpj', rotulo: 'CPF ou CNPJ', obrigatorio: true },
        { nome: 'email', rotulo: 'E-mail', tipo: 'email', ajuda: 'É para este e-mail que vai o código de assinatura do termo.' },
        { nome: 'telefone', rotulo: 'Telefone' },
      ],
    },
    {
      chave: 'organizacoes',
      rotulo: 'Organizações',
      caminho: '/organizacoes',
      singular: 'organização',
      podeEditar: admin,
      inicial: { tipo: 'CONSTRUTORA', ativo: true },
      colunas: [
        { rotulo: 'Nome', valor: (l) => <strong>{l.nome}</strong> },
        { rotulo: 'Tipo', valor: (l) => TIPO_ORG[l.tipo] },
        { rotulo: 'CNPJ', valor: (l) => <span className="mono">{formatarCpfCnpj(l.cnpj) || '—'}</span> },
        { rotulo: 'Situação', valor: ativo },
      ],
      campos: [
        { nome: 'nome', rotulo: 'Nome', obrigatorio: true },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'select', obrigatorio: true, opcoes: Object.entries(TIPO_ORG).map(([valor, rotulo]) => ({ valor, rotulo })) },
        { nome: 'cnpj', rotulo: 'CNPJ' },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'marcar' },
      ],
    },
    ...(admin || perfil === 'AUDITOR'
      ? [
          {
            chave: 'usuarios',
            rotulo: 'Usuários',
            caminho: '/usuarios',
            singular: 'usuário',
            podeEditar: admin,
            inicial: { perfil: 'CONSTRUTORA', ativo: true, contaTeste: false },
            colunas: [
              { rotulo: 'Nome', valor: (l: Linha) => <strong>{l.nome}</strong> },
              { rotulo: 'E-mail', valor: (l: Linha) => l.email },
              { rotulo: 'Perfil', valor: (l: Linha) => PERFIL[l.perfil as Perfil] },
              { rotulo: 'Organização', valor: (l: Linha) => l.organizacao?.nome ?? '—' },
              { rotulo: 'Situação', valor: (l: Linha) => (<>{ativo(l)}{l.contaTeste && <> <Pill tom="atencao">Teste</Pill></>}</>) },
            ],
            campos: [
              { nome: 'nome', rotulo: 'Nome completo', obrigatorio: true },
              { nome: 'email', rotulo: 'E-mail', tipo: 'email', obrigatorio: true },
              { nome: 'cpf', rotulo: 'CPF', ajuda: 'Sai no termo, ao lado da assinatura.' },
              { nome: 'perfil', rotulo: 'Perfil', tipo: 'select', obrigatorio: true, opcoes: Object.entries(PERFIL).map(([valor, rotulo]) => ({ valor, rotulo })) },
              { nome: 'organizacaoId', rotulo: 'Organização', tipo: 'select', opcoes: opcoesOrg(), ajuda: 'Obrigatória para a construtora: define quais unidades o usuário vê.' },
              { nome: 'senha', rotulo: 'Senha', tipo: 'senha', obrigatorio: true, opcionalAoEditar: true, ajuda: 'Mínimo de 8 caracteres. Ao editar, deixe em branco para manter a atual.' },
              { nome: 'ativo', rotulo: 'Ativo', tipo: 'marcar' },
              { nome: 'contaTeste', rotulo: 'Conta de teste', tipo: 'marcar', ajuda: 'Pode ver o sistema como qualquer perfil. Só funciona com as contas de teste ligadas no servidor; use em homologação.' },
            ] as Campo[],
          },
        ]
      : []),
    {
      chave: 'pauta',
      rotulo: 'Pauta de vistoria',
      caminho: '/pauta',
      singular: 'item da pauta',
      podeEditar: admin,
      inicial: { etapa: 'CONSTRUTORA_INCORPORADORA', ordem: 0, ativo: true },
      colunas: [
        { rotulo: 'Etapa', valor: (l) => `${ordemDaEtapa(l.etapa as Etapa)}ª` },
        { rotulo: 'Ambiente', valor: (l) => l.ambiente },
        { rotulo: 'Item', valor: (l) => <strong>{l.descricao}</strong> },
        { rotulo: 'Ordem', valor: (l) => l.ordem },
        { rotulo: 'Situação', valor: ativo },
      ],
      campos: [
        { nome: 'etapa', rotulo: 'Etapa', tipo: 'select', obrigatorio: true, opcoes: ETAPAS.map((e) => ({ valor: e.chave, rotulo: `${e.ordem}. ${e.rotulo}` })) },
        { nome: 'ambiente', rotulo: 'Ambiente / grupo', obrigatorio: true },
        { nome: 'descricao', rotulo: 'Item a verificar', obrigatorio: true },
        { nome: 'ordem', rotulo: 'Ordem', tipo: 'numero' },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'marcar', ajuda: 'Itens inativos não entram nas próximas vistorias. As já feitas não mudam.' },
      ],
    },
  ];

  // A primeira aba é a montagem das torres; as demais são cadastros em tabela
  const TORRES = { chave: 'torres', rotulo: 'Torres e unidades' };
  const pedida = params.get('aba') ?? TORRES.chave;
  const aba = abas.find((a) => a.chave === pedida);

  return (
    <>
      <header className="pagina-topo">
        <div>
          <p className="etiqueta">Configuração</p>
          <h1>{aba?.rotulo ?? TORRES.rotulo}</h1>
        </div>
      </header>
      <div className="abas" role="tablist" aria-label="Seções da configuração">
        {[TORRES, ...abas].map((a) => (
          <button
            key={a.chave}
            type="button"
            role="tab"
            aria-selected={a.chave === (aba?.chave ?? TORRES.chave)}
            className={`aba ${a.chave === (aba?.chave ?? TORRES.chave) ? 'ativa' : ''}`}
            onClick={() => setParams({ aba: a.chave }, { replace: true })}
          >
            {a.rotulo}
          </button>
        ))}
      </div>
      {aba ? (
        <Aba key={aba.chave} def={aba} aoMudar={aba.chave === 'organizacoes' ? orgs.recarregar : undefined} />
      ) : (
        <Torres podeEditar={admin || perfil === 'INCORPORADORA'} />
      )}
    </>
  );
}

function Aba({ def, aoMudar }: { def: DefinicaoAba; aoMudar?: () => void }) {
  const { dados, erro, carregando, recarregar } = useCarregar<Linha[]>(async () => (await api.get(def.caminho)).data, [def.caminho]);
  const [editando, setEditando] = useState<Linha | 'novo' | null>(null);

  return (
    <>
      {def.podeEditar && (
        <div className="barra-acoes">
          <button type="button" className="botao botao-primario" onClick={() => setEditando('novo')}>
            Novo {def.singular}
          </button>
        </div>
      )}
      <Erro>{erro}</Erro>
      {carregando && !dados ? (
        <Carregando />
      ) : !dados?.length ? (
        <Vazio>Nada cadastrado ainda.</Vazio>
      ) : (
        <div className="tabela-caixa">
          <table className="tabela">
            <thead>
              <tr>
                {def.colunas.map((c) => (
                  <th key={c.rotulo}>{c.rotulo}</th>
                ))}
                {def.podeEditar && <th />}
              </tr>
            </thead>
            <tbody>
              {dados.map((l) => (
                <tr key={l.id}>
                  {def.colunas.map((c) => (
                    <td key={c.rotulo}>{c.valor(l)}</td>
                  ))}
                  {def.podeEditar && (
                    <td className="direita">
                      <button type="button" className="link" onClick={() => setEditando(l)}>
                        Editar
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editando && (
        <Formulario
          def={def}
          linha={editando === 'novo' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            recarregar();
            aoMudar?.();
          }}
        />
      )}
    </>
  );
}

function Formulario({
  def,
  linha,
  aoFechar,
  aoSalvar,
}: {
  def: DefinicaoAba;
  linha: Linha | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [f, setF] = useState<Linha>(() => {
    const base: Linha = { ...(def.inicial ?? {}) };
    for (const c of def.campos) {
      if (linha && linha[c.nome] !== undefined && linha[c.nome] !== null) base[c.nome] = linha[c.nome];
      else if (base[c.nome] === undefined) base[c.nome] = c.tipo === 'marcar' ? true : '';
    }
    return base;
  });
  const { enviando, erro, executar } = useAcao();

  async function salvar(e: FormEvent) {
    e.preventDefault();
    const corpo: Linha = {};
    for (const c of def.campos) {
      const v = f[c.nome];
      if (c.tipo === 'marcar') corpo[c.nome] = !!v;
      else if (c.tipo === 'numero') corpo[c.nome] = Number(v) || 0;
      else if (v === '' || v === undefined) {
        // Vazio num select opcional = "nenhum"; nos demais, o campo não vai
        if (c.tipo === 'select' && !c.obrigatorio) corpo[c.nome] = null;
      } else corpo[c.nome] = v;
    }
    const ok = await executar(() => (linha ? api.patch(`${def.caminho}/${linha.id}`, corpo) : api.post(def.caminho, corpo)));
    if (ok) aoSalvar();
  }

  return (
    <Modal titulo={`${linha ? 'Editar' : 'Novo'} ${def.singular}`} aoFechar={aoFechar}>
      <form onSubmit={salvar}>
        <Erro>{erro}</Erro>
        {def.campos.map((c) => {
          const obrigatorio = !!c.obrigatorio && !(linha && c.opcionalAoEditar);
          const mudar = (v: unknown) => setF({ ...f, [c.nome]: v });
          if (c.tipo === 'marcar') {
            return (
              <label key={c.nome} className="marcar">
                <input type="checkbox" checked={!!f[c.nome]} onChange={(e) => mudar(e.target.checked)} />
                <span>
                  {c.rotulo}
                  {c.ajuda && <small className="suave"> — {c.ajuda}</small>}
                </span>
              </label>
            );
          }
          return (
            <label key={c.nome} className="campo">
              <span>
                {c.rotulo}
                {!obrigatorio && <i className="suave"> (opcional)</i>}
              </span>
              {c.tipo === 'select' ? (
                <select value={f[c.nome] ?? ''} onChange={(e) => mudar(e.target.value)} required={obrigatorio}>
                  {!obrigatorio && <option value="">Nenhuma</option>}
                  {obrigatorio && !f[c.nome] && <option value="">Selecione…</option>}
                  {c.opcoes?.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={c.tipo === 'senha' ? 'password' : c.tipo === 'email' ? 'email' : c.tipo === 'numero' ? 'number' : 'text'}
                  autoComplete={c.tipo === 'senha' ? 'new-password' : 'off'}
                  value={f[c.nome] ?? ''}
                  onChange={(e) => mudar(e.target.value)}
                  required={obrigatorio}
                />
              )}
              {c.ajuda && <small className="suave">{c.ajuda}</small>}
            </label>
          );
        })}
        <footer className="modal-pe">
          <button type="button" className="botao" onClick={aoFechar}>
            Cancelar
          </button>
          <button className="botao botao-primario" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
