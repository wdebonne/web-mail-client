import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import App from './App';
import './index.css';
import { registerSW } from './pwa/register';
import { startAutoBackupWatcher } from './utils/backup';
import enTranslations from './i18n/en.json';
import frTranslations from './i18n/fr.json';

i18n.use(initReactI18next).init({
  resources: {
    en: enTranslations,
    fr: frTranslations,
  },
  lng: (() => {
    try { return localStorage.getItem('user.language') || 'fr'; } catch { return 'fr'; }
  })(),
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              fontFamily: '"Segoe UI", sans-serif',
              fontSize: '14px',
            },
          }}
        />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

// Register service worker for PWA
registerSW();