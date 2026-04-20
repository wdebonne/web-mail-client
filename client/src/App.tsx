import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useEffect } from 'react';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import MailPage from './pages/MailPage';
import CalendarPage from './pages/CalendarPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';

function App() {
  const { user, token, checkAuth, isLoading } = useAuthStore();
  const isOnline = useNetworkStatus();

  useEffect(() => {
    if (token) {
      checkAuth();
    }
  }, []);

  if (isLoading && token) {
    return (
      <div className="h-full flex items-center justify-center bg-outlook-bg-primary">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-outlook-blue border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-outlook-text-secondary">Chargement...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <>
      {!isOnline && (
        <div className="offline-banner">
          ⚠ Mode hors-ligne — Les modifications seront synchronisées au retour de la connexion
        </div>
      )}
      <Layout>
        <Routes>
          <Route path="/" element={<Navigate to="/mail" replace />} />
          <Route path="/mail" element={<MailPage />} />
          <Route path="/mail/:accountId" element={<MailPage />} />
          <Route path="/mail/:accountId/:folder" element={<MailPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          {user.isAdmin && <Route path="/admin/*" element={<AdminPage />} />}
          <Route path="*" element={<Navigate to="/mail" replace />} />
        </Routes>
      </Layout>
    </>
  );
}

export default App;
