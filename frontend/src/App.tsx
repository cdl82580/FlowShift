import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthPage } from './pages/AuthPage';
import { DashboardPage } from './pages/DashboardPage';
import { NewRunPage } from './pages/NewRunPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { RecoverPage } from './pages/RecoverPage';

function isAuthenticated(): boolean {
  try {
    const auth = JSON.parse(localStorage.getItem('flowshift_auth') || '{}');
    return !!(auth.apiKey && auth.userId);
  } catch {
    return false;
  }
}

function Guard({ children }: { children: React.ReactNode }) {
  return isAuthenticated() ? <>{children}</> : <Navigate to="/auth" replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/recover" element={<RecoverPage />} />
        <Route path="/" element={<Guard><DashboardPage /></Guard>} />
        <Route path="/runs/new" element={<Guard><NewRunPage /></Guard>} />
        <Route path="/runs/:id" element={<Guard><RunDetailPage /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
