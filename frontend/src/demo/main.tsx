// Entrada da versão de demonstração (um único arquivo HTML, sem servidor).
import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { api } from '../api';
import { AuthProvider, useAuth } from '../auth';
import '../styles.css';
import './demo.css';
import { Moldura } from './Demo';
import { adaptadorDemo, CONTA_DE_TESTE } from './servidor';

api.defaults.adapter = adaptadorDemo;

// Entra direto com a conta de teste, vendo como Incorporadora: a
// demonstração abre já em uso
function Entrada() {
  const { usuario, entrar, verComo } = useAuth();
  const [pronto, setPronto] = useState(false);
  const entrando = useRef(false);
  useEffect(() => {
    if (usuario || entrando.current) return;
    entrando.current = true;
    setPronto(false);
    void (async () => {
      try {
        await entrar(CONTA_DE_TESTE, 'demo');
        const { data } = await api.get('/auth/perfis-de-teste');
        await verComo(data[0].perfil, data[0].organizacaoId);
      } finally {
        entrando.current = false;
        setPronto(true);
      }
    })();
  }, [usuario, entrar, verComo]);
  if (!usuario || !pronto) return <p className="demo-abrindo">Abrindo a demonstração…</p>;
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
