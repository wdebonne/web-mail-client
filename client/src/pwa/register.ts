import { registerSW as vitePwaRegister } from 'virtual:pwa-register';

export function registerSW() {
  if (!('serviceWorker' in navigator)) return;

  const updateSW = vitePwaRegister({
    immediate: true,
    onNeedRefresh() {
      if (confirm('Une nouvelle version est disponible. Recharger ?')) {
        updateSW(true);
      }
    },
    onOfflineReady() {
      console.log('Application prête pour le mode hors-ligne');
    },
    onRegisteredSW(swUrl) {
      console.log('SW registered:', swUrl);
    },
    onRegisterError(error) {
      console.error('SW registration failed:', error);
    },
  });
}

