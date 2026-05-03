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
- [Modèles de mail](#modèles-de-mail)
- [Administration](#administration)
- [Nextcloud Files](#nextcloud-files-par-utilisateur)
- [Dashboard](#dashboard)
- [Logs d'audit](#logs-daudit)
- [O2Switch cPanel](#o2switch-cpanel)
- [Plugins](#plugins)
- [Recherche](#recherche)
- [Notifications push](#notifications-push)
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

**Réponse 200 (compte sans passkey) :**
```json
{
  "user": { "id": "uuid", "email": "...", "displayName": "...", "role": "user" },
  "token": "eyJhbGciOi..."
}
```
Un cookie `wm_refresh` (httpOnly, SameSite=Strict, scope `/api/auth`, TTL 90 j glissant) est également posé.

**Réponse 200 (compte avec passkey enrôlée — 2FA obligatoire) :**
```json
{
  "requires2FA": true,
  "pendingToken": "eyJhbGciOi...",
  "userId": "uuid"
}
```
Aucun cookie n'est posé à ce stade. Le client doit poursuivre avec `/api/auth/webauthn/login/options` puis `/verify` en passant le `pendingToken` (validité 5 min).

**Erreur 401 :** Identifiants invalides

### POST /api/auth/logout

Déconnexion — révoque le refresh token du device courant, détruit la session legacy et efface les cookies.

**Réponse 200 :** `{ "message": "Déconnecté" }`

### POST /api/auth/refresh

Rotation silencieuse du refresh token (appelée automatiquement par le client sur 401 et au boot).
N'accepte aucun body ; le cookie `wm_refresh` suffit.

**Réponse 200 :**
```json
{ "token": "eyJhbGciOi..." }
```
Un nouveau cookie `wm_refresh` est posé ; l'ancien est révoqué.

**Erreurs 401 :**
- `{ "code": "no_refresh" }` — cookie absent
- `{ "code": "refresh_invalid" }` — cookie expiré ou déjà réutilisé (chaîne révoquée)

### GET /api/auth/devices

Liste les sessions actives de l'utilisateur (une ligne par appareil).

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "deviceName": "Chrome · Windows",
    "userAgent": "Mozilla/5.0 ...",
    "ipLastSeen": "203.0.113.42",
    "createdAt": "2026-01-10T09:12:00Z",
    "lastUsedAt": "2026-04-23T18:07:00Z",
    "expiresAt": "2026-07-23T18:07:00Z",
    "current": true
  }
]
```

### DELETE /api/auth/devices/:id

Déconnecte à distance un appareil. L'access token courant de ce device devient invalide à la requête suivante (vérification serveur `isSessionActive`).

**Réponse 200 :** `{ "success": true }`

### WebAuthn / Passkeys

Toutes les routes utilisent `@simplewebauthn/server`. Le challenge est émis par le serveur et consommé une seule fois.

| Méthode | Route | Auth | Description |
|---------|-------|------|-------------|
| POST | `/api/auth/webauthn/register/options` | Bearer | Options d'enrôlement d'une nouvelle clé |
| POST | `/api/auth/webauthn/register/verify` | Bearer | Finalise l'enrôlement. Body : `{ response, nickname? }` |
| GET | `/api/auth/webauthn/credentials` | Bearer | Liste les passkeys enregistrées |
| DELETE | `/api/auth/webauthn/credentials/:id` | Bearer | Supprime une passkey |
| POST | `/api/auth/webauthn/login/options` | Public | Options du challenge 2FA. Body : `{ pendingToken }` |
| POST | `/api/auth/webauthn/login/verify` | Public | Finalise le login 2FA. Body : `{ pendingToken, response }`. Émet le token + cookie refresh |
| POST | `/api/auth/webauthn/unlock/options` | Bearer | Challenge de déverrouillage local PWA |
| POST | `/api/auth/webauthn/unlock/verify` | Bearer | Finalise le déverrouillage. Body : `{ response }` |
| POST | `/api/auth/webauthn/passkey/options` | Public | Options d'un login *passwordless* (FIDO2 discoverable credential). Pas de body. |
| POST | `/api/auth/webauthn/passkey/verify` | Public | Finalise le login passwordless. Body : `{ response }`. Émet le token + cookie refresh directement (pas de mot de passe requis). |

> ℹ️ Le flow *passwordless* nécessite que la passkey ait été enrôlée avec `residentKey: required` (cas par défaut depuis la mise à jour). Les clés plus anciennes (`residentKey: preferred`) continuent de fonctionner pour le 2FA mais ne sont pas garanties découvrables — il faut les réénrôler pour bénéficier du bouton « Se connecter avec une clé d'accès ».

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
  "signature": "<p>Cordialement</p>",
  "o2switchAutoSync": true
}
```

Si `o2switchAutoSync` vaut `true` (ou si `imapHost` se termine par `.o2switch.net`), le serveur active automatiquement les flags `caldav_sync_enabled` / `carddav_sync_enabled` sur ce compte et configure les URLs suivantes avec le même mot de passe que IMAP/SMTP :

- CalDAV : `https://colorant.o2switch.net:2080/calendars/{email}/calendar`
- CardDAV : `https://colorant.o2switch.net:2080/addressbooks/{email}/addressbook`

Une première synchronisation CalDAV est lancée en arrière-plan (fire-and-forget).

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

### GET /api/mail/badge

Renvoie le compteur agrégé pour la **pastille (badge) de l'icône PWA** — alimente la Web App Badging API côté client.

**Query :**
- `source` (optionnel, défaut `inbox-unread`) : `inbox-unread` (mails non lus, défaut style messagerie professionnelle) | `inbox-recent` (nouveaux mails marqués RECENT) | `inbox-total` (total des mails dans la Boîte de réception).
- `scope` (optionnel, défaut `all`) : `all` (cumul sur tous les comptes assignés et possédés par l'utilisateur) | `default` (compte par défaut uniquement).

**Réponse 200 :**
```json
{
  "source": "inbox-unread",
  "scope": "all",
  "count": 24,
  "perAccount": [
    { "accountId": "uuid-a", "count": 18 },
    { "accountId": "uuid-b", "count": 6 }
  ],
  "cached": false
}
```

**Notes :**
- Implémenté via IMAP `STATUS` — n'ouvre pas les messages (très peu coûteux).
- Cache mémoire serveur de 30 s par couple `(userId, source, scope)`.
- Les comptes en erreur (IMAP indisponible) sont silencieusement ignorés et n'apparaissent pas dans `perAccount` ; le total reste cohérent avec les comptes joignables.

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

### POST /api/mail/accounts/:accountId/messages/:uid/archive

Archive un message dans une arborescence basée sur la **date de réception** (`INTERNALDATE` IMAP ou date de l'enveloppe). Les dossiers manquants sont créés et souscrits automatiquement avant le `MESSAGE MOVE`. Le dossier racine et le motif des sous-dossiers sont configurés via les paramètres administrateur `archive_root_folder` et `archive_subfolder_pattern` (par défaut : `Archives` et `{YYYY}/{MM} - {MMMM}`).

**Body :**
```json
{ "fromFolder": "INBOX" }
```

**Réponse 200 :** `{ "success": true, "destFolder": "Archives/2026/04 - Avril" }`

Jetons du motif : `{YYYY}`, `{YY}`, `{MM}` (01-12), `{M}` (1-12), `{MMMM}` (Janvier…Décembre), `{MMM}` (abrégé). Le séparateur `/` délimite les segments ; le délimiteur IMAP réel du serveur est utilisé lors de la création (`.`, `/`…).

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

Supprime un message sur le serveur IMAP (EXPUNGE). Le client appelle cette route uniquement lorsque l'utilisateur confirme une *suppression définitive* (message déjà dans la corbeille ou aucun dossier corbeille détectable). Dans les autres cas, le client préfère un **déplacement vers la Corbeille** (`PUT /move`) pour préserver la récupération du message.

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

Si l'utilisateur possède au moins un compte mail avec `carddav_sync_enabled = true` (par exemple une boîte o2switch configurée avec `o2switchAutoSync`), le contact est automatiquement **poussé** vers le serveur CardDAV distant en arrière-plan (`PUT {collection}/{uid}.vcf`). Un `UID` stable est généré et les champs `mail_account_id`, `carddav_url`, `carddav_href`, `carddav_etag` sont renseignés pour permettre les futures mises à jour / suppressions distantes.

### PUT /api/contacts/:id

Met à jour un contact. Re-pousse la vCard avec `If-Match: <etag>` si le contact est lié à un carnet CardDAV.

### DELETE /api/contacts/:id

Supprime un contact (et envoie le `DELETE` au serveur CardDAV si le contact est lié).

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

### POST /api/contacts/import

Import en masse de contacts depuis un fichier vCard ou CSV (les messageries courantes). Le parsing est effectué côté client (`client/src/utils/contactImportExport.ts`) ; seules les données normalisées arrivent au serveur.

**Corps** :
```json
{
  "contacts": [
    {
      "email": "alice@example.com",
      "firstName": "Alice",
      "lastName": "Dupont",
      "phone": "+33 1 23 45 67 89",
      "mobile": "+33 6 12 34 56 78",
      "company": "Acme",
      "jobTitle": "CTO",
      "department": "R&D",
      "notes": "Rencontrée au salon…",
      "avatarUrl": "data:image/jpeg;base64,...",
      "website": "https://example.com",
      "birthday": "1990-03-14",
      "address": "1 rue de la Paix, 75001 Paris"
    }
  ],
  "mode": "merge"
}
```

Modes de dédoublonnage (clé = e-mail insensible à la casse) :

| Mode | Comportement |
|------|--------------|
| `merge` | Complète les champs vides du contact existant sans écraser les valeurs déjà présentes. Un expéditeur (`source = 'sender'`) est promu en `local` lors d'un merge. |
| `skip` | Ignore les contacts dont l'e-mail existe déjà. |
| `replace` | Écrase tous les champs du contact existant. |

**Réponse 200** :
```json
{
  "imported": 12,
  "updated": 3,
  "skipped": 1,
  "errors": [],
  "total": 16
}
```

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

**Body :**

```json
{
  "name": "Projet X",
  "color": "#e74c3c",
  "mailAccountId": "uuid | optionnel",
  "createOnCaldav": true
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `name` | string | Nom affiché (requis). |
| `color` | string | Couleur hexadécimale (défaut `#0078D4`). |
| `mailAccountId` | UUID \| null | Si fourni, le calendrier est rattaché à cette boîte mail (propriété directe ou via `mailbox_assignments`). Sinon le calendrier est purement local. |
| `createOnCaldav` | boolean | Ignoré si `mailAccountId` est absent. Lorsqu'il vaut `true` et que la boîte mail cible a une `caldav_url` + `caldav_sync_enabled`, le serveur provisionne le calendrier sur le serveur CalDAV distant avant d'insérer la ligne locale ; celle-ci est alors créée avec `source = 'caldav'`, `caldav_url` et `external_id` positionnés à l'URL du nouveau collection remote. Le serveur essaie les méthodes dans l'ordre : **`MKCALENDAR`** (RFC 4791) → **`MKCOL` étendu** (RFC 5689) → **`MKCOL` + `PROPPATCH`** (fallback compatible cPanel/o2switch qui rejettent `MKCALENDAR`). |

**Erreurs :**

- `400 Bad Request` — `name` manquant ou `createOnCaldav` sans URL CalDAV sur la boîte mail.
- `404 Not Found` — `mailAccountId` introuvable ou non accessible à l'utilisateur.
- `502 Bad Gateway` — les trois méthodes (`MKCALENDAR`, `MKCOL` étendu, `MKCOL`+`PROPPATCH`) ont toutes échoué sur le serveur distant (corps : `{ error: "Création CalDAV échouée (<status>) : <message>" }`). Aucune ligne locale n'est alors insérée.

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

**Body (application/json) :**

```jsonc
{
  "calendarId": "uuid",                     // requis
  "title": "string",                        // requis
  "description": "string",                  // optionnel
  "location": "string",                     // optionnel
  "startDate": "2024-05-02T09:00:00",       // requis (ISO local ou UTC)
  "endDate":   "2024-05-02T10:00:00",       // requis
  "allDay": false,                          // optionnel, défaut false
  "recurrenceRule": "FREQ=WEEKLY;BYDAY=MO,WE", // optionnel — RRULE RFC 5545
  "rdates": ["2024-06-12T00:00:00"],        // optionnel — dates explicites (freq=CUSTOM)
  "reminderMinutes": 15,                    // optionnel — null | 0 | 5 | 10 | 15 | 30 | 60 | 120 | 1440 | 2880 | 10080
  "status": "confirmed",                    // 'confirmed' (défaut) | 'tentative' | 'cancelled'
  "priority": 5,                            // optionnel — 0 (aucune) à 9, 1=haute / 5=normale / 9=basse
  "url": "https://…",                       // optionnel
  "categories": ["travail", "client-x"],    // optionnel
  "transparency": "OPAQUE",                 // optionnel — 'OPAQUE' (occupé, défaut) | 'TRANSPARENT' (disponible)
  "organizer": { "email": "me@dom.tld", "name": "Moi" },  // optionnel
  "attendees": [                            // optionnel
    {
      "email": "alice@dom.tld",
      "name": "Alice",                      // optionnel
      "role": "REQ-PARTICIPANT",            // CHAIR | REQ-PARTICIPANT | OPT-PARTICIPANT | NON-PARTICIPANT
      "status": "pending",                  // pending | accepted | declined | tentative | delegated
      "rsvp": true,                         // optionnel
      "comment": "string"                   // optionnel
    }
  ],
  "attachments": [                          // optionnel (≤ 250 Mo inline par fichier)
    { "name": "contrat.pdf", "mime": "application/pdf", "size": 23456, "data": "<base64>" },
    { "name": "lien", "url": "https://…" }
  ]
}
```

Si le calendrier cible est lié à un compte mail (`caldav_url` + `mail_account_id` renseignés), l'événement est automatiquement **poussé** vers le serveur CalDAV distant via `PUT {calendarHref}/{uid}.ics` en arrière-plan. Un `ical_uid` stable est généré à la création. Le serveur sérialise en RFC 5545 toutes les propriétés ci-dessus — en particulier `RRULE`, `RDATE`, `TRANSP`, `PRIORITY`, `CATEGORIES`, `URL`, `ORGANIZER`, `ATTENDEE` (avec `ROLE`, `PARTSTAT`, `RSVP`, `CN`), `ATTACH` (URL ou inline base64) et un bloc `VALARM` (`ACTION:DISPLAY`, `TRIGGER:-PT<n>M`) dès qu'un rappel est configuré.

### PUT /api/calendar/events/:id

Met à jour un événement (mêmes champs que `POST`). Re-pousse la vCalendar distante si le calendrier est lié à un compte CalDAV **ou** un calendrier NextCloud (`nc_managed=true`). Le champ `ical_data` est réinitialisé à `NULL` afin que la prochaine exportation reconstruise l'ICS à partir de l'état DB (pour intégrer les nouveaux champs ci-dessus).

Pour un simple déplacement (drag & drop dans l'agenda), il suffit d'envoyer `{ "startDate": "...", "endDate": "..." }` — les autres champs sont préservés via `COALESCE`.

### DELETE /api/calendar/events/:id

Supprime un événement. Envoie également un `DELETE {calendarHref}/{uid}.ics` au serveur CalDAV si le calendrier est lié.

### POST /api/calendar/accounts/:accountId/sync

Déclenche une synchronisation CalDAV pour le compte mail indiqué. Le compte doit avoir `caldav_url` renseigné et `caldav_sync_enabled = true`.

**Réponse 200 :** `{ "ok": true, "calendars": <int>, "events": <int> }`

Lors de la première synchronisation, le calendrier local `is_default = true` de l'utilisateur est **fusionné** avec le calendrier distant par défaut (nommé *calendar / default / agenda*, ou le premier renvoyé) plutôt que dupliqué.

### POST /api/calendar/sync

Synchronise tous les comptes mail CalDAV-activés de l'utilisateur, **et** déclenche également la synchronisation NextCloud (`syncCalendars` + `syncContacts`) quand l'utilisateur est lié à un compte NC. Met à jour `nextcloud_users.last_sync_at` / `last_sync_error`.

**Réponse 200 :**
```json
{
  "synced": 2,
  "results": [ { "accountId": "...", "calendars": 3, "events": 42 } ],
  "nextcloud": { "ok": true }
}
```

### POST /api/calendar/:id/migrate

Migre un calendrier entre stockage local et NextCloud.

**Body :**
- `{ "target": "nextcloud" }` : crée le calendrier sur NC via `MKCALENDAR`, PUT tous les événements existants, bascule `source='nextcloud'` et `nc_managed=true`.
- `{ "target": "local", "deleteRemote"?: true }` : détache le calendrier de NC et, si `deleteRemote=true`, supprime également le calendrier côté serveur NextCloud.

**Réponse 200 :** `{ "ok": true, "calendar": { ... } }`

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

## Modèles de mail

> 🔒 Authentification requise

### GET /api/mail-templates

Liste les modèles visibles par l'utilisateur connecté : ses modèles personnels, les modèles globaux et ceux partagés (directement ou via un groupe d'appartenance).

**Réponse :**
```json
[
  {
    "id": "uuid",
    "ownerUserId": "uuid|null",
    "ownerEmail": "owner@example.com",
    "ownerDisplayName": "Jean Dupont",
    "name": "Réponse standard",
    "subject": "Re: votre demande",
    "bodyHtml": "<p>Bonjour,</p>",
    "isGlobal": false,
    "scope": "owned",
    "createdAt": "2025-…",
    "updatedAt": "2025-…"
  }
]
```

`scope` vaut `owned` (modèle créé par l'utilisateur), `global` (modèle administrateur visible par tous) ou `shared` (partagé avec l'utilisateur ou l'un de ses groupes).

### POST /api/mail-templates

Crée un modèle personnel pour l'utilisateur courant.

**Body :**
```json
{ "name": "Modèle X", "subject": "Objet", "bodyHtml": "<p>…</p>" }
```

### PUT /api/mail-templates/:id

Met à jour un modèle dont l'utilisateur est propriétaire. Mêmes champs que `POST`.

### DELETE /api/mail-templates/:id

Supprime un modèle (cascade sur ses partages). Réservé au propriétaire.

### GET /api/mail-templates/:id/shares

Liste les partages d'un modèle.

**Réponse :**
```json
[
  {
    "id": "uuid",
    "userId": "uuid|null",
    "groupId": "uuid|null",
    "userEmail": "alice@example.com",
    "userDisplayName": "Alice",
    "groupName": null
  }
]
```

### POST /api/mail-templates/:id/shares

Ajoute un partage. Exactement un des deux champs doit être renseigné (XOR `userId` / `groupId`).

**Body :**
```json
{ "userId": "uuid", "groupId": null }
```

### DELETE /api/mail-templates/:id/shares/:shareId

Retire un partage donné.

### Variantes administrateur

> 🔒 Authentification requise + rôle `admin`

Les routes ci-dessus existent en miroir sous `/api/admin/mail-templates` et permettent à un administrateur d'opérer sur **tous** les modèles de la plateforme :

- `GET /api/admin/mail-templates` — liste tous les modèles (personnels de tous les utilisateurs + globaux), avec colonnes `ownerEmail` / `ownerDisplayName` enrichies.
- `POST /api/admin/mail-templates` — crée un modèle. Champs additionnels : `isGlobal: boolean` (modèle visible par tous, `ownerUserId` doit alors être `null`) et `ownerUserId: string | null` (assigne le modèle à un utilisateur spécifique).
- `PUT /api/admin/mail-templates/:id` — modifie n'importe quel modèle, y compris pour basculer entre *global* et *personnel* via `isGlobal` / `ownerUserId`.
- `DELETE /api/admin/mail-templates/:id` — supprime n'importe quel modèle.
- `GET|POST|DELETE /api/admin/mail-templates/:id/shares[/:shareId]` — gère les partages d'un modèle pour le compte de son propriétaire.

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

### GET /api/branding

> 🌐 Public (aucune authentification requise)

Renvoie le nom de l'application et les URLs des icônes (favicon, icônes PWA) avec cache-busting.
Utilisé par le client pour initialiser `document.title` et `<link rel="icon">` dynamiquement sans rebuild.

**Réponse :**
```json
{
  "app_name": "WebMail",
  "icons": {
    "favicon": "/favicon.ico?v=abc123",
    "icon192": "/icon-192.png?v=abc123",
    "icon512": "/icon-512.png?v=abc123",
    "apple": "/apple-touch-icon.png?v=abc123"
  },
  "custom": {
    "favicon": false,
    "icon192": true,
    "icon512": true,
    "apple": false
  }
}
```

Le champ `custom.<type>` indique si un fichier personnalisé a été téléversé (`true`) ou si l'icône par défaut du bundle est servie (`false`). Le suffixe `?v=...` dans les URLs est un hash du `mtime` du fichier côté serveur pour forcer le rafraîchissement lorsqu'un admin remplace l'image.

### POST /api/admin/branding/:type

> 🔒 Admin requis — `multipart/form-data`

Téléverse une icône personnalisée. `:type` ∈ `favicon` | `icon192` | `icon512` | `apple`.

**Champ form-data :** `file` — image (max 5 Mo, MIME `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`, `image/x-icon`).

**Réponse :**
```json
{ "success": true, "filename": "icon-192.png", "size": 4821 }
```

Le fichier est stocké dans `server/uploads/branding/` avec un nom canonique et remplace le bundle à la volée (middleware Express).

### DELETE /api/admin/branding/:type

> 🔒 Admin requis

Supprime l'icône personnalisée et rétablit l'icône par défaut fournie par le bundle client.

**Réponse :**
```json
{ "success": true }
```

### GET /api/admin/devices

> 🔒 Admin requis

Liste **toutes les sessions actives** de l'instance, groupées par utilisateur (une entrée par compte, un tableau d'appareils dedans). Utilisé par l'onglet admin *Appareils*.

**Réponse 200 :**
```json
[
  {
    "userId": "uuid",
    "email": "user@example.com",
    "displayName": "Jean Dupont",
    "isAdmin": false,
    "devices": [
      {
        "id": "uuid",
        "deviceName": "Chrome · Windows",
        "userAgent": "Mozilla/5.0 ...",
        "ipLastSeen": "203.0.113.42",
        "createdAt": "2026-04-01T09:12:00Z",
        "lastUsedAt": "2026-04-23T18:07:00Z",
        "expiresAt": "2026-07-23T18:07:00Z"
      }
    ]
  }
]
```

### DELETE /api/admin/devices/:id

> 🔒 Admin requis

Déconnecte à distance un appareil spécifique (sans vérification d'appartenance). Journalisé dans `admin_logs` comme `device.revoke`.

**Réponse 200 :** `{ "success": true }` · **404 :** appareil introuvable ou déjà révoqué.

### DELETE /api/admin/users/:userId/devices

> 🔒 Admin requis

Déconnecte **tous** les appareils d'un utilisateur. Typiquement utilisé à l'offboarding ou après suspicion de compromission. Journalisé comme `device.revoke_all`.

**Réponse 200 :** `{ "success": true, "revoked": 3 }`

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
  "color": "#0078D4",
  "o2switchAutoSync": true
}
```

Quand `o2switchAutoSync` vaut `true` **ou** que `imapHost` se termine par `.o2switch.net`, le serveur pré-remplit automatiquement `caldav_url`, `caldav_username`, `caldav_sync_enabled`, `carddav_url`, `carddav_username`, `carddav_sync_enabled` selon le gabarit SabreDAV o2switch (`https://{cpanel}:2080/calendars/{email}/calendar` et `/addressbooks/{email}/addressbook`). Une première synchronisation CalDAV est déclenchée en arrière-plan dès qu'un utilisateur est assigné à cette boîte via `POST /api/admin/mail-accounts/:id/assignments`.

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

### POST /api/admin/calendars/import-caldav

Importe un calendrier distant via une URL CalDAV pour le compte d'un utilisateur (utilisé par *Administration → Gestion des calendriers → Ajouter via CalDAV*).

**Body :**

```json
{
  "url": "https://colorant.o2switch.net:2080/calendars/user@example.com/calendar",
  "ownerId": "uuid-de-l-utilisateur",
  "username": "user@example.com",
  "password": "mot_de_passe_caldav",
  "color": "#0078D4"
}
```

- `username` / `password` sont optionnels à la première tentative.
- Si le serveur CalDAV répond `401` ou `403`, la route renvoie délibérément **HTTP 200** avec `{ ok: false, needsAuth: true, error: "Authentification requise" }` (ne pas renvoyer `401` ici : le client admin utilise un middleware global qui redirige automatiquement vers l'écran de connexion en cas de `401`, ce qui fermerait la session administrateur).
- Les calendriers distants sont dédoublonnés localement sur `(user_id, external_id, mail_account_id IS NULL)` puis leurs événements sont importés sur la fenêtre `[−1 mois ; +6 mois]` via l'upsert `ON CONFLICT (calendar_id, ical_uid) WHERE external_id IS NOT NULL`.

**Réponse 200 (succès) :**

```json
{ "ok": true, "calendars": 2, "events": 74 }
```

### POST /api/admin/nextcloud/test

Teste la connexion NextCloud avec des identifiants **explicites** (avant sauvegarde).

**Body :**
```json
{
  "url": "https://cloud.example.com",
  "username": "admin",
  "password": "password"
}
```

### GET /api/admin/nextcloud/status

Récupère la configuration actuelle **sans le mot de passe**.

**Réponse 200 :**
```json
{
  "enabled": true,
  "url": "https://cloud.example.com",
  "adminUsername": "ncadmin",
  "hasPassword": true,
  "autoProvision": true,
  "autoCreateCalendars": true,
  "syncIntervalMinutes": 15
}
```

### PUT /api/admin/nextcloud/config

Met à jour la configuration NextCloud. Le champ `adminPassword` est **chiffré** avant stockage.
Si `adminPassword` est omis, l'ancien mot de passe est conservé.

**Body :**
```json
{
  "enabled": true,
  "url": "https://cloud.example.com",
  "adminUsername": "ncadmin",
  "adminPassword": "app-password-here",
  "autoProvision": true,
  "autoCreateCalendars": true,
  "syncIntervalMinutes": 15
}
```

### POST /api/admin/nextcloud/test (sans body)

Teste la connexion avec la configuration **sauvegardée**.

### GET /api/admin/nextcloud/users

Liste tous les utilisateurs WebMail avec leur mapping NextCloud.

**Réponse 200 :**
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "nc_username": "user",
      "nc_active": true,
      "last_sync_at": "2025-01-15T12:00:00Z",
      "last_sync_error": null
    }
  ]
}
```

### POST /api/admin/nextcloud/users/:userId/provision

Crée un compte NextCloud pour l'utilisateur spécifié (mot de passe aléatoire).

### POST /api/admin/nextcloud/users/:userId/link

Lie un compte NextCloud existant. Le mot de passe est chiffré.

**Body :**
```json
{
  "ncUsername": "existing-nc-user",
  "ncPassword": "app-password-or-plain"
}
```

### DELETE /api/admin/nextcloud/users/:userId

Délie le compte NextCloud (le compte NC n'est pas supprimé côté NextCloud).

### POST /api/admin/nextcloud/users/:userId/sync

Déclenche une synchronisation immédiate (calendriers + contacts) pour l'utilisateur.

---

## Nextcloud Files (par utilisateur)

Pont minimal sur le drive Files de l'utilisateur courant, utilise par l'UI mail pour enregistrer une ou plusieurs pieces jointes dans un dossier Nextcloud (avec creation d'arborescence). Toutes les routes requierent que l'utilisateur soit lie a un compte NextCloud (table `nextcloud_users`). Les chemins sont **relatifs au drive Files** de l'utilisateur (`/remote.php/dav/files/<user>/`).

Les parametres `path` / `folderPath` sont systematiquement nettoyes cote serveur (suppression des `..` et `\`).

### GET /api/nextcloud/files/status

Indique si l'utilisateur courant a un compte NextCloud lie et utilisable.

**Reponse 200 :**
```json
{ "linked": true }
```

### GET /api/nextcloud/files/list?path=/Mail

Liste les enfants immediats d'un dossier (PROPFIND `Depth: 1`). La racine est `/`.

**Reponse 200 :**
```json
{
  "path": "/Mail",
  "items": [
    { "name": "Pieces jointes", "path": "/Mail/Pieces jointes", "isFolder": true },
    { "name": "rapport.pdf", "path": "/Mail/rapport.pdf", "isFolder": false, "size": 245312, "contentType": "application/pdf" }
  ]
}
```

**Erreurs :**
- `409 NextCloud not linked` — l'utilisateur n'a pas (ou plus) de compte NC actif.
- `500` — propage le code HTTP WebDAV en cas d'echec PROPFIND.

### POST /api/nextcloud/files/mkdir

Cree un dossier ou une arborescence complete (MKCOL recursif). Les segments deja existants sont ignores silencieusement.

**Body :**
```json
{ "path": "/Mail/2026/Factures/Mai" }
```

**Reponse 200 :**
```json
{ "ok": true, "path": "/Mail/2026/Factures/Mai" }
```

### POST /api/nextcloud/files/upload

Depose un fichier dans un dossier du drive utilisateur. Si le fichier existe deja et que `overwrite` n'est pas a `true`, un suffixe ` (2)`, ` (3)`, ... est ajoute automatiquement au nom.

**Body :**
```json
{
  "folderPath": "/Mail/2026/Factures/Mai",
  "filename": "facture-EDF.pdf",
  "contentType": "application/pdf",
  "contentBase64": "JVBERi0xLjQK...",
  "overwrite": false,
  "ensureFolder": true
}
```

- `ensureFolder` (defaut `false`) : si `true`, le serveur cree d'abord l'arborescence manquante avant l'upload.
- `overwrite` (defaut `false`) : si `true`, un fichier existant est remplace ; sinon, un nom unique est genere.
- Taille maximale du payload decode : **100 Mo**.

**Reponse 200 :**
```json
{ "ok": true, "path": "/Mail/2026/Factures/Mai/facture-EDF.pdf" }
```

**Erreurs :**
- `400 Invalid base64 payload` / `Empty file` — payload manquant ou invalide.
- `409 NextCloud not linked` — utilisateur sans compte NC actif.
- `413 File too large` — depasse 100 Mo.

---

## Partage de calendrier

> 🔒 Authentification requise pour toutes les routes sauf `/api/public/calendar/*`.
> Les partages NextCloud nécessitent un calendrier `nc_managed`. Les liens publics HTML/ICS fonctionnent pour **tous** les calendriers (locaux ou NextCloud).

### POST /api/calendar/:id/share

Partage un calendrier avec un utilisateur **interne** ou **externe**.

**Body (partage interne) :**
```json
{ "userId": "uuid", "permission": "read" }
```

**Body (invitation email) :**
```json
{ "email": "guest@example.com", "permission": "write" }
```

`permission` — valeurs granulaires acceptées :
- `"busy"` — disponibilités uniquement
- `"titles"` — titres et lieux
- `"read"` — tous les détails (lecture seule)
- `"write"` — lecture + écriture

> Pour les calendriers NextCloud, les niveaux `busy`, `titles` et `read` sont propagés comme `read` sur NC, et `write` comme `read-write`. Le filtrage détaillé est appliqué côté application et sur le flux public.

Si l'email passé en `email` n'existe pas dans les contacts de l'utilisateur, un contact est automatiquement créé (source `local`).

### DELETE /api/calendar/:id/share

Révoque un partage. Body : `{ "userId": "uuid" }` ou `{ "email": "..." }`.

### GET /api/calendar/:id/shares

Liste tous les partages du calendrier.

**Réponse 200 :**
```json
{
  "internal": [
    { "user_id": "uuid", "email": "...", "display_name": "...", "permission": "read", "nextcloud_share_id": "..." }
  ],
  "external": [
    { "share_type": "email", "recipient_email": "guest@example.com", "permission": "write" },
    {
      "share_type": "public_link",
      "public_token": "abc...",
      "public_url": "https://app/api/public/calendar/abc",
      "public_html_url": "https://app/api/public/calendar/abc",
      "public_ics_url": "https://app/api/public/calendar/abc.ics",
      "permission": "titles"
    }
  ]
}
```

### GET /api/contacts/directory/users

Annuaire interne utilisé par l'onglet « Au sein de votre organisation » du dialogue de partage.
Retourne les utilisateurs de l'application (hors utilisateur courant) avec leur éventuel compte NC lié.
Query : `q` (facultatif, filtre ILIKE sur email/display_name).

```json
[{ "id": "uuid", "email": "...", "display_name": "...", "avatar_url": null, "nc_username": "..." }]
```

### POST /api/calendar/:id/publish

Publie le calendrier en lecture seule via un lien public HTML + un flux iCal.

**Body :**
```json
{ "permission": "read" }
```

`permission` ∈ `"busy" | "titles" | "read"` — contrôle le niveau de détail exposé par les flux publics.

**Réponse 200 :**
```json
{
  "success": true,
  "publicUrl": "https://app.example.com/api/public/calendar/<token>",
  "htmlUrl":   "https://app.example.com/api/public/calendar/<token>",
  "icsUrl":    "https://app.example.com/api/public/calendar/<token>.ics",
  "token": "abc...",
  "permission": "read"
}
```

Un seul lien public par calendrier : un appel répété met à jour la permission et la `public_url` (upsert).
Si le calendrier est NC-managé, la publication NextCloud est aussi tentée en best-effort, mais l'URL retournée pointe toujours vers l'application (pas vers l'interface WebDAV de NextCloud).

### PATCH /api/calendar/:id/publish

Met à jour uniquement la permission d'un lien public déjà existant.

**Body :** `{ "permission": "busy" | "titles" | "read" }`

### DELETE /api/calendar/:id/publish

Supprime le lien public (et dépublie côté NextCloud si applicable).

---

## Flux publics (non authentifiés)

> 🌐 Aucune authentification. Accès par `public_token` uniquement.

### GET /api/public/calendar/:token

Page HTML autonome du calendrier publié (viewer responsive clair/sombre). Affiche la liste des évènements à venir selon la permission associée au jeton, avec boutons « Télécharger .ics », « S'abonner » (`webcal://`) et « Copier le lien ».

### GET /api/public/calendar/:token.ics

Flux iCalendar (RFC 5545, `Content-Type: text/calendar`). Compatible style messagerie professionnelle, la plupart des calendriers. Les évènements sont filtrés selon la permission :
- `busy` → titre remplacé par « Occupé(e) », aucune autre donnée
- `titles` → titre et lieu uniquement
- `read` → toutes les propriétés

### GET /api/public/calendar/:token.json

Flux JSON (intégrations custom), mêmes règles de filtrage.

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

## Notifications push

Les endpoints ci-dessous permettent de gérer les abonnements **Web Push** (VAPID) depuis le client. Voir [docs/PWA.md](docs/PWA.md#notifications-push-natives) pour la vue d'ensemble et la configuration serveur.

Toutes les routes sauf `/api/push/public-key` nécessitent une authentification (elles utilisent le middleware global `/api/push`).

Deux services serveur déclenchent des notifications une fois la souscription active :

- **`newMailPoller`** — sonde IMAP toutes les 60 s et notifie les nouveaux messages.
- **`calendarReminderPoller`** — émet une notification ⏰ quand un événement avec `reminderMinutes` arrive à son horaire de rappel (`start_date - reminderMinutes ≤ NOW()`). Une colonne `reminder_sent_at` empêche les doublons ; elle est automatiquement réinitialisée si l'utilisateur modifie `startDate` ou `reminderMinutes` (trigger PostgreSQL `trg_reset_reminder_sent_at`). Les événements récurrents (`recurrenceRule`) ne sont pas gérés dans cette version.

### GET /api/push/public-key

Renvoie la clé publique VAPID nécessaire pour créer une souscription côté navigateur.

**Réponse :**
```json
{
  "publicKey": "BMxj...base64url..."
}
```

**Erreur `503`** si le service push n'a pas pu s'initialiser au boot (voir logs serveur).

### POST /api/push/subscribe

Enregistre (ou met à jour si l'`endpoint` existe déjà) la souscription d'un appareil pour l'utilisateur authentifié.

**Body :**
```json
{
  "endpoint": "https://fcm.googleapis.com/fcm/send/...",
  "keys": {
    "p256dh": "BDxF...",
    "auth": "u3h..."
  },
  "userAgent": "Mozilla/5.0 ...",
  "platform": "windows"
}
```

`platform` : `windows` | `mac` | `android` | `ios` | `linux` | `other` (détecté côté client).

**Réponse :** `{ "ok": true }`

### POST /api/push/unsubscribe

Supprime la souscription identifiée par son `endpoint`.

**Body :**
```json
{ "endpoint": "https://fcm.googleapis.com/fcm/send/..." }
```

**Réponse :** `{ "ok": true }`

### POST /api/push/test

Envoie une notification de test à tous les appareils actuellement enregistrés pour l'utilisateur. La notification utilise les mêmes options enrichies que les notifications réelles (`requireInteraction`, `renotify`, boutons d'action `Ouvrir` / `Ignorer`, `vibrate`), afin que le test reflète fidèlement le rendu final sur chaque plateforme.

**Réponse :**
```json
{ "ok": true, "sent": 2 }
```

`sent` indique le nombre d'appareils ayant reçu la notification (les abonnements expirés sont purgés silencieusement).

### GET /api/push/subscriptions

Liste les appareils actuellement enregistrés pour l'utilisateur (pour affichage dans les paramètres).

**Réponse :**
```json
[
  {
    "id": "uuid",
    "endpoint": "https://...",
    "user_agent": "Mozilla/5.0 ...",
    "platform": "android",
    "enabled": true,
    "created_at": "2026-04-22T08:00:00Z",
    "last_used_at": "2026-04-22T09:30:00Z"
  }
]
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

> 💡 Pour recevoir les notifications **même lorsque l'application est fermée** (mobile en arrière-plan, onglet inactif, etc.), utilisez en complément les [notifications push natives](#notifications-push). Le serveur les envoie en parallèle via le helper `notifyWithPush()`.

### Messages reçus

```json
{
  "type": "new-mail",
  "data": {
    "accountId": "uuid",
    "folder": "INBOX",
    "uid": 1235,
    "subject": "Nouveau message",
    "from": { "address": "marie@example.com", "name": "Marie" }
  },
  "timestamp": "2026-04-22T10:00:00Z"
}
```

Types de notifications :
| Type | Description |
|------|-------------|
| `new-mail` | Nouvel email reçu (émis par le sondeur IMAP périodique) |
| `email_flags` | Drapeaux modifiés |
| `calendar_event` | Événement modifié |
| `plugin_result` | Résultat d'une action plugin |
