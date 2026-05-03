# Architecture

Vue d'ensemble de l'architecture technique de WebMail.

## Diagramme global

```
┌─────────────────────────────────────────────────────┐
│                    NAVIGATEUR                       │
│  ┌──────────────────────────────────────────────┐   │
│  │           React SPA (PWA)                    │   │
│  │  ┌──────────┐ ┌────────────┐ ┌───────────┐  │   │
│  │  │  Zustand  │ │React Query │ │ IndexedDB │  │   │
│  │  │  Stores   │ │  Cache     │ │  Offline  │  │   │
│  │  └──────────┘ └────────────┘ └───────────┘  │   │
│  │        │             │              │        │   │
│  │        └─────────────┼──────────────┘        │   │
│  │                      │                       │   │
│  │              Service Worker (Workbox)         │   │
│  └──────────────────────┼───────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │ HTTP / WebSocket
┌─────────────────────────┼───────────────────────────┐
│               CONTENEUR APP (Docker)                │
│  ┌──────────────────────┼───────────────────────┐   │
│  │            Express.js (Node 20)              │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌───────────┐   │   │
│  │  │ Auth │ │Routes│ │  WS  │ │  Plugins  │   │   │
│  │  │ JWT  │ │ API  │ │Server│ │  Manager  │   │   │
│  │  └──────┘ └──────┘ └──────┘ └───────────┘   │   │
│  │        │       │                  │          │   │
│  │  ┌──────────────────────────────────────┐    │   │
│  │  │            Services                  │    │   │
│  │  │  ┌────────┐ ┌──────────┐ ┌────────┐  │    │   │
│  │  │  │  Mail  │ │NextCloud │ │O2Switch│  │    │   │
│  │  │  │Service │ │ CalDAV/  │ │ cPanel │  │    │   │
│  │  │  │ImapFlow│ │ CardDAV  │ │ UAPI   │  │    │   │
│  │  │  └────────┘ └──────────┘ └────────┘  │    │   │
│  │  │              ┌────────┐               │    │   │
│  │  │              │ Plugin │               │    │   │
│  │  │              │Executor│               │    │   │
│  │  │              └────────┘               │    │   │
│  │  └──────────────────────────────────────┘    │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────┼───────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────┐
│             CONTENEUR DB (Docker)                   │
│  ┌──────────────────────────────────────────────┐   │
│  │         PostgreSQL 16 Alpine                 │   │
│  │  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │   │
│  │  │  Users   │ │  Mail    │ │  Contacts   │  │   │
│  │  │ Sessions │ │ Accounts │ │  Calendars  │  │   │
│  │  │  Groups  │ │  Outbox  │ │  Events     │  │   │
│  │  └──────────┘ └──────────┘ └─────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
           │                              │
    ┌──────┘                              └──────┐
    ▼                                            ▼
┌─────────────┐                        ┌──────────────┐
│ Serveur IMAP│                        │  NextCloud   │
│ Serveur SMTP│                        │  (optionnel) │
│ (o2switch)  │                        │  CalDAV/     │
└─────────────┘                        │  CardDAV     │
                                       └──────────────┘
           │
    ┌──────┘
    ▼
┌─────────────┐
│  O2Switch   │
│  cPanel API │
│  UAPI v3    │
│  (port 2083)│
└─────────────┘
```

---

## Stack technique

### Frontend

| Technologie | Rôle |
|-------------|------|
| React 18 | Framework UI |
| TypeScript | Typage statique |
| Vite | Build tool & dev server |
| Tailwind CSS | Styles utilitaires (thème Outlook) |
| Zustand | État global (auth, mail, onglets) |
| React Query | Cache serveur & synchronisation |
| Lucide React | Icônes |
| DOMPurify | Sanitisation HTML email |
| date-fns | Manipulation des dates (locale fr) |
| idb | IndexedDB wrapper (PWA offline) |
| Workbox | Service Worker (cache & offline) |

### Backend

| Technologie | Rôle |
|-------------|------|
| Node.js 20 | Runtime |
| Express.js | Framework HTTP |
| TypeScript | Typage statique |
| Drizzle ORM | ORM PostgreSQL |
| ImapFlow | Client IMAP |
| Nodemailer | Client SMTP |
| Mailparser | Parsing des emails |
| ws | Serveur WebSocket |
| web-push | Notifications push natives (VAPID) |
| jsonwebtoken | Tokens JWT |
| bcryptjs | Hachage mots de passe |
| Helmet | Sécurisation HTTP |
| Zod | Validation des entrées |
| Pino | Logging structuré |
| sharp | Traitement d'images |
| multer | Upload de fichiers |

### Infrastructure

| Technologie | Rôle |
|-------------|------|
| Docker | Conteneurisation |
| Docker Compose | Orchestration |
| PostgreSQL 16 | Base de données |
| Nginx / Traefik | Reverse proxy (optionnel) |
| Let's Encrypt | Certificats SSL |

---

## Flux de données

### Envoi d'un email

```
Utilisateur → ComposeModal → API POST /mail/send
                                    │
                        ┌───────────┤
                        │ En ligne  │ Hors-ligne
                        ▼           ▼
                   MailService   IndexedDB (outbox)
                   Nodemailer        │
                        │      Retour réseau
                        ▼           │
                   Serveur SMTP ◄───┘
                        │     POST /mail/outbox/process
                        ▼
                   Email envoyé
                        │
                        ▼
                   WebSocket → Notification UI
```

### Réception d'un email

```
Serveur IMAP ──► MailService (ImapFlow)
                      │
                      ▼
              Parsing (mailparser)
                      │
                      ▼
              Cache PostgreSQL
                      │
                      ▼
              WebSocket notification
                      │
                      ▼
              React Query invalidation
                      │
                      ▼
              UI mise à jour
```

### Notifications push natives (Web Push)

```
newMailPoller (60 s, IMAP)        calendarReminderPoller (60 s, SQL)
          │                                  │
          ▼                                  ▼
  Nouveaux UID détectés          start_date - reminder_minutes ≤ NOW()
          │                                  │
          └────────────┬─────────────────────┘
                       ▼
               notifyWithPush()
                   │         │
                   ▼         ▼
             WebSocket   web-push + VAPID
             (onglet     (Service Worker
              ouvert)    → OS natif)
                   │         │
                   ▼         ▼
               UI live    Notification système
                          (Windows, macOS,
                           Android, iOS PWA)
```

Le poller calendrier marque `reminder_sent_at = NOW()` après envoi pour éviter les doublons ; un trigger PostgreSQL réinitialise ce champ si `start_date` ou `reminder_minutes` est modifié, afin qu'un rappel reprogrammé refire.

#### Personnalisation par plateforme (PC / mobile / tablette)

Le payload Web Push est désormais construit **par-abonnement** : `sendPushToUser(userId, builder)` itère sur tous les `push_subscriptions` actifs de l'utilisateur et appelle `builder({ platform, userAgent })` pour chaque appareil. La fonction `buildPlatformPayload` (`server/src/services/notificationPrefs.ts`) résout la plateforme cible (`desktop` / `mobile` / `tablet`), applique les templates configurés (`{sender}`, `{subject}`, `{appName}`, …), assemble le bon set d'actions (max 2 desktop / 3 mobile-tablette, presets *Outlook : Archiver/Supprimer/Répondre*, *Lecture seule*, *Minimal*, ou personnalisé), choisit le son et la vibration. Cache mémoire 60 s, invalidé à la sauvegarde des préférences (utilisateur ou admin). Voir [docs/PWA.md](docs/PWA.md#personnalisation-par-plateforme-pc--mobile--tablette).

### Auto-enregistrement des expéditeurs

```
Utilisateur ouvre un email
          │
          ▼
   MessageView.tsx
          │
   useEffect (on message open)
          │
          ▼
   api.recordSender(from.address, from.name)
          │
          ▼
   POST /api/contacts/senders/record
          │
          ├─ Contact n'existe pas : CREATE avec source='sender'
          ├─ Contact existe (source='sender') : UPDATE name
          └─ Contact existe (source='local') : SKIP silencieusement
          │
          ▼
   PostgreSQL contacts table
          │
          ▼
   React Query cache invalidated
          │
          ▼
   Autocomplete met à jour sa liste
   (contact disponible dans le composeur)
```

### Promotion d'expéditeur en contact permanent

```
Utilisateur → ContactsPage
          │
          ▼
   Clic "Enregistrer" (promote button)
          │
          ▼
   promoteMutation.mutate(contactId)
          │
          ▼
   POST /api/contacts/:id/promote
          │
          ├─ Vérifier source='sender'
          │
          ▼
   UPDATE contacts SET source='local'
          │
          ▼
   React Query refetch
          │
          ▼
   Contact disparaît de "Expéditeurs"
   Contact apparaît dans contacts normaux
```

### Synchronisation NextCloud

```
NextCloud ◄──── CardDAV/CalDAV ────► Backend
    │                                    │
    ▼                                    ▼
Contacts/Calendriers              PostgreSQL
Photos de profil                  (cache local)
    │                                    │
    └────────────────┬───────────────────┘
                     ▼
               API REST
                     │
                     ▼
               Frontend
```

---

## Schéma de la base de données

### Tables principales

```
users
├── id (UUID, PK)
├── email (unique)
├── password_hash
├── display_name
├── role (admin|user)
├── settings (JSONB)
└── created_at / updated_at

mail_accounts
├── id (UUID, PK)
├── user_id (FK → users)
├── name, email, username
├── password_encrypted (AES-256-GCM)
├── imap_host, imap_port, imap_secure
├── smtp_host, smtp_port, smtp_secure
├── signature, color
└── is_default

contacts
├── id (UUID, PK)
├── user_id (FK → users)
├── first_name, last_name, email
├── phone, company, job_title
├── department, notes
├── photo_url, nextcloud_id
├── source (local|sender|nextcloud)
└── created_at / updated_at

calendars
├── id (UUID, PK)
├── user_id (FK → users)
├── name, color
├── is_default, is_shared
└── nextcloud_url

calendar_events
├── id (UUID, PK)
├── calendar_id (FK → calendars)
├── title, description
├── start_date, end_date
├── all_day, location
├── attendees (JSONB)
└── recurrence
```

### Tables de support

```
groups                    plugins
├── id (UUID, PK)         ├── id (UUID, PK)
├── name                  ├── name (unique)
├── color                 ├── display_name
└── members (JSONB)       ├── config (JSONB)
                          └── is_active

contact_groups            plugin_assignments
├── contact_id (FK)       ├── plugin_id (FK)
└── group_id (FK)         ├── target_type (user|group)
                          └── target_id (UUID)

outbox                    cached_emails
├── id (UUID, PK)         ├── id (UUID, PK)
├── user_id (FK)          ├── account_id (FK)
├── account_id (FK)       ├── folder, uid
├── data (JSONB)          ├── headers (JSONB)
├── status                └── cached_at
└── created_at

sessions                  admin_settings
├── sid (PK)              ├── key (PK)
├── sess (JSONB)          └── value (JSONB)
└── expire

admin_logs                o2switch_accounts
├── id (UUID, PK)         ├── id (UUID, PK)
├── user_id (FK)          ├── hostname
├── action                ├── username
├── category              ├── api_token_encrypted
├── target_type           ├── label
├── target_id             ├── is_active
├── details (JSONB)       ├── last_sync
├── ip_address            └── created_at / updated_at
├── user_agent
└── created_at            o2switch_email_links
                          ├── id (UUID, PK)
                          ├── o2switch_account_id (FK)
                          ├── remote_email
                          ├── mail_account_id (FK, nullable)
                          ├── auto_synced
                          └── created_at

mail_templates                       mail_template_shares
├── id (UUID, PK)                    ├── id (UUID, PK)
├── owner_user_id (FK, nullable)     ├── template_id (FK → mail_templates)
├── name, subject, body_html         ├── user_id (FK, nullable)  ─┐ XOR
├── is_global (bool)                 ├── group_id (FK, nullable) ─┘
├── created_at / updated_at          └── created_at
└── CHECK (is_global XOR owner)
```

---

## Sécurité

### Couches de protection

```
Client          →  DOMPurify (sanitisation HTML)
                →  Validation Zod côté client

Transport       →  HTTPS (TLS 1.2+)
                →  WebSocket Secure (WSS)

Serveur         →  Helmet (en-têtes sécurisés)
                →  CORS (origines restreintes)
                →  Rate limiting
                →  Validation Zod côté serveur
                →  sanitize-html
                →  Requêtes paramétrées (SQL injection)

Auth            →  bcryptjs (hachage)
                →  JWT signé (tokens)
                →  Sessions PostgreSQL (révocation)

Données         →  AES-256-GCM (mots de passe mail)
                →  Variables d'environnement (secrets)

Infrastructure  →  Réseau Docker isolé
                →  PostgreSQL non exposé
                →  Multi-stage build (surface réduite)
```

---

## PWA & Mode hors-ligne

### Stratégie de cache

| Ressource | Stratégie | Durée |
|-----------|-----------|-------|
| Assets statiques (JS, CSS) | Cache First | 30 jours |
| Images | Cache First | 7 jours |
| API (lectures) | Network First | Fallback cache |
| API (écritures) | Network Only | Queue si offline |

### IndexedDB (stockage local)

| Store | Contenu | Synchronisation |
|-------|---------|-----------------|
| `emails` | Messages mis en cache | Pull au chargement |
| `outbox` | Emails en attente d'envoi | Push au retour réseau |
| `contacts` | Contacts en cache | Pull au chargement |
| `events` | Événements en cache | Pull au chargement |
| `drafts` | Brouillons locaux | Sauvegarde automatique |

---

## Interface utilisateur (Block Layout)

### Disposition en blocs

L'interface suit un **Block Layout** inspiré d'Outlook Web :

```
┌──────────────────────────────────────────────────────┐
│                   Ruban (Ribbon)                     │
│   Classique (2 lignes) ou Simplifié (1 ligne)        │
│   Auto-switch via ResizeObserver (< 700px → simple)  │
├──────┬──────────────┬────────────────────────────────┤
│      │              │                                │
│ Dos- │   Liste      │     Volet de lecture            │
│ siers│   messages   │     (MessageView / Compose)    │
│      │              │                                │
│ ↔    │      ↔       │                                │
│ redi-│  redimen-    │                                │
│ men- │  sionnable   │                                │
│ sion.│              │                                │
│      │              ├────────────────────────────────┤
│      │              │  Barre d'onglets (si ≥ 2 tabs) │
└──────┴──────────────┴────────────────────────────────┘
```

- Chaque bloc : coins arrondis, ombre, marges uniformes (`mx-1.5 mt-1.5 mb-1.5`)
- Fond tertiaire `#E8E6E4` visible dans les espaces entre blocs
- Poignées de redimensionnement intégrées dans les espaces entre blocs

### Ruban (Ribbon)

| Mode | Affichage | Condition |
|------|-----------|-----------|
| **Classique** | Onglets (Accueil/Afficher) + groupes d'icônes sur 2 lignes | Largeur ≥ 700px |
| **Simplifié** | Icônes en ligne unique | Largeur < 700px ou choix utilisateur |

Basculement automatique via `ResizeObserver`. Basculement manuel via chevron ▲/▼.

L'onglet **Afficher** contient :
- Volet Dossiers (afficher/masquer)
- **Disposition** : Volet de lecture (droite / bas / plein écran), Liste mail (auto / colonnes / multi-lignes), Densité (spacieux / confortable / compacte), **Conversations** (menu dédié : regrouper par conversation / par branches / ne pas regrouper, et *afficher tous les messages / uniquement le sélectionné* dans le volet de lecture)
- **Affichage mail** : bascule globale entre *Natif* (largeur de lecture ~820 px centrée à la Outlook desktop) et *Étiré* (toute la largeur du volet). Préférence `mail.displayMode` (clé localStorage), événement `mail-display-mode-changed` propagé en temps réel à toutes les `MessageView` ouvertes. Override par message disponible dans la vue de lecture (state local éphémère, réinitialisé au changement de message).
- **Côte à côte** (Dossiers / Liste / Réponse)
- **Boîtes favoris** (comptes inclus dans les vues unifiées)
- **Paramètres d'onglets** (mode d'ouverture + nombre max)
- Actions sur le message (imprimer, télécharger)
- **Pièce jointe** (comportement : aperçu / téléchargement / menu)
- **Sécurité** : bouton *Confirmer suppr.* / *Suppr. directe* pour activer/désactiver la boîte de dialogue de confirmation avant suppression. Persisté dans `localStorage` (`mail.deleteConfirmEnabled`). Lorsque la confirmation est active, la suppression passe par le composant `ConfirmDialog` et privilégie un déplacement vers le dossier **Corbeille** (détecté via `findTrashFolderPath` — `SPECIAL-USE \Trash`, *Corbeille*, *Deleted Items*, *Éléments supprimés*, etc.) ; la suppression définitive n'intervient que si le message est déjà dans la corbeille ou qu'aucun dossier correspondant n'existe.

### Disposition de la liste et du volet de lecture

Pilotée depuis `client/src/pages/MailPage.tsx`.

| État local | Type | Rôle | Persistance |
|-----------|------|------|-------------|
| `readingPaneMode` | `'right' \| 'bottom' \| 'hidden'` | Position du volet de lecture (à droite, en bas, plein écran) | `localStorage.readingPaneMode` |
| `listHeight` | `number (120–900 px)` | Hauteur de la liste quand le volet est en bas | `localStorage.listHeight` |
| `listDensity` | `'spacious' \| 'comfortable' \| 'compact'` | Hauteur des lignes de la liste | `localStorage.listDensity` |
| `listDisplayMode` | `'auto' \| 'wide' \| 'compact'` | Affichage forcé des lignes (auto = selon largeur) | `localStorage.listDisplayMode` |
| `conversationGrouping` | `'none' \| 'conversation' \| 'branches'` | Mode de regroupement de la liste. `conversation` / `branches` replient chaque fil en une ligne racine avec un chevron de dépliage ; les enfants sont indentés et portent un badge de dossier d'origine (`_folder`) quand la vue est unifiée. Clé de thread : `References[0]` → `In-Reply-To` → `Message-ID` → sujet normalisé. | `localStorage.conversationGrouping` (défaut `none`) |
| `conversationShowAllInReadingPane` | `boolean` | Quand `true`, le volet de lecture affiche tous les messages de la conversation sous forme de pile dépliable ; sinon, seul le message sélectionné est montré. Désactivé quand `conversationGrouping === 'none'`. | `localStorage.conversationShowAllInReadingPane` (défaut `true`) |
| `conversationView` | `boolean` *(dérivé)* | Miroir booléen de `conversationGrouping !== 'none'` maintenu pour compat. | `localStorage.conversationView` |

- Mode **Plein écran** (`hidden`) : la liste occupe toute la largeur ; à la sélection d'un message, la vue de lecture remplace la liste dans le même bloc, avec un bouton **×** pour revenir à la liste (désélection du message).
- Mode **Afficher en bas** (`bottom`) : wrapper `md:flex-col`, poignée `cursor-row-resize` qui pilote `listHeight`. En mode `listDisplayMode === 'auto'`, la liste bascule automatiquement en aperçu multi-lignes pour optimiser la lecture.

### Système d'onglets

| Paramètre | Valeurs | Défaut | Stockage |
|-----------|---------|--------|----------|
| `tabMode` | `drafts-only` \| `all-opened` | `drafts-only` | `localStorage` |
| `maxTabs` | 2–20 | 6 | `localStorage` |

- **`drafts-only`** : seuls les brouillons créent des onglets
- **`all-opened`** : chaque message cliqué ouvre un onglet (le plus ancien inactif est fermé à la limite)
- Barre d'onglets **masquée** quand < 2 onglets

### Vue côte à côte (split view)

Pilotée depuis `client/src/pages/MailPage.tsx`.

| État local | Type | Rôle | Persistance |
|-----------|------|------|-------------|
| `splitTabId` | `string \| null` | Onglet affiché à côté de l'onglet actif | — |
| `splitRatio` | `number (0.15–0.85)` | Largeur relative du panneau gauche | `localStorage.splitRatio` |
| `splitKeepFolderPane` | `boolean` | Conserve le volet Dossiers visible en vue split | `localStorage.splitKeepFolderPane` |
| `splitKeepMessageList` | `boolean` | Conserve la liste des messages visible en vue split | `localStorage.splitKeepMessageList` |
| `splitComposeReply` | `boolean` | Répondre/Transférer ouvre la rédaction à côté du mail d'origine | `localStorage.splitComposeReply` |
| `composeAlongsideMessage` | `Email \| null` | Mail source affiché à gauche pendant la rédaction latérale | — |
| `composeExpanded` | `boolean` | Rédaction plein-largeur (masque tous les volets) | — |

Déclencheurs et interactions :

- **Activation** : clic droit sur un onglet message de la barre du bas → menu contextuel (option *Afficher côte à côte*).
- **Poignée centrale redimensionnable** entre les deux vues (handler `handleSplitResizeStart`), ratio sauvegardé à la fin du drag.
- **Masquage auto** du volet Dossiers et de la liste des messages lorsque `splitActive` ou `splitComposeActive` est vrai, sauf si la bascule correspondante (`splitKeepFolderPane` / `splitKeepMessageList`) est activée.
- **Inversion** via bouton *Inverser les côtés* (onglet Accueil, visible seulement en vue split) : appelle `switchTab(splitTabId)`, un effet dédié inverse alors la paire pour que la vue côte à côte reste affichée.
- **Réponse à côté** : si `splitComposeReply === true`, `handleReply` / `handleForward` mémorisent le message source dans `composeAlongsideMessage` ; le rendu `MailPage` affiche le `MessageView` à gauche et la fenêtre `ComposeModal` à droite (mêmes mécaniques de redimensionnement).

### Volet de dossiers multi-comptes

Module : `client/src/components/mail/FolderPane.tsx` + utilitaires `client/src/utils/mailPreferences.ts`.

| Clé `localStorage` | Type | Rôle |
|---|---|---|
| `mail.accountDisplayNames` | `Record<accountId, string>` | Nom affiché d'un compte (override local) |
| `mail.accountOrder` | `string[]` | Ordre des comptes dans le volet |
| `mail.folderOrder` | `Record<accountId, string[]>` | Ordre personnalisé des dossiers d'un compte |
| `mail.expandedAccounts` | `string[]` | Comptes actuellement développés |
| `mail.favoriteFolders` | `FavoriteFolder[]` | Dossiers épinglés (ordre préservé par glisser-déposer) |
| `mail.unifiedAccounts` | `string[]` | Comptes inclus dans les vues unifiées (vide = tous) |
| `mail.unifiedInboxEnabled` | `boolean` | Affichage de la vue unifiée « Boîte de réception » |
| `mail.unifiedSentEnabled` | `boolean` | Affichage de la vue unifiée « Éléments envoyés » |
| `mail.favoritesExpanded` | `boolean` | État plié/déplié de la section Favoris |

**Clés liées à la sauvegarde & restauration locale** (gérées par `client/src/utils/backup.ts`, **exclues** du contenu exporté) :

| Clé `localStorage` | Type | Rôle |
|---|---|---|
| `backup.auto.enabled` | `boolean` | Active la sauvegarde automatique sur modification locale |
| `backup.auto.filename` | `string` | Nom du fichier unique réécrit en auto-backup (défaut `web-mail-client-backup.json`, extension `.json` imposée) |
| `backup.auto.lastAt` | `ISO date` | Horodatage de la dernière sauvegarde réussie |
| `backup.auto.lastError` | `string` | Dernier message d'erreur (permission refusée, dossier inaccessible…) |
| `backup.auto.dirLabel` | `string` | Libellé du dossier cible (le `FileSystemDirectoryHandle` réel est stocké en IndexedDB) |

Le handle du dossier sélectionné via `showDirectoryPicker()` est persisté dans une base **IndexedDB** dédiée (`web-mail-client-backup` → store `handles` → clé `dir-handle`) car un handle n'est pas sérialisable en `localStorage`. Voir [docs/BACKUP.md](../docs/BACKUP.md) pour le format complet du fichier exporté et la liste exhaustive des clés incluses.

**Périmètre de la sauvegarde locale** :

- ✅ **Inclus** : toutes les clés `localStorage` de la whitelist `BACKUP_KEYS` (signatures avec images en data URI, catégories, ordre/renommage, vues, thème, préférences, `giphyApiKey`, `emoji-panel-recent`…).
- ❌ **Exclu volontairement** :
  - **Contacts, listes de distribution, calendriers** → stockés côté serveur PostgreSQL (+ synchro NextCloud CardDAV/CalDAV), couverts par le dump serveur. Le cache IndexedDB `webmail-offline` est juste une copie reconstructible.
  - **E-mails et brouillons validés** → IMAP.
  - **Clés privées PGP / S/MIME** → IndexedDB `webmail-security` (chiffrement AES-GCM + PBKDF2 310 000 itérations). Export / import dédié depuis la page **Sécurité**, jamais mélangé au `.json` de sauvegarde pour éviter qu'un fichier mal rangé ne contienne du matériel cryptographique sensible.
  - **Token JWT, abonnements Web Push, outbox hors-ligne, `admin_settings`** → spécifiques à l'appareil / à la base serveur.

**Types MIME custom utilisés pour le drag-and-drop :**
- `application/x-mail-message` — déplacement/copie d'un message (`{uid, srcAccountId, srcFolder}`)
- `application/x-mail-folder` — copie cross-compte d'un dossier (`{accountId, path, name}`)
- `application/x-mail-folder-reorder` — réordonnancement ou nest/un-nest dans le même compte
- `application/x-mail-account-reorder` — réordonnancement d'un compte

**Opérations serveur associées (voir [API.md](API.md)) :**
- `POST /api/mail/accounts/:id/folders`, `PATCH`, `DELETE` — CRUD dossiers IMAP avec gestion automatique des souscriptions (`SUBSCRIBE` / `UNSUBSCRIBE`)
- `POST /api/mail/messages/transfer` — move/copy natif ou `FETCH+APPEND` cross-comptes
- `POST /api/mail/folders/copy` — duplication de dossier entre comptes

**Arborescence hiérarchique :**
- Construction d'un arbre parent/enfant à partir du `delimiter` IMAP et du `path` complet
- Indentation proportionnelle à la profondeur
- Détection dynamique du namespace personnel (ex. `INBOX` sur Courier/o2switch) pour préserver le préfixe lors du un-nest

### Favoris et vues unifiées

Section rendue en tête du volet par `FavoritesSection` (dans `FolderPane.tsx`). Deux catégories :

- **Vues unifiées fixes** (non déplaçables) :
  - `unified-inbox` : agrège toutes les INBOX des comptes inclus.
  - `unified-sent` : agrège les dossiers Sent détectés (`findSentFolderPath`) des comptes inclus.
  - L'état `virtualFolder` dans `mailStore` (`'unified-inbox' | 'unified-sent' | null`) active l'agrégation côté `MailPage.tsx`.
  - Les messages agrégés portent des champs `_accountId` / `_folder` (types `Email`). `originOf(msg)` et `originByUid(uid)` routent les mutations (read/flag/delete/move/copy) vers le compte et le dossier d'origine.
- **Dossiers épinglés** (réordonnables par glisser-déposer) :
  - Ajout/retrait via le menu contextuel d'un dossier (« Ajouter/Retirer des favoris »).
  - Ordre persisté dans `mail.favoriteFolders` (tableau `FavoriteFolder[] = { accountId, path }[]`).
  - Réactivité croisée entre `FolderPane` (section Favoris, menu contextuel) et `Ribbon` (menu « Boîtes favoris » de l'onglet Afficher) via une prop `externalPrefsVersion` propagée depuis `MailPage` (`bumpPrefs`).
- **Catégories favorites** (non réordonnables, sous les dossiers épinglés) :
  - Toute catégorie marquée `isFavorite` apparaît automatiquement dans la section Favoris.
  - Clic = active un **filtre unifié multi‑boîtes** : `setCategoryFilter(id)` du `mailStore` bascule `virtualFolder` sur `'unified-inbox'` puis `MailPage` filtre `messages` par catégorie assignée. Re-clic désactive le filtre.

### Catégories de messages

Module : `client/src/utils/categories.ts` + `client/src/components/mail/CategoryModals.tsx`. Modèle 100 % côté client, indépendant des comptes IMAP.

| Clé `localStorage` | Type | Rôle |
|---|---|---|
| `mail.categories` | `MailCategory[]` | Définition des catégories (`{id, name, color, isFavorite}`) |
| `mail.messageCategories` | `Record<messageKey, string[]>` | Liste d'IDs de catégories assignées à chaque message |

**Clé d'assignation (`messageKey`)** :
- Privilégie `mid:${messageId}` (Message-ID RFC 822) — stable entre déplacements et resynchronisations.
- Repli `uid:${accountId}:${folder}:${uid}` quand le Message-ID est absent.

**API du module** : `getCategories`, `setCategories`, `createCategory`, `updateCategory`, `deleteCategory` (cascade nettoyage des assignations), `toggleCategoryFavorite`, `getCategoryById`, `getMessageCategories`, `setMessageCategories`, `toggleMessageCategory`, `clearMessageCategories`, `messageHasAnyCategory`, `subscribeCategories(cb)` (évènement custom + `storage` cross-tab), `categoryRowTint(hex, alpha)`.

**Points d'intégration UI** :
- **Ruban** (`Ribbon.tsx`) — onglet Accueil, modes classique et simplifié : bouton « Catégoriser » (icône `Tag` + chevron) qui ouvre un `CategoryPicker` ancré, ainsi que les actions « Nouvelle catégorie » / « Gérer les catégories ».
- **Liste de mails** (`MessageList.tsx`) : badges « pill » à côté de l'objet (2 visibles + `+N` en wide, 3 en compact), teinte de fond de la ligne via `categoryRowTint(color, 0.18)` (désactivée si la ligne est sélectionnée ou cochée), entrée « Catégoriser » dans le menu contextuel.
- **Page mail** (`MailPage.tsx`) : `handleCategorize(message, id)` appelle `toggleMessageCategory` puis, si la nouvelle assignation n'est pas vide et que le message n'est pas déjà flaggé, déclenche `flagMutation` → le mail catégorisé apparaît dans le groupe **Épinglé** de la liste. `visibleMessages = messages.filter(...)` applique le `categoryFilter` du store.
- **Volet Favoris** : voir section précédente.
- **Modals** : `CategoryEditorModal` (modes `create` / `edit`, layout identique avec étoile favori + palette 24 couleurs), `CategoryManageModal` (liste des catégories avec actions favori / éditer / supprimer + bouton « + Créer »), `CategoryPicker` (popup style Outlook avec recherche, cases à cocher et actions « Nouvelle catégorie » / « Effacer » / « Gérer »).

6 catégories par défaut (`Orange`, `Blue`, `Green`, `Purple`, `Red`, `Yellow`) sont seedées au premier accès.

### Signatures (multiples, style Outlook Web)

Module : `client/src/utils/signatures.ts` + `client/src/components/mail/SignatureModals.tsx`. Modèle 100 % côté client, indépendant des comptes IMAP et de la table serveur `mail_accounts.signature` (les deux peuvent coexister).

| Clé `localStorage` | Type | Rôle |
|---|---|---|
| `mail.signatures.v1` | `MailSignature[]` | Liste des signatures (`{id, name, html, updatedAt}`) |
| `mail.signatures.defaultNew` | `string` | ID de la signature insérée par défaut dans un nouveau message |
| `mail.signatures.defaultReply` | `string` | ID de la signature insérée par défaut dans une réponse / un transfert |
| `mail.signatures.accountDefaultNew.v1` | `Record<accountId, string \| null>` | Override par compte pour les nouveaux messages (`null` = « aucune signature », clé absente = suit le défaut global) |
| `mail.signatures.accountDefaultReply.v1` | `Record<accountId, string \| null>` | Override par compte pour les réponses/transferts (idem) |

**API du module** : `getSignatures`, `getSignatureById`, `upsertSignature`, `deleteSignature` (nettoie les défauts globaux **et** les overrides par compte pointant sur l'ID supprimé), `getDefaultNewId` / `setDefaultNewId`, `getDefaultReplyId` / `setDefaultReplyId`, `getAccountDefaultNewId` / `setAccountDefaultNewId`, `getAccountDefaultReplyId` / `setAccountDefaultReplyId`, **`resolveDefaultNewId(accountId)` / `resolveDefaultReplyId(accountId)`** (override du compte → valeur globale), `wrapSignatureHtml` (enveloppe la signature dans `<div class="outlook-signature" data-signature="true">` précédé d'un `<br>`). Tous les mutateurs émettent un évènement `mail.signatures.changed` sur `window` pour notifier les composants abonnés.

**Points d'intégration UI** :
- **Ruban → Insérer** (`Ribbon.tsx`, `InsererTabContent`) — modes classique et simplifié : bouton **Signature** (icône `PenTool`) ouvrant un menu ancré (`AnchoredPortal`) qui liste les signatures existantes + entrée **Signatures…** pour ouvrir le gestionnaire. La prop `accounts: MailAccount[]` est transmise du composant `Ribbon` principal à `InsererTabContent`, puis au `SignaturesManagerModal` pour activer la section « signature par compte ».
- **Compose** (`ComposeModal.tsx`) : à l'initialisation de l'état `bodyHtml`, la signature est résolue via `resolveDefaultNewId(accountId)` / `resolveDefaultReplyId(accountId)` — l'override du compte actif l'emporte sur la valeur globale. La signature est placée **sous** le corps pour un nouveau message, et **au-dessus** de la citation pour une réponse/transfert, comme Outlook Web.
- **Modals** :
  - `SignaturesManagerModal` — section **Défauts globaux** (deux `<select>`) + section **Signature par compte de messagerie** (un bloc par compte de la prop `accounts`, avec `<select>` *Nouveaux messages* / *Réponses et transferts* proposant `(Valeur par défaut globale)`, `(Aucune signature)` ou l'une des signatures) + liste des signatures avec *Modifier* / *Supprimer* / menu **…** + bouton **+ Ajouter une signature**.
  - `SignatureEditorModal` — onglets *Mettre le texte en forme* / *Insérer*, champ nom, éditeur `contentEditable` (WYSIWYG via `document.execCommand`), cases à cocher pour basculer les défauts à l'enregistrement.

Les signatures et leurs défauts ne sont jamais envoyés au serveur ; ils restent purement locaux à l'appareil.

**Insertion d'images locales** : dans `SignatureEditorModal` comme dans `ComposeModal` / `Ribbon`, le bouton **Image** déclenche un `<input type="file" accept="image/*">` caché plutôt qu'une saisie d'URL. Le fichier choisi est lu via `FileReader.readAsDataURL()` puis inséré inline dans le HTML via `document.execCommand('insertImage', dataUrl)`. Limites : **2 Mo** pour une signature, **5 Mo** pour un message (sinon privilégier une pièce jointe).

**Édition interactive des images insérées** : module partagé `client/src/utils/imageEditing.ts` (`attachImageEditing(editor)`), attaché par un `useEffect` aux éditeurs `contentEditable` du `ComposeModal` et du `SignatureEditorModal`. Un clic sur une `<img>` la sélectionne (contour bleu) et fait apparaître une **barre flottante** (portée dans `document.body`, repositionnée sur `scroll`/`resize` et via un `MutationObserver`) offrant : alignement **gauche** (`float:left`) / **centre** (`display:block; margin:auto`) / **droite** (`float:right`), préréglages de largeur **25 / 50 / 75 / 100 %** (par rapport à la taille naturelle, bridé à la largeur de l'éditeur), **↺ taille d'origine**, **🗑 suppression**. Une **poignée** en bas à droite permet un redimensionnement à la souris en conservant le ratio (`width` en `px`, `height: auto`). `Suppr` / `Retour arrière` supprime l'image ; `Échap` désélectionne. Tous les styles sont écrits directement sur l'élément `<img>` et donc persistés dans le HTML envoyé / sauvegardé.

### Branding & personnalisation (favicon, icônes PWA, titre d'onglet)

Module serveur : `server/src/routes/branding.ts`. Module client : `client/src/pages/AdminPage.tsx` (`BrandingSettings`) + `client/src/App.tsx` + `client/src/pages/MailPage.tsx`.

Les icônes de l'application (favicon + PWA) peuvent être remplacées à chaud par un administrateur **sans rebuild ni redéploiement** :

| Type | Chemin canonique servi | Taille recommandée |
|---|---|---|
| `favicon` | `/favicon.ico` | 32×32 ou 48×48 |
| `icon192` | `/icon-192.png` | 192×192 (PWA Android) |
| `icon512` | `/icon-512.png` | 512×512 (PWA splash / stores) |
| `apple` | `/apple-touch-icon.png` | 180×180 (iOS) |

**Flux** :
1. L'admin téléverse un fichier via `POST /api/admin/branding/:type` (multer, 5 Mo max, filtre MIME sur `image/*`). Le fichier est écrit dans `server/uploads/branding/<filename>`.
2. Un middleware Express (défini dans `server/src/index.ts`) intercepte chaque requête sur `/favicon.ico`, `/icon-192.png`, etc., **avant** `express.static` : si un fichier personnalisé existe dans `uploads/branding/`, il est renvoyé avec `Cache-Control: no-cache`. Sinon la requête retombe sur le bundle frontend (`client/public/*.png`).
3. `DELETE /api/admin/branding/:type` supprime l'upload → l'icône par défaut redevient active.

**Endpoint public `GET /api/branding`** : renvoie `{ app_name, icons, custom }`. Les URLs d'icônes sont suffixées par `?v=<mtime-hash>` pour contourner le cache navigateur lorsqu'un admin remplace l'image. `custom.<type>` indique si un upload personnalisé est actif.

**Mise à jour dynamique du client** :
- `App.tsx` récupère `/api/branding` au montage et met à jour `<link rel="icon">` + `document.title` au vol.
- `MailPage.tsx` définit un titre contextuel **`<NomDossier> — <AppName>`** (style Outlook) via `resolveFolderDisplayName` (exporté par `MessageList.tsx`). Les vues unifiées ajoutent le suffixe *(unifiée)* / *(unifiés)*.

**Clé `admin_settings`** :
- `app_name` — nom de l'application (affiché dans le titre de l'onglet et comme `name` dans le manifeste PWA).

Les icônes par défaut sont bundlées dans `client/public/` (`favicon.ico`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`).

### État des onglets (Zustand `mailStore`)

```
mailStore
├── openTabs: OpenTab[]         # Onglets ouverts
├── activeTabId: string | null  # Onglet actif
├── tabMode: TabMode            # Mode d'ouverture
├── maxTabs: number             # Limite d'onglets
├── virtualFolder: VirtualFolder # null | 'unified-inbox' | 'unified-sent'
├── categoryFilter: string|null # Filtre par catégorie (actif uniquement en vue unifiée)
├── openMessageTab(message)     # Ouvre/active un onglet message
├── openComposeTab(data?)       # Ouvre un onglet brouillon
├── switchTab(tabId)            # Change d'onglet actif
├── closeTab(tabId)             # Ferme un onglet
├── setTabMode(mode)            # Change le mode
├── setMaxTabs(max)             # Change la limite
├── selectVirtualFolder(v)      # Active une vue unifiée
└── setCategoryFilter(id)       # Filtre par catégorie + bascule en vue unifiée
```
