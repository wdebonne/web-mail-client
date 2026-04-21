import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';
import { useEffect } from 'react';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { motion, AnimatePresence } from 'motion/react';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import MailPage from './pages/MailPage';
import CalendarPage from './pages/CalendarPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';

function App() {
  const { user, token, checkAuth, isLoading } = useAuthStore();
  const initTheme = useThemeStore((s) => s.init);
  const isOnline = useNetworkStatus();
  const location = useLocation();

  useEffect(() => {
    initTheme();
  }, [initTheme]);

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
        <motion.div
          initial={{ opacity: 0, y: -30 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -30 }}
          className="offline-banner"
        >
          ⚠ Mode hors-ligne — Les modifications seront synchronisées au retour de la connexion
        </motion.div>
      )}
      <Layout>
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname.split('/')[1]}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="h-full"
          >
            <Routes location={location}>
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
          </motion.div>
        </AnimatePresence>
      </Layout>
    </>
  );
}

export default App;
