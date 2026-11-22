import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api, sessao } from './api';
import type { Usuario } from './tipos';

interface ContextoAuth {
  usuario: Usuario | null;
  entrar: (email: string, senha: string) => Promise<void>;
  sair: () => void;
  // Conta de teste: troca o perfil com que vê (e opera) o sistema
  verComo: (perfil: string, organizacaoId: string | null) => Promise<void>;
}

const AuthContext = createContext<ContextoAuth>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(() => sessao.usuario());

  const entrar = useCallback(async (email: string, senha: string) => {
    const { data } = await api.post('/auth/login', { email, senha });
    sessao.guardar(data.accessToken, data.usuario);
    setUsuario(data.usuario);
  }, []);

  const verComo = useCallback(async (perfil: string, organizacaoId: string | null) => {
    const { data } = await api.post('/auth/ver-como', { perfil, organizacaoId });
    sessao.guardar(data.accessToken, data.usuario);
    setUsuario(data.usuario);
  }, []);

  const sair = useCallback(() => {
    sessao.limpar();
    setUsuario(null);
  }, []);

  const valor = useMemo(() => ({ usuario, entrar, sair, verComo }), [usuario, entrar, sair, verComo]);
  return <AuthContext.Provider value={valor}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
