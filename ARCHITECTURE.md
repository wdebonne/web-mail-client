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
| Zustand | État global (auth, mail) |
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
