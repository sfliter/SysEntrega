import { useState, type FormEvent } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { PERFIL } from '../fluxo';
import { Erro, Marca, Modal, useAcao } from './Basicos';
import { FaixaConexao, Protecao } from './Conexao';

export default function Layout() {
  const { usuario, sair } = useAuth();
  const [trocando, setTrocando] = useState(false);
  const local = useLocation();
  if (!usuario) return null;
  const perfil = usuario.perfil;
  const itens = [
    { para: '/', rotulo: 'Painel', fim: true },
    { para: '/unidades', rotulo: 'Unidades' },
    { para: '/agenda', rotulo: 'Agenda' },
    ...(perfil !== 'CONSTRUTORA' ? [{ para: '/cadastros', rotulo: 'Cadastros' }] : []),
    ...(perfil === 'ADMINISTRADOR' || perfil === 'AUDITOR'
      ? [{ para: '/auditoria', rotulo: 'Auditoria' }]
      : []),
  ];
  return (
    <div className="casca">
      <aside className="lateral">
        <Marca />
        <nav className="nav" aria-label="Principal">
          {itens.map((i) => (
            <NavLink key={i.para} to={i.para} end={i.fim} className="nav-item">
              {i.rotulo}
            </NavLink>
          ))}
        </nav>
        <div className="lateral-pe">
          <div className="quem">
            <strong>{usuario.nome}</strong>
            <span>
              {PERFIL[perfil]}
              {usuario.organizacaoNome ? ` · ${usuario.organizacaoNome}` : ''}
            </span>
          </div>
          <button type="button" className="link link-claro" onClick={() => setTrocando(true)}>
            Trocar senha
          </button>
          <button type="button" className="botao botao-fantasma-escuro" onClick={sair}>
            Sair
          </button>
        </div>
      </aside>
      <main className="conteudo">
        <FaixaConexao />
        <Protecao key={local.pathname}>
          <Outlet />
        </Protecao>
      </main>
      {trocando && <TrocarSenha aoFechar={() => setTrocando(false)} />}
    </div>
  );
}

function TrocarSenha({ aoFechar }: { aoFechar: () => void }) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [feito, setFeito] = useState(false);
  const { enviando, erro, executar } = useAcao();

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (await executar(() => api.post('/auth/trocar-senha', { senhaAtual: atual, novaSenha: nova }))) setFeito(true);
  }

  return (
    <Modal titulo="Trocar senha" aoFechar={aoFechar}>
      {feito ? (
        <>
          <div className="aviso aviso-ok" role="status">
            Senha alterada.
          </div>
          <footer className="modal-pe">
            <button type="button" className="botao botao-primario" onClick={aoFechar}>
              Fechar
            </button>
          </footer>
        </>
      ) : (
        <form onSubmit={salvar}>
          <Erro>{erro}</Erro>
          <label className="campo">
            <span>Senha atual</span>
            <input type="password" autoComplete="current-password" value={atual} onChange={(e) => setAtual(e.target.value)} required autoFocus />
          </label>
          <label className="campo">
            <span>Nova senha</span>
            <input type="password" autoComplete="new-password" value={nova} onChange={(e) => setNova(e.target.value)} required minLength={8} />
            <small className="suave">Mínimo de 8 caracteres.</small>
          </label>
          <label className="campo">
            <span>Repita a nova senha</span>
            <input type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} required />
            {repetida && repetida !== nova && <small className="suave">As senhas não conferem.</small>}
          </label>
          <footer className="modal-pe">
            <button type="button" className="botao" onClick={aoFechar}>
              Cancelar
            </button>
            <button className="botao botao-primario" disabled={enviando || nova !== repetida}>
              {enviando ? 'Salvando…' : 'Trocar senha'}
            </button>
          </footer>
        </form>
      )}
    </Modal>
  );
}
