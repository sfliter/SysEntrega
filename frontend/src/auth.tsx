import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, sessao } from './api';
import type { Usuario } from './tipos';

interface ContextoAuth {
  usuario: Usuario | null;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => void;
}

const AuthContext = createContext<ContextoAuth>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(() => sessao.usuario());

  const entrar = useCallback(async (email: string, senha: string) => {
    const { data } = await api.post('/auth/login', { email, senha });
    sessao.guardar(data.accessToken, data.usuario);
    setUsuario(data.usuario);
  }, []);

  const sair = useCallback(() => {
    sessao.limpar();
    setUsuario(null);
  }, []);

  const valor = useMemo(() => ({ usuario, entrar, sair }), [usuario, entrar, sair]);
  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
