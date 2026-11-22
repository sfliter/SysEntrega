import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Erro, Marca, useAcao } from '../components/Basicos';

export default function Login() {
  const { entrar } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const { enviando, erro, executar } = useAcao();

  function enviar(e: FormEvent) {
    e.preventDefault();
    executar(() => entrar(email, senha));
  }

  return (
    <div className="entrada">
      <form className="entrada-cartao" onSubmit={enviar}>
        <Marca clara />
        <p className="entrada-sub">Recebimento e entrega de unidades</p>
        <Erro>{erro}</Erro>
        <label className="campo">
          <span>E-mail</span>
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label className="campo">
          <span>Senha</span>
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        <button className="botao botao-primario botao-cheio" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="entrada-pe">
          Recebeu um termo? <Link to="/verificar">Confira a autenticidade</Link>
        </p>
      </form>
    </div>
  );
}
