import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useNetworkStatus } from './hooks/useNetworkStatus';
import { motion, AnimatePresence } from 'motion/react';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import MailPage from './pages/MailPage';
import CalendarPage from './pages/CalendarPage';
import ContactsPage from './pages/ContactsPage';
import SettingsPage from './pages/SettingsPage';
import SecurityPage from './pages/SecurityPage';
import AdminPage from './pages/AdminPage';
import { listenForNotificationClicks } from './pwa/push';

function App() {
  const { user, token, checkAuth, isLoading } = useAuthStore();
  const initTheme = useThemeStore((s) => s.init);
  const isOnline = useNetworkStatus();
  const location = useLocation();
  const navigate = useNavigate();

  // Fetch branding globally (app name + icon urls). Cached forever across the app,
  // other pages (MailPage) read from the same query to compute the dynamic tab title.
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: api.getBranding,
    staleTime: 1000 * 60 * 5,
  });

  // Default document title = app name (overridden by MailPage when a folder is selected).
  useEffect(() => {
    if (!branding) return;
    // Only set the base title if we're not on a page that manages its own title.
    if (!location.pathname.startsWith('/mail')) {
      document.title = branding.app_name;
    }
    // Update favicon <link> hrefs live so admin changes take effect without reload.
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favicon && branding.icons.icon192) favicon.href = branding.icons.icon192;
  }, [branding, location.pathname]);

  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    if (token) {
      checkAuth();
    }
  }, []);

  useEffect(() => {
    listenForNotificationClicks((url) => {
      try {
        const target = new URL(url, window.location.origin);
        navigate(target.pathname + target.search + target.hash);
      } catch {
        navigate('/mail');
      }
    });
  }, [navigate]);

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
              <Route path="/security" element={<SecurityPage />} />
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
