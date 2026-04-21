# Documentation API

Référence complète de l'API REST de WebMail.

**Base URL** : `http://localhost:3000/api`

## Authentification

L'API utilise deux méthodes d'authentification :
- **Session** : Cookie de session (navigateur web)
- **JWT** : Header `Authorization: Bearer <token>` (PWA, clients API)

---

## Table des matières

- [Auth](#auth)
- [Comptes Mail](#comptes-mail)
- [Messagerie](#messagerie)
- [Contacts](#contacts)
- [Calendrier](#calendrier)
- [Paramètres](#paramètres)
- [Administration](#administration)
- [Dashboard](#dashboard)
- [Logs d'audit](#logs-daudit)
- [O2Switch cPanel](#o2switch-cpanel)
- [Plugins](#plugins)
- [Recherche](#recherche)
- [Codes d'erreur](#codes-derreur)

---

## Auth

### POST /api/auth/register

Création d'un compte utilisateur. Le premier utilisateur créé obtient le rôle `admin`.

**Body :**
```json
{
  "email": "user@example.com",
  "password": "mot_de_passe_fort",
  "displayName": "Jean Dupont"
}
```

**Réponse 201 :**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "displayName": "Jean Dupont",
    "role": "admin"
  },
  "token": "eyJhbGciOi..."
}
```

### POST /api/auth/login

Connexion avec email et mot de passe.

**Body :**
```json
{
  "email": "user@example.com",
  "password": "mot_de_passe"
}
```

**Réponse 200 :**
```json
{
  "user": { "id": "uuid", "email": "...", "displayName": "...", "role": "user" },
  "token": "eyJhbGciOi..."
}
```

**Erreur 401 :** Identifiants invalides

### POST /api/auth/logout

Déconnexion (supprime la session).

**Réponse 200 :** `{ "message": "Déconnexion réussie" }`

### GET /api/auth/me

Récupère le profil de l'utilisateur connecté.

**Authentification :**
- Cookie de session valide, ou
- Header `Authorization: Bearer <token>` valide

Permet de restaurer la session côté client après un rafraîchissement de page si l'un des deux mécanismes est encore valide.

**Réponse 200 :**
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "displayName": "Jean Dupont",
  "role": "user",
  "settings": {}
}
```

---

## Comptes Mail

> 🔒 Authentification requise

### GET /api/accounts

Liste tous les comptes mail de l'utilisateur.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "name": "Travail",
    "email": "jean@entreprise.com",
    "imapHost": "imap.entreprise.com",
    "imapPort": 993,
    "smtpHost": "smtp.entreprise.com",
    "smtpPort": 465,
    "color": "#0078d4",
    "isDefault": true,
    "signature": "<p>Cordialement, Jean</p>"
  }
]
```

### POST /api/accounts

Ajoute un nouveau compte mail.

**Body :**
```json
{
  "name": "Travail",
  "email": "jean@entreprise.com",
  "username": "jean@entreprise.com",
  "password": "mot_de_passe_mail",
  "imapHost": "imap.entreprise.com",
  "imapPort": 993,
  "imapSecure": true,
  "smtpHost": "smtp.entreprise.com",
  "smtpPort": 465,
  "smtpSecure": true,
  "color": "#0078d4",
  "isDefault": true,
  "signature": "<p>Cordialement</p>"
}
```

**Réponse 201 :** Le compte créé

### PUT /api/accounts/:id

Met à jour un compte mail.

### DELETE /api/accounts/:id

Supprime un compte mail.

### POST /api/accounts/:id/test

Teste la connexion IMAP/SMTP d'un compte.

**Réponse 200 :** `{ "imap": true, "smtp": true }`

**Réponse 400 :** `{ "imap": false, "smtp": true, "error": "..." }`

---

## Messagerie

> 🔒 Authentification requise

### GET /api/mail/:accountId/folders

Liste les dossiers d'un compte mail.

**Réponse 200 :**
```json
[
  {
    "path": "INBOX",
    "name": "Boîte de réception",
    "specialUse": "\\Inbox",
    "totalMessages": 150,
    "unseenMessages": 12,
    "delimiter": "."
  },
  {
    "path": "INBOX.Sent",
    "name": "Envoyés",
    "specialUse": "\\Sent",
    "totalMessages": 89,
    "unseenMessages": 0
  }
]
```

### POST /api/mail/accounts/:accountId/folders

Crée un nouveau dossier IMAP. Le dossier est automatiquement souscrit (`SUBSCRIBE`) pour être visible dans les autres clients mail.

**Body :**
```json
{ "path": "INBOX.Archives2024" }
```

**Réponse 200 :** `{ "success": true }`

### PATCH /api/mail/accounts/:accountId/folders

Renomme ou déplace un dossier IMAP (`RENAME`). Peut être utilisé pour imbriquer / désimbriquer un dossier en changeant le parent dans le chemin. Les souscriptions sont mises à jour automatiquement (`UNSUBSCRIBE` oldPath, `SUBSCRIBE` newPath).

**Body :**
```json
{ "oldPath": "INBOX.test", "newPath": "INBOX.Archives.test" }
```

**Réponse 200 :** `{ "success": true }`

### DELETE /api/mail/accounts/:accountId/folders

Supprime un dossier IMAP (`DELETE`).

**Body :**
```json
{ "path": "INBOX.obsolete" }
```

**Réponse 200 :** `{ "success": true }`

### POST /api/mail/messages/transfer

Transfère un message d'un compte/dossier vers un autre compte/dossier. Si source et destination sont sur le même compte, utilise IMAP `MOVE`/`COPY` natif ; sinon `FETCH` + `APPEND`, suivi d'un `DELETE` si mode `move`.

**Body :**
```json
{
  "srcAccountId": "uuid",
  "srcFolder": "INBOX",
  "uid": 1234,
  "destAccountId": "uuid",
  "destFolder": "INBOX.Archives",
  "mode": "move"
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `mode` | `"copy"` \| `"move"` | Opération à effectuer |

**Réponse 200 :** `{ "success": true, "newUid": 42 }`

### POST /api/mail/folders/copy

Copie un dossier complet (tous ses messages) d'un compte vers un autre. Crée le dossier destination si besoin, puis itère UID par UID.

**Body :**
```json
{
  "srcAccountId": "uuid",
  "srcPath": "INBOX.Projets",
  "destAccountId": "uuid",
  "destPath": "INBOX.Projets-copie"
}
```

**Réponse 200 :**
```json
{ "success": true, "copied": 42, "failed": 0, "total": 42 }
```

### GET /api/mail/:accountId/messages/:folder

Liste les messages d'un dossier.

**Query params :**
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | number | 1 | Numéro de page |
| `limit` | number | 50 | Messages par page |

**Réponse 200 :**
```json
{
  "messages": [
    {
      "uid": 1234,
      "messageId": "<id@example.com>",
      "subject": "Réunion de projet",
      "from": { "name": "Marie", "address": "marie@example.com" },
      "to": [{ "name": "Jean", "address": "jean@example.com" }],
      "date": "2026-04-20T10:30:00Z",
      "flags": ["\\Seen"],
      "hasAttachments": true,
      "snippet": "Bonjour, je vous rappelle la réunion..."
    }
  ],
  "total": 150,
  "page": 1,
  "pages": 3
}
```

### GET /api/mail/:accountId/message/:folder/:uid

Récupère le contenu complet d'un message.

**Réponse 200 :**
```json
{
  "uid": 1234,
  "messageId": "<id@example.com>",
  "subject": "Réunion de projet",
  "from": { "name": "Marie", "address": "marie@example.com" },
  "to": [{ "name": "Jean", "address": "jean@example.com" }],
  "cc": [],
  "bcc": [],
  "date": "2026-04-20T10:30:00Z",
  "flags": ["\\Seen"],
  "body": {
    "html": "<p>Bonjour, je vous rappelle...</p>",
    "text": "Bonjour, je vous rappelle..."
  },
  "attachments": [
    {
      "filename": "document.pdf",
      "contentType": "application/pdf",
      "size": 125000,
      "contentId": null
    }
  ]
}
```

### POST /api/mail/send

Envoie un email. Le serveur valide les destinataires au format `{ email, name? }`.

**⚠️ Note client** : Le client stocke les destinataires au format `{ address, name? }`. La méthode `api.sendMail()` convertit automatiquement `address` → `email` avant l'envoi.

**Body :**
```json
{
  "accountId": "uuid",
  "to": [{ "name": "Marie", "email": "marie@example.com" }],
  "cc": [],
  "bcc": [],
  "subject": "Re: Réunion de projet",
  "bodyHtml": "<p>Merci pour le rappel !</p>",
  "bodyText": "Merci pour le rappel !",
  "attachments": [],
  "inReplyTo": "<id@example.com>",
  "references": "<id1@example.com> <id2@example.com>"
}
```

**Réponse 200 :** `{ "success": true, "messageId": "<new-id@example.com>" }`

**Erreur 400 :** `{ "error": "Données invalides", "details": [...] }` si le schéma Zod échoue

**Erreur 403 :** `{ "error": "Vous n'avez pas la permission d'envoyer depuis ce compte" }` si `send_permission = 'none'`

#### Comportement "de la part de" (`send_permission = 'send_on_behalf'`)

Le serveur applique une stratégie d'en-têtes adaptée à la délivrabilité :

- **Même domaine** (utilisateur et boîte partagée sur le même domaine) :
  - `From: "Prénom Nom" <boite@domaine.fr>` (nom de l'utilisateur, email de la boîte)
  - `Sender: "Prénom Nom" <utilisateur@domaine.fr>` (en-tête RFC "on behalf of" standard)
- **Domaines différents** :
  - `From: "Prénom Nom" <boite@domaine1.fr>` (nom de l'utilisateur, email de la boîte)
  - `Sender` non défini (évite le spam cross-domain)
  - `Reply-To: "Prénom Nom" <utilisateur@domaine2.fr>` (les réponses reviennent à l'utilisateur)

#### Sauvegarde automatique dans "Envoyés"

Après un envoi SMTP réussi, une copie IMAP du message est automatiquement ajoutée au dossier Envoyés de la boîte :

1. Recherche du dossier avec `specialUse = \Sent`
2. Fallback sur les noms courants (normalisation des accents) : `Sent`, `Sent Items`, `INBOX.Sent`, `Envoyés`, `Éléments envoyés`, etc.
3. Ajout silencieux avec flag `\Seen` (erreurs loggées uniquement, n'affecte pas le retour de l'API)

### PUT /api/mail/:accountId/flags/:folder/:uid

Modifie les drapeaux d'un message.

**Body :**
```json
{
  "flags": ["\\Seen", "\\Flagged"],
  "action": "add"
}
```

`action` : `add` | `remove` | `set`

### PUT /api/mail/:accountId/move/:folder/:uid

Déplace un message vers un autre dossier.

**Body :** `{ "destination": "INBOX.Trash" }`

### DELETE /api/mail/:accountId/message/:folder/:uid

Supprime un message (déplace vers la corbeille).

### GET /api/mail/outbox

Récupère les messages en attente (mode hors-ligne).

### POST /api/mail/outbox/process

Envoie tous les messages en attente d'envoi.

---

## Contacts

> 🔒 Authentification requise

### GET /api/contacts

Liste tous les contacts.

**Query params :**
| Paramètre | Type | Description |
|-----------|------|-------------|
| `search` | string | Recherche par nom, prénom, email |
| `group` | string | Filtrer par groupe (UUID) |
| `source` | string | Filtrer par source (`'local'`, `'sender'`, `'nextcloud'`) |

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "firstName": "Marie",
    "lastName": "Durand",
    "email": "marie@example.com",
    "phone": "+33612345678",
    "company": "ACME Corp",
    "jobTitle": "Directrice",
    "department": "Direction",
    "photoUrl": null,
    "notes": "",
    "source": "local",
    "groups": ["uuid-groupe-1"]
  }
]
```

### POST /api/contacts

Crée un nouveau contact.

**Body :**
```json
{
  "firstName": "Marie",
  "lastName": "Durand",
  "email": "marie@example.com",
  "phone": "+33612345678",
  "company": "ACME Corp",
  "jobTitle": "Directrice",
  "department": "Direction",
  "notes": "Contact principal",
  "groups": ["uuid-groupe"]
}
```

### PUT /api/contacts/:id

Met à jour un contact.

### DELETE /api/contacts/:id

Supprime un contact.

### POST /api/contacts/senders/record

Enregistre automatiquement un expéditeur comme contact non permanent.

**Comportement :**
- Si l'adresse email existe déjà avec `source = 'local'`, ne fait rien
- Si l'adresse email n'existe pas, crée un nouveau contact avec `source = 'sender'`
- Si l'adresse email existe avec `source = 'sender'`, met à jour le nom si fourni

**Body :**
```json
{
  "email": "jean@example.com",
  "name": "Jean Dupont"
}
```

**Réponse 200 :**
```json
{
  "id": "uuid",
  "email": "jean@example.com",
  "display_name": "Jean Dupont",
  "source": "sender"
}
```

**Erreur 400 :** Si l'email existe déjà comme contact permanent

### POST /api/contacts/:id/promote

Promeut un contact de `source = 'sender'` à `source = 'local'`.

**Body :** vide ou confirmation (optionnel)

**Réponse 200 :** Le contact mis à jour

```json
{
  "id": "uuid",
  "email": "jean@example.com",
  "display_name": "Jean Dupont",
  "source": "local"
}
```

**Erreur 400 :** Si le contact n'a pas `source = 'sender'`

### GET /api/contacts/autocomplete

Autocomplétion pour le composeur d'email.

**Query params :** `q` (string, minimum 1 caractère)

**Réponse 200 :**
```json
[
  { "name": "Marie Durand", "address": "marie@example.com", "type": "contact" },
  { "name": "Équipe Dev", "address": null, "type": "distribution_list", "members": [...] }
]
```

### GET /api/contacts/groups

Liste les groupes de contacts.

### POST /api/contacts/groups

Crée un groupe de contacts.

**Body :** `{ "name": "Fournisseurs", "color": "#10b981" }`

### PUT /api/contacts/groups/:id

Met à jour un groupe.

### DELETE /api/contacts/groups/:id

Supprime un groupe.

### GET /api/contacts/distribution-lists

Liste les listes de distribution.

### POST /api/contacts/distribution-lists

Crée une liste de distribution.

**Body :**
```json
{
  "name": "Équipe Dev",
  "description": "Tous les développeurs",
  "members": ["uuid-contact-1", "uuid-contact-2"]
}
```

---

## Calendrier

> 🔒 Authentification requise

### GET /api/calendar/calendars

Liste les calendriers de l'utilisateur.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "name": "Personnel",
    "color": "#0078d4",
    "isDefault": true,
    "isShared": false
  }
]
```

### POST /api/calendar/calendars

Crée un nouveau calendrier.

**Body :** `{ "name": "Projet X", "color": "#e74c3c" }`

### PUT /api/calendar/calendars/:id

Met à jour un calendrier.

### DELETE /api/calendar/calendars/:id

Supprime un calendrier et tous ses événements.

### GET /api/calendar/events

Liste les événements dans une plage de dates.

**Query params :**
| Paramètre | Type | Description |
|-----------|------|-------------|
| `start` | ISO 8601 | Début de la période |
| `end` | ISO 8601 | Fin de la période |
| `calendarId` | UUID | Filtrer par calendrier (optionnel) |

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "calendarId": "uuid",
    "title": "Réunion d'équipe",
    "description": "Revue hebdomadaire",
    "start": "2026-04-20T14:00:00Z",
    "end": "2026-04-20T15:00:00Z",
    "allDay": false,
    "location": "Salle B12",
    "attendees": [
      { "email": "marie@example.com", "name": "Marie", "status": "accepted" }
    ]
  }
]
```

### POST /api/calendar/events

Crée un événement.

### PUT /api/calendar/events/:id

Met à jour un événement.

### DELETE /api/calendar/events/:id

Supprime un événement.

### POST /api/calendar/calendars/:id/share

Partage un calendrier avec un autre utilisateur.

**Body :** `{ "userId": "uuid", "permission": "read" }`

`permission` : `read` | `write`

---

## Paramètres

> 🔒 Authentification requise

### GET /api/settings

Récupère les paramètres de l'utilisateur.

**Réponse 200 :**
```json
{
  "display_name": "Jean Dupont",
  "avatar_url": null,
  "language": "fr",
  "timezone": "Europe/Paris",
  "theme": "light",
  "attachment_action_mode": "preview",
  "attachment_visibility_min_kb": 10
}
```

### PUT /api/settings

Met à jour les paramètres utilisateur.

**Body :**
```json
{
  "displayName": "Jean Dupont",
  "theme": "light",
  "language": "fr",
  "timezone": "Europe/Paris",
  "attachmentActionMode": "preview",
  "notifications": {
    "email": true,
    "desktop": true,
    "sound": false
  }
}
```

`attachmentActionMode` : `preview` | `download` | `menu`

### PUT /api/settings/password

Change le mot de passe.

**Body :**
```json
{
  "currentPassword": "ancien",
  "newPassword": "nouveau_fort"
}
```

---

## Administration

> 🔒 Authentification requise + rôle `admin`

### GET /api/admin/settings

Récupère les paramètres globaux.

### PUT /api/admin/settings

Met à jour les paramètres globaux.

**Body :**
```json
{
  "appName": "WebMail",
  "registrationEnabled": true,
  "maxAttachmentSize": 25000000
}
```

### GET /api/admin/users

Liste tous les utilisateurs.

### POST /api/admin/users

Crée un utilisateur.

### PUT /api/admin/users/:id

Met à jour un utilisateur (rôle, statut).

### DELETE /api/admin/users/:id

Supprime un utilisateur.

### GET /api/admin/groups

Liste tous les groupes.

### POST /api/admin/groups

Crée un groupe.

**Body :**
```json
{
  "name": "Développeurs",
  "color": "#8b5cf6",
  "members": ["uuid-user-1", "uuid-user-2"]
}
```

### PUT /api/admin/groups/:id

Met à jour un groupe.

### DELETE /api/admin/groups/:id

Supprime un groupe.

### GET /api/admin/mail-accounts

Liste tous les comptes mail gérés par l'administration.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "name": "Support",
    "email": "support@example.com",
    "username": "support@example.com",
    "imap_host": "imap.example.com",
    "imap_port": 993,
    "imap_secure": true,
    "smtp_host": "smtp.example.com",
    "smtp_port": 465,
    "smtp_secure": true,
    "is_shared": true,
    "signature_html": "<p>Cordialement</p>",
    "signature_text": "Cordialement",
    "color": "#0078D4",
    "assignment_count": 3,
    "created_at": "2026-04-21T10:00:00Z"
  }
]
```

### POST /api/admin/mail-accounts

Crée un compte mail administré.

**Body :**
```json
{
  "name": "Support",
  "email": "support@example.com",
  "username": "support@example.com",
  "password": "mot_de_passe_mail",
  "imapHost": "imap.example.com",
  "imapPort": 993,
  "imapSecure": true,
  "smtpHost": "smtp.example.com",
  "smtpPort": 465,
  "smtpSecure": true,
  "isShared": true,
  "signatureHtml": "<p>Cordialement</p>",
  "signatureText": "Cordialement",
  "color": "#0078D4"
}
```

### PUT /api/admin/mail-accounts/:id

Met à jour un compte mail administré.

Le champ `password` est optionnel : si omis, le mot de passe existant est conservé.

### DELETE /api/admin/mail-accounts/:id

Supprime un compte mail administré.

### POST /api/admin/mail-accounts/:id/test

Teste la connexion IMAP d'un compte mail administré.

**Réponse 200 :**
```json
{ "success": true, "folders": 8 }
```

### POST /api/admin/nextcloud/test

Teste la connexion NextCloud.

**Body :**
```json
{
  "url": "https://cloud.example.com",
  "username": "admin",
  "password": "password"
}
```

---

## Dashboard

> 🔒 Authentification requise + rôle `admin`

### GET /api/admin/dashboard

Récupère les statistiques système agrégées.

**Réponse 200 :**
```json
{
  "users": 12,
  "groups": 4,
  "mailAccounts": 18,
  "contacts": 256,
  "emails": 4500,
  "calendars": 8,
  "plugins": 2,
  "o2switchAccounts": 1,
  "dbSize": 52428800,
  "memoryUsage": 134217728,
  "uptime": 86400,
  "logsCount": 340
}
```

---

## Logs d'audit

> 🔒 Authentification requise + rôle `admin`

### GET /api/admin/logs

Liste les logs d'audit avec pagination et filtrage.

**Query params :**
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `page` | number | 1 | Numéro de page |
| `limit` | number | 50 | Logs par page |
| `category` | string | — | Filtrer par catégorie (auth, admin, mail, o2switch, system) |
| `search` | string | — | Recherche par mot-clé dans l'action et les détails |

**Réponse 200 :**
```json
{
  "logs": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "action": "o2switch.sync",
      "category": "o2switch",
      "target_type": "o2switch_account",
      "target_id": "uuid",
      "details": { "emails_synced": 15 },
      "ip_address": "192.168.1.10",
      "user_agent": "Mozilla/5.0...",
      "created_at": "2026-04-20T10:30:00Z",
      "user_email": "admin@example.com",
      "user_display_name": "Admin"
    }
  ],
  "total": 340,
  "page": 1,
  "totalPages": 7
}
```

### GET /api/admin/logs/categories

Liste les catégories de logs disponibles.

**Réponse 200 :**
```json
["auth", "admin", "mail", "o2switch", "system"]
```

---

## O2Switch cPanel

> 🔒 Authentification requise + rôle `admin`

### GET /api/admin/o2switch/accounts

Liste tous les comptes O2Switch enregistrés.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "hostname": "monsite.o2switch.net",
    "username": "user123",
    "label": "Production",
    "is_active": true,
    "last_sync": "2026-04-20T09:00:00Z",
    "created_at": "2026-04-15T08:00:00Z"
  }
]
```

### POST /api/admin/o2switch/accounts

Ajoute un nouveau compte O2Switch.

**Body :**
```json
{
  "hostname": "monsite.o2switch.net",
  "username": "user123",
  "apiToken": "ABCDEF123456...",
  "label": "Production"
}
```

**Réponse 201 :** Le compte créé (sans le token)

### PUT /api/admin/o2switch/accounts/:id

Met à jour un compte O2Switch.

### DELETE /api/admin/o2switch/accounts/:id

Supprime un compte O2Switch et ses liaisons email.

### POST /api/admin/o2switch/accounts/:id/test

Teste la connexion au serveur cPanel.

**Réponse 200 :** `{ "success": true, "message": "Connexion réussie" }`

**Réponse 500 :** `{ "error": "Connexion échouée: ..." }`

### GET /api/admin/o2switch/accounts/:id/emails

Liste les comptes email du serveur cPanel.

**Réponse 200 :**
```json
[
  {
    "email": "contact@example.com",
    "domain": "example.com",
    "diskused": 52428800,
    "diskquota": 1073741824,
    "suspended": false
  }
]
```

### GET /api/admin/o2switch/accounts/:id/domains

Liste les domaines du compte cPanel.

### POST /api/admin/o2switch/accounts/:id/emails

Crée un nouveau compte email sur le serveur cPanel.

**Body :**
```json
{
  "email": "nouveau@example.com",
  "password": "mot_de_passe_fort",
  "quota": 1024
}
```

### PUT /api/admin/o2switch/accounts/:id/emails/:email

Met à jour un compte email (quota, mot de passe).

**Body :**
```json
{
  "quota": 2048,
  "password": "nouveau_mot_de_passe"
}
```

### DELETE /api/admin/o2switch/accounts/:id/emails/:email

Supprime un compte email du serveur cPanel.

### POST /api/admin/o2switch/accounts/:id/sync

Synchronise les emails du serveur cPanel et crée automatiquement les comptes mail locaux correspondants.

**Réponse 200 :**
```json
{
  "synced": 5,
  "created": 3,
  "existing": 2,
  "errors": []
}
```

### POST /api/admin/o2switch/accounts/:id/link

Lie un email O2Switch à un compte mail local avec attribution d'utilisateurs et de groupes.

**Body :**
```json
{
  "remoteEmail": "contact@example.com",
  "password": "mot_de_passe_email",
  "name": "Contact Principal",
  "assignToUserIds": ["uuid-user-1", "uuid-user-2"],
  "assignToGroupIds": ["uuid-group-1"]
}
```

### GET /api/admin/o2switch/accounts/:id/links

Liste les liaisons email O2Switch existantes.

### GET /api/admin/o2switch/accounts/:id/disk

Récupère l'utilisation disque du compte cPanel.

**Réponse 200 :**
```json
{
  "used": 524288000,
  "limit": 10737418240,
  "percentage": 4.88
}
```

---

## Plugins

> 🔒 Authentification requise

### GET /api/plugins

Liste les plugins disponibles pour l'utilisateur.

**Réponse 200 :**
```json
[
  {
    "name": "ollama-ai",
    "displayName": "Ollama AI Assistant",
    "description": "Assistant IA pour emails",
    "version": "1.0.0",
    "icon": "🤖",
    "actions": ["summarize", "reply_suggest", "translate", "improve"],
    "config": {}
  }
]
```

### POST /api/plugins/:name/execute

Exécute une action d'un plugin.

**Body :**
```json
{
  "action": "summarize",
  "data": {
    "subject": "Réunion de projet",
    "body": "Bonjour, voici le compte-rendu..."
  }
}
```

**Réponse 200 :**
```json
{
  "result": "Résumé : Compte-rendu de la réunion projet du 20/04..."
}
```

### GET /api/plugins/:name/config

Récupère la configuration d'un plugin.

### PUT /api/plugins/:name/config

Met à jour la configuration d'un plugin.

### POST /api/admin/plugins/:name/install *(admin)*

Active un plugin.

### DELETE /api/admin/plugins/:name *(admin)*

Désactive un plugin.

### POST /api/admin/plugins/:name/assign *(admin)*

Attribue un plugin à un utilisateur ou groupe.

**Body :**
```json
{
  "type": "user",
  "targetId": "uuid-user"
}
```

---

## Recherche

> 🔒 Authentification requise

### GET /api/search

Recherche globale dans les emails, contacts et événements.

**Query params :**
| Paramètre | Type | Description |
|-----------|------|-------------|
| `q` | string | Terme de recherche |
| `type` | string | `all` \| `emails` \| `contacts` \| `events` |
| `limit` | number | Nombre max de résultats par type |

**Réponse 200 :**
```json
{
  "emails": [
    { "uid": 1234, "subject": "...", "from": "...", "snippet": "..." }
  ],
  "contacts": [
    { "id": "uuid", "name": "Marie Durand", "email": "..." }
  ],
  "events": [
    { "id": "uuid", "title": "Réunion", "start": "..." }
  ]
}
```

---

## Codes d'erreur

| Code | Signification |
|------|---------------|
| 200 | Succès |
| 201 | Ressource créée |
| 400 | Requête invalide (données manquantes ou incorrectes) |
| 401 | Non authentifié |
| 403 | Accès refusé (rôle insuffisant) |
| 404 | Ressource non trouvée |
| 409 | Conflit (email déjà utilisé, etc.) |
| 422 | Erreur de validation |
| 429 | Trop de requêtes (rate limiting) |
| 500 | Erreur serveur |

### Format d'erreur standard

```json
{
  "error": "Description de l'erreur",
  "details": {}
}
```

---

## WebSocket

Connexion WebSocket pour les notifications en temps réel.

**URL :** `ws://localhost:3000/ws?token=<jwt_token>`

### Messages reçus

```json
{
  "type": "new_email",
  "data": {
    "accountId": "uuid",
    "folder": "INBOX",
    "uid": 1235,
    "from": "marie@example.com",
    "subject": "Nouveau message"
  }
}
```

Types de notifications :
| Type | Description |
|------|-------------|
| `new_email` | Nouvel email reçu |
| `email_flags` | Drapeaux modifiés |
| `calendar_event` | Événement modifié |
| `plugin_result` | Résultat d'une action plugin |
