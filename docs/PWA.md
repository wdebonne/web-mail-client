# PWA & Mode Hors-ligne

Guide technique du fonctionnement PWA et des capacités hors-ligne de WebMail.

## Vue d'ensemble

WebMail est une **Progressive Web App** (PWA) complète qui permet :

- 📱 Installation sur l'écran d'accueil (mobile et desktop)
- 📖 Lecture des emails en mode hors-ligne
- ✏️ Rédaction et mise en file d'attente des emails
- 🔄 Envoi automatique au retour de la connexion
- 💾 Cache local des contacts et calendriers
- 🔔 **Notifications push natives** (Web Push / VAPID) sur Windows, macOS, Android et iOS 16.4+ (PWA installée)

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

## Cache local des dossiers et messages

En complément du cache Workbox (réseau/assets), l'application entretient un **cache applicatif** dans IndexedDB qui pré-charge toute l'arborescence de vos boîtes mail pour rendre l'affichage instantané et permettre la consultation hors-ligne des messages déjà vus.

### Fonctionnement

- Démarré automatiquement ~4 secondes après la connexion (si le réseau est disponible), via [`syncAllCache()`](../client/src/services/cacheService.ts).
- Parcourt chaque **compte mail** → chaque **dossier** (hors `\All` et `\Junk`) :
  1. L'arborescence du compte est stockée dans la store IndexedDB `folders`.
  2. La première page de chaque dossier est récupérée et les messages (sujet, expéditeur, date, snippet, métadonnées pièces jointes) sont stockés dans la store `emails`.
- L'horodatage de la dernière synchro globale est persisté dans la store `meta` (clé `lastSync`).
- Les **corps HTML complets** et les **octets de pièces jointes** ne sont pas pré-téléchargés — ils atterrissent en cache uniquement quand l'utilisateur ouvre le message / télécharge la pièce jointe.

### Synchronisation incrémentale

Pour éviter de retélécharger l'intégralité du cache à chaque rafraîchissement de page, le service conserve une empreinte par dossier (`meta` → clé `folder:<accountId>:<path>`) contenant `syncedAt` + un fingerprint basé sur la liste triée `uid:seen:flagged` des messages.

| Situation                                             | Action côté client                                   |
|-------------------------------------------------------|------------------------------------------------------|
| Dossier synchronisé depuis moins de **10 min**        | Sauté (aucun appel réseau)                           |
| Dossier plus ancien mais **empreinte identique**      | Date rafraîchie, aucune écriture IndexedDB           |
| Dossier plus ancien avec **empreinte différente**     | Messages réécrits dans IndexedDB                     |
| Appel manuel avec `syncAllCache({ force: true })`     | Toutes les fraîcheurs sont ignorées                  |

La parallélisation est bornée à `FOLDER_CONCURRENCY = 4` dossiers simultanés. Le message de fin résume l'activité (*« Cache mis à jour — N actualisé(s), M inchangé(s) »* ou *« Cache déjà à jour »*).

### Hydratation instantanée de la liste

Lors d'un changement de dossier (ou au rechargement de la page), [`MailPage.tsx`](../client/src/pages/MailPage.tsx) lit synchroniquement `offlineDB.getEmails(accountId, folder)` et peuple le store `mailStore` **avant même que la requête réseau ne démarre**. L'utilisateur voit donc instantanément les messages déjà connus ; la requête React Query se déclenche en parallèle et ne fait que rafraîchir la liste si le serveur renvoie autre chose. Trois optimisations s'ajoutent :

- `placeholderData: keepPreviousData` côté React Query — la liste précédente reste affichée pendant le rafraîchissement au lieu de clignoter en état vide ;
- `staleTime: 2 min` — naviguer entre dossiers récemment consultés ne déclenche aucun appel réseau ;
- les identifiants IndexedDB sont **toujours** au format composite `{accountId}-{folder}-{uid}` (côté `MailPage` et `cacheService`) afin d'éviter les collisions inter-dossiers (un même UID peut exister dans Boîte de réception et Brouillons).

### Pagination & chargement complet d'une boîte mail

Le serveur IMAP renvoie 50 messages par page. La liste expose deux contrôles en bas pour naviguer au-delà :

- **Charger plus** — récupère la page suivante et l'ajoute au store via `appendMessages` (déduplication par triplet `_accountId:_folder:uid`, re-tri par date). Les messages sont aussi indexés en IndexedDB pour la recherche hors-ligne.
- **Tout charger** — bascule en mode auto : le client enchaîne les pages jusqu'à ce que tous les messages du dossier soient chargés (plafond de sécurité 500 pages = 25 000 messages). C'est le moyen privilégié pour faire de la **recherche sur plusieurs années** d'historique. Re-cliquer pour interrompre. Le mode est automatiquement désactivé lors d'un changement de compte/dossier/vue. Pour les vues unifiées (Boîte de réception/Envoyés unifiés), le mode pagine de la même façon chaque compte agrégé.

### Indicateur visuel

Un anneau SVG circulaire est affiché dans la barre supérieure, juste à gauche de l'avatar ([`CacheIndicator.tsx`](../client/src/components/CacheIndicator.tsx)). Il reflète en direct :

- l'**état** (repos / en cours / terminé / erreur) via une icône au centre ;
- le **pourcentage** global (nombre de dossiers traités ÷ total) via le remplissage de l'anneau ;
- au clic, un popover détaille l'action courante (`Dossier X — compte Y`), les compteurs `X / Y dossiers`, la date de dernière synchro et propose un bouton **Mettre à jour**.

### Panneau Paramètres → Cache local

[`CacheSettings.tsx`](../client/src/components/CacheSettings.tsx) expose :

- 6 tuiles : e-mails, pièces jointes, dossiers, poids total cache, poids pièces jointes, dernière synchro ;
- la **barre de quota navigateur** (`navigator.storage.estimate()`) — usage / quota disponible ;
- un tableau détaillé par **compte × dossier** listant le nombre de messages en cache ;
- trois actions : **Mettre à jour**, **Réinitialiser & reconstruire** (purge + resync), **Purger le cache** (confirmation en deux clics).

### Store IndexedDB

| Store       | Clé               | Contenu                                          |
|-------------|-------------------|--------------------------------------------------|
| `emails`    | `id` (composé)    | Messages (un par dossier)                        |
| `folders`   | `accountId`       | Arborescence complète du compte                  |
| `contacts`  | `id`              | Contacts synchronisés                            |
| `events`    | `id`              | Événements calendrier                            |
| `outbox`    | auto-increment    | Messages composés hors-ligne en attente d'envoi  |
| `drafts`    | auto-increment    | Brouillons locaux                                |
| `meta`      | clé libre         | `lastSync`, etc.                                 |

La version du schéma est `DB_VERSION = 2` ([`offlineDB.ts`](../client/src/pwa/offlineDB.ts)) — la migration depuis la version 1 est transparente (les stores manquants sont ajoutés).

---

## Service Worker

### Configuration (`client/src/pwa/register.ts`)

Le Service Worker est enregistré au démarrage de l'application via `vite-plugin-pwa` (stratégie **`injectManifest`**) :

```typescript
import { registerSW as vitePwaRegister } from 'virtual:pwa-register';

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
});
```

Le Service Worker lui-même est écrit en TypeScript dans [`client/src/sw.ts`](../client/src/sw.ts) et gère :

- Le **precache Workbox** des assets de build.
- Les stratégies `NetworkFirst` / `StaleWhileRevalidate` pour `/api/mail`, `/api/contacts`, `/api/calendar`.
- La fallback SPA (`index.html`) pour toute navigation hors `/api`.
- Les événements **`push`**, **`notificationclick`** et **`pushsubscriptionchange`** (voir la section [Notifications push natives](#notifications-push-natives) ci-dessous).

### Stratégies de cache (Workbox)

| Ressource | Stratégie | Description |
|-----------|-----------|-------------|
| HTML, JS, CSS | **Precache** | Mis en cache à l'installation |
| Images | **Cache First** | Cache 7 jours, fallback réseau |
| Polices | **Cache First** | Cache 30 jours |
| API GET | **Network First** | Réseau d'abord, fallback cache |
| **`/api/calendar/events*`** | **Network First, sans stockage** | Route dédiée avec `cacheWillUpdate: () => null` — les réponses ne sont jamais persistées afin d'éviter qu'un refetch ne serve une version périmée après une mutation (drag & drop, édition). |
| API POST/PUT/DELETE | **Network Only** | Réseau uniquement (ou queue offline) |

### Configuration Vite PWA (`vite.config.ts`)

```typescript
VitePWA({
  registerType: 'autoUpdate',
  strategies: 'injectManifest',
  srcDir: 'src',
  filename: 'sw.ts',
  injectRegister: false,
  injectManifest: {
    globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
  },
  manifest: {
    name: 'WebMail - Client de messagerie',
    short_name: 'WebMail',
    theme_color: '#0078D4',
    background_color: '#ffffff',
    display: 'standalone',
    orientation: 'any',
    start_url: '/',
    scope: '/',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
})
```

> ⚠️ Le passage de la stratégie `generateSW` (par défaut) à `injectManifest` est **indispensable** pour prendre en charge les événements `push` et `notificationclick` dans un Service Worker personnalisé.

---

## Notifications push natives

Les notifications push s'appuient sur l'API **Web Push** (standard W3C) et un jeu de clés **VAPID**. Elles fonctionnent sur :

| Plateforme | Navigateur | Prérequis |
|-----------|------------|-----------|
| Windows / macOS / Linux (desktop) | Chrome, Edge, Firefox, Brave | Installation PWA recommandée (pas obligatoire) |
| Android | Chrome, Edge, Firefox, Samsung Internet | Installation PWA recommandée |
| **iOS / iPadOS 16.4+** | **Safari uniquement** | **Installation PWA obligatoire** (Partager → Sur l'écran d'accueil) |
| iOS / iPadOS < 16.4 | — | Non pris en charge (limitation Apple) |

### Architecture

```
┌────────────────────┐    subscribe         ┌──────────────────┐
│ Client (navigateur)│ ──────────────────▶ │  /api/push/*     │
│  Service Worker    │                      │  (Express)       │
│  (client/src/sw.ts)│ ◀── notification ─── │  web-push lib    │
└────────────────────┘       (WebPush)      └──────────────────┘
          ▲                                           │
          │                                           ▼
     Navigateur                              PostgreSQL
     système                              push_subscriptions
                                          admin_settings (VAPID)
```

### Clés VAPID

- Générées automatiquement au premier démarrage via `webpush.generateVAPIDKeys()` si `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` ne sont pas définies.
- Stockées dans la table `admin_settings` (clés `vapid_public_key` / `vapid_private_key`), donc **persistantes** entre redémarrages.
- Les variables d'environnement, si définies, prennent le pas sur les valeurs en base.

### Base de données

Table `push_subscriptions` :

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | UUID | Clé primaire |
| `user_id` | UUID FK | Utilisateur propriétaire |
| `endpoint` | TEXT UNIQUE | URL du service push du navigateur |
| `p256dh` | TEXT | Clé publique ECDH du client |
| `auth_key` | TEXT | Secret d'authentification |
| `user_agent` | TEXT | User-Agent au moment de l'inscription |
| `platform` | VARCHAR(50) | `windows` / `mac` / `android` / `ios` / `linux` / `other` |
| `enabled` | BOOLEAN | Souscription active |
| `created_at` / `last_used_at` | TIMESTAMP | Horodatages |

Les abonnements retournant HTTP 404/410 (navigateur désinstallé, permission révoquée, etc.) sont **purgés automatiquement** à la première tentative d'envoi.

### API côté serveur

Toutes les routes nécessitent une authentification (JWT ou session).

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/push/public-key` | Renvoie la clé VAPID publique (nécessaire pour s'abonner côté client) |
| POST | `/api/push/subscribe` | Enregistre / met à jour une souscription |
| POST | `/api/push/unsubscribe` | Supprime une souscription (par `endpoint`) |
| POST | `/api/push/test` | Envoie une notification de test à tous les appareils de l'utilisateur |
| GET | `/api/push/subscriptions` | Liste les appareils actuellement enregistrés |

### API côté client

```typescript
import {
  pushSupported,
  pushPermission,
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPush,
  getExistingSubscription,
  listenForNotificationClicks,
} from './pwa/push';

// Abonnement (demande la permission automatiquement)
await subscribeToPush();

// Test
const deviceCount = await sendTestPush();

// Désabonnement
await unsubscribeFromPush();

// Navigation suite à un clic sur notification
listenForNotificationClicks((url) => navigate(url));
```

### Déclenchement des notifications

#### Nouveaux mails — `newMailPoller`

Le module [`server/src/services/newMailPoller.ts`](../server/src/services/newMailPoller.ts) sonde l'INBOX IMAP de chaque compte mail **dont l'utilisateur possède au moins un abonnement push actif** :

- Intervalle configurable via `NEW_MAIL_POLL_INTERVAL_MS` (défaut 60 s, minimum 30 s).
- Détection incrémentale par UID maximal vu (cache mémoire). Lors du **tout premier passage**, la valeur courante est enregistrée comme baseline — aucune notification rétroactive.
- Pour chaque nouvel UID, une notification contient : **nom de l'expéditeur**, **adresse email du compte**, **objet** et un **aperçu** de 160 caractères.
- Anti-flood : **max 5 notifications** par compte et par cycle.
- Envoi via le helper `notifyWithPush(userId, event, data, pushPayload, mode)` qui combine **WebSocket** (onglet ouvert) et **Web Push** (autres appareils).

#### Rappels de rendez-vous — `calendarReminderPoller`

Le module [`server/src/services/calendarReminderPoller.ts`](../server/src/services/calendarReminderPoller.ts) déclenche une notification push lorsqu'un événement avec `reminder_minutes` (VALARM) approche :

- Intervalle configurable via `CALENDAR_REMINDER_POLL_INTERVAL_MS` (défaut 60 s, minimum 30 s).
- À chaque tick, sélectionne jusqu'à 50 événements remplissant **toutes** les conditions suivantes :
  - `reminder_minutes IS NOT NULL`
  - `reminder_sent_at IS NULL` (jamais notifié)
  - `recurrence_rule IS NULL` (les événements récurrents ne sont pas gérés en v1)
  - `start_date - reminder_minutes` ≤ `NOW()` (le moment du rappel est arrivé)
  - `start_date ≥ NOW() - GRACE` (fenêtre de grâce, par défaut 1 h, configurable via `CALENDAR_REMINDER_GRACE_MS`) — évite de spammer au démarrage du serveur pour des événements anciens.
- Le payload affiche le **titre** précédé de ⏰, la date formatée en français (`mardi 6 mai 14:30`), une indication relative (`dans 15 min`), et le **lieu** s'il est renseigné. Cliquer la notification ouvre `/calendar?event=<id>`.
- Après envoi réussi, `reminder_sent_at` est positionné à `NOW()` pour empêcher les doublons.
- Un **trigger PostgreSQL** (`trg_reset_reminder_sent_at`) remet automatiquement `reminder_sent_at` à `NULL` si l'utilisateur modifie ensuite `start_date` ou `reminder_minutes`, de sorte qu'un rappel reprogrammé refire correctement.

> ⚠️ Limitations actuelles : un seul VALARM par événement (correspond au schéma `reminder_minutes` unique) et pas d'expansion RRULE — les rappels ne sont émis que pour les événements non-récurrents.

### Activer les notifications (utilisateur)

1. Ouvrir **Paramètres** → **Notifications**.
2. Cliquer sur **Activer**.
3. Accepter la demande de permission affichée par le navigateur / l'OS.
4. (Facultatif) Cliquer sur **Envoyer une notification de test** pour vérifier.

Pour **iOS / iPadOS** : l'application doit d'abord être installée (Safari → bouton Partager → **Sur l'écran d'accueil**), puis ouverte depuis l'icône installée. Les notifications push n'y fonctionnent **pas** depuis un onglet Safari classique.

Les **rappels de rendez-vous** s'appuient sur la même souscription : il suffit que les notifications push soient activées et que l'événement ait un rappel configuré (champ *Rappel* du formulaire de création / modification d'un événement → `5 min`, `15 min`, `1 h`, `1 jour`, etc.). Aucun réglage supplémentaire n'est requis.

### Options du payload

Le Service Worker (`client/src/sw.ts`) et le type `PushPayload` (`server/src/services/push.ts`) prennent en charge les propriétés suivantes :

| Propriété | Type | Valeur par défaut | Description |
|-----------|------|-------------------|-------------|
| `title` | `string` | `"WebMail"` | Titre de la notification (obligatoire côté serveur). |
| `body` | `string` | `""` | Corps du message. |
| `icon` | `string` | `/icon-192.png` | Icône principale affichée à côté du texte. |
| `badge` | `string` | `/icon-192.png` | Icône monochrome (Android : barre d'état). |
| `image` | `string` | — | Grande vignette affichée dans la notification (facultatif). |
| `tag` | `string` | — | Regroupe les notifications par sujet (même `tag` = remplacement). |
| `url` | `string` | `/` | URL ouverte au clic (passée via `postMessage`). |
| `renotify` | `boolean` | `true` si `tag` défini | Rejoue le son/bannière même si une notif avec le même `tag` existe déjà. |
| `silent` | `boolean` | `false` | `true` = notification muette (son désactivé). |
| `requireInteraction` | `boolean` | `true` | **La notification reste affichée jusqu'à interaction** (clic ou fermeture). Indispensable sur Windows 11 où les notifications disparaissent sinon après ~5 s. |
| `actions` | `Array<{ action, title, icon? }>` | `[Ouvrir, Ignorer]` | Boutons affichés sous la notification. Windows 11 affiche une bannière plus large quand des actions sont présentes. |
| `vibrate` | `number[]` | `[120, 60, 120]` | Motif de vibration (mobile uniquement). |
| `timestamp` | `number` | `Date.now()` | Horodatage affiché dans le Centre de notifications. |
| `data` | `object` | — | Données libres récupérables dans `notificationclick`. |

> 💡 L'action `"dismiss"` est traitée par le Service Worker comme une simple fermeture : elle **ne focalise pas** la fenêtre et ne déclenche aucune navigation. Toute autre action (ou un clic direct sur la notification) focalise l'onglet et navigue vers `payload.url`.

### Rendu selon la plateforme

| Plateforme | Comportement observé |
|-----------|----------------------|
| **Windows 11** (Chrome / Edge / Vivaldi) | Bannière système dans le Centre de notifications + son, **si** : (1) le flag `enable-system-notifications` du navigateur est activé, (2) les notifications sont autorisées pour le navigateur/PWA dans *Paramètres Windows → Système → Notifications*, (3) le mode *Concentration / Ne pas déranger* est inactif. Sans PWA installée, la notification s'affiche sous le nom du navigateur (ex. « Vivaldi »). Une fois **la PWA installée**, elle apparaît sous son propre nom « WebMail » avec son icône dédiée et des réglages (son, priorité) indépendants. |
| **macOS** | Bandeau ou alerte système selon le style choisi dans *Réglages Système → Notifications*. Style « Alertes » recommandé pour que la notification reste affichée. |
| **Android** | Notification système native, son + vibration (si `vibrate` est défini). |
| **iOS / iPadOS 16.4+** | Notification système native uniquement si la PWA a été installée depuis Safari (Partager → Sur l'écran d'accueil). Les `actions` sont ignorées. |

### Dépannage (Windows / Chromium)

| Symptôme | Cause probable / solution |
|----------|---------------------------|
| Notification petite et « dans la page » | Le navigateur utilise ses notifications internes au lieu du système. Activez `chrome://flags/#enable-system-notifications` (ou `vivaldi://flags/#enable-system-notifications`, `edge://flags/#enable-system-notifications`) puis redémarrez. |
| Pas de son | Dans *Paramètres Windows → Système → Notifications*, ouvrez l'app concernée et activez **« Jouer un son à la réception d'une notification »** et passez la priorité en **Élevée**. Vérifiez aussi que le mode *Concentration* est désactivé. |
| Notification disparaît trop vite | Défaut Windows ~5 s ; corrigé par `requireInteraction: true` (déjà appliqué). Si vous envoyez des notifications personnalisées, incluez `requireInteraction: true`. |
| Notif affichée sous le nom du navigateur | Installez la PWA (Chrome/Edge/Vivaldi : icône ⊕ dans la barre d'adresse ou menu → « Installer WebMail… »). |
| Plusieurs notifs écrasent la précédente sans son | Activer `renotify: true` côté serveur (déjà appliqué automatiquement dès qu'un `tag` est présent). |

### Dépannage push

| Symptôme | Cause probable / solution |
|----------|---------------------------|
| Bouton **Activer** désactivé | Navigateur non compatible (Safari hors PWA sur iOS, anciens navigateurs) |
| Message « Notifications bloquées » | Permission refusée — à ré-autoriser manuellement dans les paramètres du site |
| Inscription réussie mais aucune notification | Vérifier que `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` sont stables (sinon les souscriptions sont invalidées) ; vérifier les logs serveur |
| Notifications reçues en double | Plusieurs onglets ouverts ont chacun une souscription — normal, chaque installation PWA est un appareil distinct |
| `503 Push service non configuré` sur `/public-key` | Le service n'a pas réussi à s'initialiser au boot — consulter les logs pour `Failed to initialize push service` |

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
| **Notifications push natives** | ✅ | ✅ *(réception ; requiert connexion au moment de l'envoi serveur)* |

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

## Synchronisation cloud des préférences

Depuis la version courante, l'application synchronise automatiquement les **personnalisations d'interface** entre tous vos appareils connectés au même compte (PC, téléphone, tablette).

### Que synchronise-t-on ?

Uniquement des **préférences d'affichage et d'organisation** — jamais le contenu des e-mails, des contacts, des calendriers ou des clés cryptographiques. Les clés synchronisées sont la liste blanche partagée avec le système de sauvegarde locale (`BACKUP_KEYS` / `BACKUP_PREFIXES` dans [client/src/utils/backup.ts](../client/src/utils/backup.ts)) :

- Renommages de comptes et de dossiers (`mail.accountDisplayNames`)
- Ordre des comptes et des dossiers (`mail.accountOrder`, `mail.folderOrder`)
- Comptes dépliés et favoris (`mail.expandedAccounts`, `mail.favoriteFolders`)
- Vues unifiées (`mail.unifiedAccounts`)
- Thème clair/sombre (`theme.mode`)
- Signatures, catégories et couleurs (`mail.signatures.v1`, `mail.categories`)
- Préférences de balayage et confirmations (`mail.swipePrefs`, `mail.deleteConfirmEnabled`)
- Chargement automatique de tous les messages (`mail.autoLoadAll`)
- Préférences calendrier et de mise en page

### Comment ça marche ?

La table serveur `user_preferences` (`(user_id, key) → (value, updated_at)`) stocke pour chaque utilisateur la valeur la plus récente de chaque clé. Côté client, le service [client/src/services/prefsSync.ts](../client/src/services/prefsSync.ts) :

1. effectue un **pull** initial juste après la connexion ;
2. compare l'horodatage local et l'horodatage distant pour chaque clé ;
3. **applique** la version distante si elle est strictement plus récente ;
4. **pousse** vers le serveur les clés modifiées localement (debounce 1,5 s après le dernier changement) ;
5. relance un **pull → push** complet toutes les 5 minutes pour capter les modifications faites sur d'autres appareils pendant que l'app reste ouverte ;
6. tente une dernière poussée sur `beforeunload`.

La résolution de conflit est **last-write-wins** sur `updated_at`, appliquée à la fois côté client (avant écriture en localStorage) et côté serveur (avec une clause SQL `WHERE user_preferences.updated_at < EXCLUDED.updated_at` dans le `ON CONFLICT` du `INSERT`).

### Endpoints REST

- `GET /api/settings/preferences` → `{ items: { [key]: { value, updatedAt } } }`
- `PUT /api/settings/preferences` body `{ items: { [key]: { value, updatedAt } } }` → renvoie uniquement les clés effectivement acceptées (les autres avaient un horodatage serveur plus récent et seront récupérées au pull suivant)
- `DELETE /api/settings/preferences/:key`

Limites : 64 KiB par valeur, 500 entrées max par requête PUT, clés filtrées par `/^[a-zA-Z0-9_.\-:]{1,255}$/`.

### Activer / désactiver

Depuis **Paramètres → Sauvegarde → Synchronisation cloud des préférences** :

- interrupteur d'activation (activé par défaut) ;
- bouton **Synchroniser maintenant** pour forcer un cycle complet ;
- horodatage de la dernière synchronisation réussie et message d'erreur le cas échéant.

Désactiver la synchronisation conserve les préférences localement mais arrête tout aller-retour avec le serveur jusqu'à réactivation.
