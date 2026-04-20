export function registerSW() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        console.log('SW registered:', registration.scope);

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'activated') {
                // New version available
                if (confirm('Une nouvelle version est disponible. Recharger ?')) {
                  window.location.reload();
                }
              }
            });
          }
        });
      } catch (error) {
        console.error('SW registration failed:', error);
      }
    });
  }
}
