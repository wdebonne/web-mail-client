# WebMail - Client Mail Web (type Outlook)

Client de messagerie web complet avec interface Outlook-like, intégration NextCloud optionnelle, PWA hors-ligne, système de plugins et déploiement Docker.

## Fonctionnalités

### Messagerie
- 📧 Multi-comptes IMAP/SMTP (compatible o2switch / cPanel)
- 📥 Boîte de réception, envoyés, brouillons, corbeille, spam, archives
- 📤 **Sauvegarde automatique dans "Envoyés"** : copie IMAP après envoi SMTP avec détection automatique du dossier
- 🤝 **Envoi "de la part de"** : stratégie d'en-têtes optimisée pour la délivrabilité (Sender/Reply-To selon domaine)
- ⭐ Drapeaux, marquage lu/non-lu, déplacement entre dossiers
- 🏷️ **Catégories de messages (style Outlook)** : création / modification / gestion via le ruban (onglet Accueil), badges colorés et teinte de fond dans la liste, catégorisation = épinglage automatique, catégories favorites accessibles depuis la section **Favoris** comme filtre unifié multi‑boîtes
- 🗃️ **Archivage hiérarchique par date** : le bouton « Archiver » classe automatiquement le message dans `Archives/{année}/{mois}` (ex. `Archives/2026/04 - Avril`) en créant les dossiers manquants. Dossier racine et motif des sous-dossiers configurables par l'administrateur.
- 🖱️ Drag & drop des messages entre dossiers, **y compris entre comptes différents** (Ctrl/Cmd pour copier au lieu de déplacer)
- 🗂️ **Arborescence de dossiers hiérarchique** : sous-dossiers indentés, imbrication/désimbrication par glisser-déposer (déposer au centre d'un dossier = nest, sur l'en-tête du compte = un-nest)
- 📋 **Copie de dossier complet entre comptes** via glisser-déposer ou menu contextuel
- ↕️ **Réordonnancement des comptes et dossiers** par glisser-déposer, persistance locale
- ✏️ **Renommage local des boîtes mail** (clic droit sur un compte) sans impact serveur
- 👥 **Extension simultanée de plusieurs comptes** dans le volet de dossiers
- 🧹 Affichage du nom court des sous-dossiers (ex. `INBOX.test.sous` → « sous ») sans altérer le chemin IMAP réel
- 📎 Pièces jointes avec aperçu avancé (images, PDF, DOCX, XLSX, HEIC/HEIF)
- ℹ️ Aperçu DOCX/XLSX actuellement **simplifié** (contenu prioritaire, fidélité visuelle partielle)
- 🎛️ Comportement d'ouverture des pièces jointes configurable par utilisateur (Aperçu / Téléchargement / Menu)
- ✏️ **Éditeur riche (HTML) type Outlook** avec formatage avancé :
  - Police (Arial, Times, Courier, Georgia, Verdana, etc.) et taille (8px-72px)
  - **Gras**, *Italique*, <u>Souligné</u>, ~~Barré~~
  - Couleur du texte et surlignage (30 couleurs)
  - Alignement (gauche, centré, droite, justifié)
  - Listes à puces et numérotées avec indentation
  - Liens hypertextes et insertion d'images par URL
  - 😀 **Panneau Emojis latéral** (recherche, 8 catégories, récents) ouvert depuis l'onglet Insérer
  - 🎞️ **Panneau GIF latéral** propulsé par **GIPHY** (tendances, stickers, recherche) — voir [docs/CONFIGURATION.md](docs/CONFIGURATION.md#clé-api-giphy)
- 🔄 Synchronisation automatique
- 📝 Signature par compte
- 📱 Interface responsive (navigation mobile adaptative)

### Interface Outlook Web
- 🧱 Disposition en blocs avec marges, coins arrondis et ombres
- 🌓 **Thème clair / sombre / système** : suit automatiquement le thème de l'appareil par défaut, bouton de bascule rapide en haut à droite (clic = swap Clair/Sombre, chevron = menu Système/Clair/Sombre)
- ⭐ **Favoris** : section dédiée en tête du volet dossiers avec
  - Vues unifiées **Boîte de réception** et **Éléments envoyés** agrégeant tous les comptes sélectionnés
  - Épinglage de n'importe quel dossier via menu contextuel
  - **Réorganisation par glisser-déposer** des dossiers épinglés (les vues unifiées restent fixes en haut)
  - Gestion des comptes inclus depuis le bouton **Boîtes favoris** du ruban (onglet Afficher)
- 📑 Système d'onglets multi-messages/brouillons (2 modes : brouillons uniquement / tous les mails ouverts)
- 🔢 Nombre max d'onglets paramétrable (2-20)
- 🪟 **Vue côte à côte** : clic droit sur un onglet → « Afficher côte à côte », deux messages ouverts en parallèle avec poignée centrale redimensionnable (15 %–85 %)
  - Bouton **Inverser les côtés** dans l'onglet Accueil du ruban
  - Personnalisation dans l'onglet Afficher du ruban (garder les Dossiers / la Liste des messages visibles, activer la **Réponse à côté** pour garder le mail d'origine visible pendant la rédaction)
- 💬 **Vue conversation** (optionnelle) : bouton dans l'onglet *Afficher* du ruban. La **vue du mail** affiche alors un bandeau listant tous les messages du fil (reçus + répondus) ; la liste conserve son tri par date et signale simplement les mails faisant partie d'une conversation active via un petit icône. Désactivée par défaut, préférence persistée localement.
- ↩️ **Indicateur « répondu »** dans la liste des mails (icône *Répondre* devant la date) basé sur le flag IMAP `\Answered`.
- 📏 Volet dossiers et liste de messages redimensionnables
- 🗜️ **Rédaction plein-largeur** : bouton Agrandir/Réduire dans l'en-tête du compose pour masquer les volets et donner toute la largeur au brouillon
- 📎 **Glisser-déposer de pièces jointes** directement sur la fenêtre de rédaction (overlay visuel pendant le survol)
- 🎚️ Ruban auto-adaptatif (classique ↔ simplifié selon la largeur)
- �️ **Ruban à onglets** : Accueil, Afficher, **Message** (outils de mise en forme, visible uniquement en rédaction), **Insérer** (pièces jointes, liens, images, tableaux, symboles, emojis, GIF)
- �📋 **Modal de sélection de contacts** : clic sur les champs destinataire pour parcourir le carnet d'adresses

### Contacts
- 👥 Gestion complète des contacts (CRUD)
- 🔍 Recherche par email, nom, prénom, entreprise
- 📋 Groupes de contacts et listes de distribution
- 🔗 Enrichissement depuis NextCloud (photo, fonction, rôle)
- � **Expéditeurs automatiques** : tout expéditeur de mail reçu est enregistré comme "contact non permanent"
- ✅ **Promotion de contact** : conversion d'un expéditeur en contact permanent
- 🔤 **Autocomplétion intelligente** dans le composeur avec affichage des noms (seuil 1 caractère)
- 🎯 **Modal de sélection de contacts** : clic sur "À", "Cc", "Cci" pour ouvrir le carnet d'adresses complet

### Calendrier
- 📅 Vue mois/semaine/jour
- 🎨 Calendriers multiples avec couleurs
- 📤 Calendriers partagés
- 👥 Participants aux événements
- 🔔 Rappels

### PWA & Hors-ligne
- 📱 Application installable (Progressive Web App)
- 📖 Lecture des mails en mode hors-ligne
- ✏️ Rédaction hors-ligne avec envoi automatique au retour de connexion
- 💾 Cache IndexedDB (emails, contacts, calendrier)
- 🔔 **Notifications push natives** (Web Push / VAPID) sur Windows, macOS, Android et iOS 16.4+ (PWA installée), même application fermée — activation depuis Paramètres → Notifications

### Système de Plugins
- 🔌 Architecture extensible
- 🤖 Plugin Ollama AI inclus (résumé, traduction, rédaction)
- ⚙️ Configuration par plugin
- 👥 Attribution par utilisateur ou groupe

### NextCloud (optionnel)
- 📇 Synchronisation CardDAV (contacts)
- 📅 Synchronisation CalDAV (calendriers)
- 🖼️ Photos de profil
- 📋 Listes de distribution
- 📝 Préparation de l'intégration d'un rendu bureautique fidèle via l'écosystème Office de NextCloud (à activer ultérieurement selon l'instance)

### Administration
- � Dashboard temps réel (stats utilisateurs, mails, infra)
- 👤 Gestion des utilisateurs et groupes
- ⚙️ Paramètres globaux
- 🔌 Gestion des plugins
- ☁️ Configuration NextCloud
- 📋 Logs d'audit avec filtrage par catégorie et recherche

### Intégration O2Switch (cPanel)
- 🖥️ Gestion des comptes cPanel via UAPI v3
- 📧 Création / suppression d'emails distants
- 🔗 Liaison emails O2Switch → comptes locaux
- 🔄 Synchronisation automatique des comptes
- 🔒 Tokens API chiffrés AES-256-GCM
- 📊 Consultation des quotas disque

## Documentation

- [API complète](API.md)
- [Configuration](docs/CONFIGURATION.md)
- [Contacts et Expéditeurs](docs/CONTACTS.md)
- [NextCloud](docs/NEXTCLOUD.md)
- [Pièces jointes](docs/ATTACHMENTS.md)
- [PWA et hors-ligne](docs/PWA.md)

## Architecture

```
┌────────────────────────────────────────────────────┐
│                  Navigateur (PWA)                    │
│  React + TypeScript + Tailwind CSS + IndexedDB      │
├────────────────────────────────────────────────────┤
│                API REST + WebSocket                  │
├────────────────────────────────────────────────────┤
│          Express.js + TypeScript Backend             │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐           │
│  │ IMAP/SMTP│ │ CalDAV/  │ │  Plugin   │           │
│  │ imapflow │ │ CardDAV  │ │  System   │           │
│  │nodemailer│ │ NextCloud│ │           │           │
│  └──────────┘ └──────────┘ └───────────┘           │
├────────────────────────────────────────────────────┤
│              PostgreSQL (Drizzle ORM)               │
└────────────────────────────────────────────────────┘
```

## Prérequis

- Docker & Docker Compose
- Git

## Déploiement avec Docker

### 1. Cloner le projet
```bash
git clone <repo-url>
cd webmail
```

### 2. Configurer l'environnement
```bash
cp .env.example .env
# Éditer .env avec vos paramètres
```

Variables importantes :
```env
# Base de données
POSTGRES_PASSWORD=un_mot_de_passe_fort

# Sécurité
SESSION_SECRET=une_clé_secrète_aléatoire
JWT_SECRET=une_autre_clé_secrète
ENCRYPTION_KEY=clé_hex_64_caractères  # openssl rand -hex 32

# NextCloud (optionnel)
NEXTCLOUD_URL=https://cloud.example.com
NEXTCLOUD_USERNAME=admin
NEXTCLOUD_PASSWORD=mot_de_passe
```

### 3. Lancer avec Docker Compose
```bash
docker-compose up -d
```

L'application sera accessible sur `http://localhost:3000`

### 4. Premier utilisateur
Le premier utilisateur inscrit devient automatiquement administrateur.

## Déploiement avec Portainer

1. Dans Portainer, aller dans **Stacks** > **Add Stack**
2. Coller le contenu de `docker-compose.yml`
3. Ajouter les variables d'environnement
4. Cliquer sur **Deploy the stack**

## Développement local

### Installation
```bash
# Backend
cd server
npm install

# Frontend
cd client
npm install
```

### Lancer en développement
```bash
# Depuis la racine
npm run dev
```

Le frontend démarre sur `http://localhost:5173` avec proxy vers le backend sur `http://localhost:3000`.

## Structure du projet

```
webmail/
├── client/                 # Frontend React
│   ├── src/
│   │   ├── api/            # Client API (Axios)
│   │   ├── components/     # Composants React
│   │   │   ├── mail/       # Composants mail
│   │   │   │   ├── ComposeModal.tsx   # Rédaction inline/modale
│   │   │   │   ├── FolderPane.tsx     # Panneau dossiers
│   │   │   │   ├── MessageList.tsx    # Liste des messages
│   │   │   │   ├── MessageView.tsx    # Lecture d'un message
│   │   │   │   └── Ribbon.tsx         # Ruban classique/simplifié
│   │   │   └── ui/         # Composants UI génériques
│   │   ├── hooks/          # Hooks (WebSocket, réseau)
│   │   ├── pages/          # Pages (Mail, Calendar, Contacts, Settings, Admin)
│   │   ├── pwa/            # Service Worker & IndexedDB
│   │   ├── stores/         # Zustand stores (auth, mail + onglets)
│   │   └── types/          # TypeScript types
│   ├── index.html
│   └── vite.config.ts
├── server/                 # Backend Express
│   └── src/
│       ├── database/       # Schéma & connexion PostgreSQL (Drizzle)
│       ├── middleware/      # Auth middleware (JWT + session)
│       ├── plugins/        # Plugin manager
│       ├── routes/         # Routes API REST
│       ├── services/       # Mail, WebSocket, NextCloud, O2Switch
│       └── utils/          # Logger, encryption
├── plugins/                # Plugins
│   └── ollama-ai/          # Plugin IA Ollama
├── docs/                   # Documentation complémentaire
│   ├── CONFIGURATION.md    # Variables d'environnement
│   ├── NEXTCLOUD.md        # Intégration NextCloud
│   ├── ATTACHMENTS.md      # Pièces jointes (aperçu, modes, limites)
│   └── PWA.md              # Mode hors-ligne
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

## API

### Authentification
| Méthode | Route | Description |
|---------|-------|-------------|
| POST | `/api/auth/login` | Connexion |
| POST | `/api/auth/register` | Inscription |
| POST | `/api/auth/logout` | Déconnexion |
| GET | `/api/auth/me` | Utilisateur courant |

### Messagerie
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/accounts` | Lister les comptes |
| GET | `/api/mail/accounts/:id/folders` | Dossiers |
| GET | `/api/mail/accounts/:id/messages` | Messages |
| POST | `/api/mail/send` | Envoyer un email |

### Contacts
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/contacts` | Lister les contacts |
| GET | `/api/contacts/search/autocomplete` | Autocomplétion |
| POST | `/api/contacts` | Créer un contact |

### Calendrier
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/calendar` | Calendriers |
| GET | `/api/calendar/events` | Événements |
| POST | `/api/calendar/events` | Créer un événement |

### Administration étendue
| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/admin/dashboard` | Statistiques système |
| GET | `/api/admin/logs` | Logs d'audit |
| GET | `/api/admin/o2switch/accounts` | Comptes O2Switch |
| POST | `/api/admin/o2switch/accounts` | Ajouter un compte O2Switch |
| POST | `/api/admin/o2switch/accounts/:id/sync` | Synchroniser emails |
| POST | `/api/admin/o2switch/accounts/:id/link` | Lier un email |

## Plugin Ollama AI

Le plugin `ollama-ai` intègre un modèle IA local via Ollama pour :
- **Résumer** un email
- **Suggérer** une réponse
- **Traduire** un texte
- **Améliorer** la rédaction

### Configuration
1. Installer [Ollama](https://ollama.ai)
2. Télécharger un modèle : `ollama pull llama3`
3. Dans Administration > Plugins, configurer l'URL Ollama
4. Attribuer le plugin aux utilisateurs/groupes souhaités

## Compatibilité hébergeurs

Testé avec :
- **o2switch** (IMAP/SMTP via cPanel + UAPI v3 pour la gestion email)
- Tout hébergeur supportant IMAP/SMTP standard

## Sécurité

- Mots de passe mail chiffrés (AES-256-GCM)
- Sessions sécurisées avec JWT
- Sanitisation HTML (DOMPurify)
- Protection CSRF, XSS, injection
- Helmet pour les en-têtes HTTP
- CORS configuré

## Licence

MIT
