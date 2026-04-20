# PWA & Mode Hors-ligne

Guide technique du fonctionnement PWA et des capacités hors-ligne de WebMail.

## Vue d'ensemble

WebMail est une **Progressive Web App** (PWA) complète qui permet :

- 📱 Installation sur l'écran d'accueil (mobile et desktop)
- 📖 Lecture des emails en mode hors-ligne
- ✏️ Rédaction et mise en file d'attente des emails
- 🔄 Envoi automatique au retour de la connexion
- 💾 Cache local des contacts et calendriers

---

## Installation

### Desktop (Chrome, Edge)

1. Accédez à l'application dans le navigateur
2. Cliquez sur l'icône d'installation dans la barre d'adresse
3. Confirmez l'installation

### Mobile (Android)

1. Ouvrez l'application dans Chrome
2. Le navigateur proposera « Ajouter à l'écran d'accueil »
3. Acceptez → l'application sera installée

### Mobile (iOS / Safari)

1. Ouvrez l'application dans Safari
2. Appuyez sur le bouton **Partager** (⬆️)
3. Sélectionnez **Sur l'écran d'accueil**

---

## Service Worker

### Configuration (`client/src/pwa/register.ts`)

Le Service Worker est enregistré au démarrage de l'application :

```typescript
// Enregistrement avec notification de mise à jour
registerSW({
  onNeedRefresh() {
    // Propose à l'utilisateur de recharger
  },
  onOfflineReady() {
    // L'application est prête pour le hors-ligne
  }
});
```

### Stratégies de cache (Workbox)

| Ressource | Stratégie | Description |
|-----------|-----------|-------------|
| HTML, JS, CSS | **Precache** | Mis en cache à l'installation |
| Images | **Cache First** | Cache 7 jours, fallback réseau |
| Polices | **Cache First** | Cache 30 jours |
| API GET | **Network First** | Réseau d'abord, fallback cache |
| API POST/PUT/DELETE | **Network Only** | Réseau uniquement (ou queue offline) |

### Configuration Vite PWA (`vite.config.ts`)

```typescript
VitePWA({
  registerType: 'prompt',
  workbox: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
    runtimeCaching: [
      {
        urlPattern: /^https?:\/\/.*\/api\/.*/,
        handler: 'NetworkFirst',
        options: {
          cacheName: 'api-cache',
          networkTimeoutSeconds: 5
        }
      }
    ]
  },
  manifest: {
    name: 'WebMail',
    short_name: 'WebMail',
    theme_color: '#0078d4',
    background_color: '#f3f2f1',
    display: 'standalone'
  }
})
```

---

## IndexedDB — Stockage hors-ligne

### Architecture (`client/src/pwa/offlineDB.ts`)

L'application utilise **IndexedDB** via la librairie `idb` pour stocker les données localement.

### Stores (tables)

| Store | Contenu | Clé primaire | Index |
|-------|---------|-------------|-------|
| `emails` | Messages mis en cache | `id` (accountId + uid) | `accountId`, `folder`, `date` |
| `outbox` | Emails en attente d'envoi | `id` (auto) | `status`, `createdAt` |
| `contacts` | Contacts en cache | `id` (UUID) | `email`, `name` |
| `events` | Événements calendrier | `id` (UUID) | `calendarId`, `start` |
| `drafts` | Brouillons sauvegardés | `id` (auto) | `updatedAt` |

### Opérations disponibles

```typescript
// Sauvegarder des emails en cache
await offlineDB.cacheEmails(accountId, folder, emails);

// Récupérer les emails en cache
const emails = await offlineDB.getCachedEmails(accountId, folder);

// Ajouter un email à la file d'attente
await offlineDB.addToOutbox(emailData);

// Récupérer les emails en attente
const pending = await offlineDB.getOutboxEmails();

// Marquer un email comme envoyé
await offlineDB.removeFromOutbox(id);

// Recherche dans le cache
const results = await offlineDB.searchOffline(query);
```

---

## Flux hors-ligne

### Lecture des emails

```
1. Utilisateur ouvre l'app (hors-ligne)
2. Service Worker sert l'app depuis le cache
3. React Query tente le réseau → échoue
4. Fallback vers IndexedDB (emails mis en cache)
5. Affichage des emails depuis le cache local
6. Bannière "Hors-ligne" affichée
```

### Rédaction et envoi

```
1. Utilisateur rédige un email (hors-ligne)
2. Clic sur "Envoyer"
3. Détection : navigator.onLine === false
4. Email sauvegardé dans IndexedDB (store outbox)
5. Toast : "Email enregistré, sera envoyé au retour de la connexion"
6. ─── Retour de la connexion ───
7. Événement 'online' détecté
8. POST /api/mail/outbox/process
9. Tous les emails en attente sont envoyés
10. Notifications de succès/échec
```

### Contacts et calendrier

```
1. À chaque chargement en ligne :
   - Contacts sauvegardés dans IndexedDB
   - Événements sauvegardés dans IndexedDB
2. En hors-ligne :
   - Contacts consultables depuis le cache
   - Calendrier consultable depuis le cache
   - Modifications mises en file d'attente
```

---

## Détection réseau

### Hook `useNetworkStatus` (`client/src/hooks/useNetworkStatus.ts`)

```typescript
const { isOnline } = useNetworkStatus();

// isOnline se met à jour automatiquement
// lors des événements 'online' / 'offline' du navigateur
```

### Bannière hors-ligne

L'application affiche une bannière en haut de l'écran lorsque la connexion est perdue :

```
┌─────────────────────────────────────────┐
│ ⚠️ Vous êtes hors-ligne                │
│ Les modifications seront synchronisées  │
│ au retour de la connexion.              │
└─────────────────────────────────────────┘
```

---

## Mise à jour de l'application

### Processus de mise à jour

1. Le Service Worker détecte une nouvelle version
2. La nouvelle version est téléchargée en arrière-plan
3. L'utilisateur voit un toast : **"Mise à jour disponible"**
4. Clic sur **"Recharger"** → application mise à jour

### Forcer la mise à jour

Si nécessaire, la mise à jour peut être forcée en vidant le cache :

```
Chrome : Ctrl+Shift+Delete → Cache → Effacer
Firefox : Ctrl+Shift+Delete → Cache → OK
```

Ou via les DevTools :
1. F12 → Application → Service Workers
2. Cocher **"Update on reload"**
3. Recharger la page

---

## Manifest Web App (`index.html`)

```html
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0078d4">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
```

Le fichier manifest est généré automatiquement par `vite-plugin-pwa` avec :

| Propriété | Valeur |
|-----------|--------|
| `name` | WebMail - Client de messagerie |
| `short_name` | WebMail |
| `theme_color` | `#0078d4` (bleu Outlook) |
| `background_color` | `#f3f2f1` |
| `display` | `standalone` |
| `orientation` | `any` |
| `start_url` | `/` |

---

## Limites du mode hors-ligne

| Fonctionnalité | En ligne | Hors-ligne |
|----------------|----------|------------|
| Lire les emails (cachés) | ✅ | ✅ |
| Lire les emails (nouveaux) | ✅ | ❌ |
| Rédiger un email | ✅ | ✅ |
| Envoyer un email | ✅ | 📤 File d'attente |
| Rechercher (cache) | ✅ | ✅ |
| Rechercher (serveur) | ✅ | ❌ |
| Voir les contacts | ✅ | ✅ (cache) |
| Créer un contact | ✅ | ❌ |
| Voir le calendrier | ✅ | ✅ (cache) |
| Créer un événement | ✅ | ❌ |
| Gérer les pièces jointes | ✅ | ❌ |
| Plugins | ✅ | ❌ |
| Administration | ✅ | ❌ |

---

## Dépannage

### L'app ne s'installe pas

- Vérifiez que HTTPS est activé (requis pour les PWA, sauf localhost)
- Vérifiez la console (F12) pour les erreurs de Service Worker
- Vérifiez que le manifest est accessible : `GET /manifest.webmanifest`

### Les données ne sont pas disponibles hors-ligne

- Assurez-vous d'avoir ouvert les emails au moins une fois (pour le caching)
- Vérifiez l'espace IndexedDB : F12 → Application → IndexedDB
- Le cache se remplit progressivement lors de la navigation

### La file d'attente ne se vide pas

- Vérifiez que l'événement `online` est bien détecté
- Consultez les logs réseau (F12 → Network) au retour de la connexion
- Vérifiez les emails en attente : F12 → Application → IndexedDB → outbox
