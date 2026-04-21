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
- **Paramètres d'onglets** (mode d'ouverture + nombre max)
- Actions sur le message (imprimer, télécharger)

### Système d'onglets

| Paramètre | Valeurs | Défaut | Stockage |
|-----------|---------|--------|----------|
| `tabMode` | `drafts-only` \| `all-opened` | `drafts-only` | `localStorage` |
| `maxTabs` | 2–20 | 6 | `localStorage` |

- **`drafts-only`** : seuls les brouillons créent des onglets
- **`all-opened`** : chaque message cliqué ouvre un onglet (le plus ancien inactif est fermé à la limite)
- Barre d'onglets **masquée** quand < 2 onglets

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

### État des onglets (Zustand `mailStore`)

```
mailStore
├── openTabs: OpenTab[]         # Onglets ouverts
├── activeTabId: string | null  # Onglet actif
├── tabMode: TabMode            # Mode d'ouverture
├── maxTabs: number             # Limite d'onglets
├── virtualFolder: VirtualFolder # null | 'unified-inbox' | 'unified-sent'
├── openMessageTab(message)     # Ouvre/active un onglet message
├── openComposeTab(data?)       # Ouvre un onglet brouillon
├── switchTab(tabId)            # Change d'onglet actif
├── closeTab(tabId)             # Ferme un onglet
├── setTabMode(mode)            # Change le mode
├── setMaxTabs(max)             # Change la limite
└── selectVirtualFolder(v)      # Active une vue unifiée
```
