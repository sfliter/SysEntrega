// Entrada da versão de demonstração (um único arquivo HTML, sem servidor).
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { api } from '../api';
import { AuthProvider, useAuth } from '../auth';
import '../styles.css';
import './demo.css';
import { Moldura } from './Demo';
import { adaptadorDemo, PERSONAS } from './servidor';

api.defaults.adapter = adaptadorDemo;

// Entra direto com o primeiro perfil: a demonstração abre já em uso
function Entrada() {
  const { usuario, entrar } = useAuth();
  useEffect(() => {
    if (!usuario) void entrar(PERSONAS[0].email, 'demo');
  }, [usuario, entrar]);
  if (!usuario) return <p className="demo-abrindo">Abrindo a demonstração…</p>;
  return (
    <Moldura>
      <App />
    </Moldura>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MemoryRouter>
      <AuthProvider>
        <Entrada />
      </AuthProvider>
    </MemoryRouter>
  </React.StrictMode>,
);
