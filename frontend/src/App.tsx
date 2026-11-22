import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Agenda from './pages/Agenda';
import AgendarPublico from './pages/AgendarPublico';
import AssinarPublico from './pages/AssinarPublico';
import Auditoria from './pages/Auditoria';
import Cadastros from './pages/Cadastros';
import Login from './pages/Login';
import Painel from './pages/Painel';
import UnidadeDetalhe from './pages/UnidadeDetalhe';
import Unidades from './pages/Unidades';
import Verificar from './pages/Verificar';
import Vistoria from './pages/Vistoria';

export default function App() {
  const { usuario } = useAuth();
  return (
    <Routes>
      {/* Sem login: o cliente final chega por link */}
      <Route path="/agendar/:token" element={<AgendarPublico />} />
      <Route path="/assinar/:token" element={<AssinarPublico />} />
      <Route path="/verificar" element={<Verificar />} />
      <Route path="/login" element={usuario ? <Navigate to="/" replace /> : <Login />} />
      {usuario ? (
        <Route element={<Layout />}>
          <Route path="/" element={<Painel />} />
          <Route path="/unidades" element={<Unidades />} />
          <Route path="/unidades/:id" element={<UnidadeDetalhe />} />
          <Route path="/vistorias/:id" element={<Vistoria />} />
          <Route path="/agenda" element={<Agenda />} />
          <Route path="/cadastros" element={<Cadastros />} />
          <Route path="/auditoria" element={<Auditoria />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}
