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
- [Listes de distribution](#administration--listes-de-distribution)
- [Calendrier](#calendrier)
- [Paramètres](#paramètres)
- [Modèles de mail](#modèles-de-mail)
- [Notes](#notes)
- [Courrier indésirable](#courrier-indésirable)
- [Administration](#administration)
- [Nextcloud Files](#nextcloud-files-par-utilisateur)
- [Dashboard](#dashboard)
- [Logs d'audit](#logs-daudit)
- [O2Switch cPanel](#o2switch-cpanel)
- [Plugins](#plugins)
- [Recherche unifiée](#recherche)
- [Synchronisation du cache](#synchronisation-du-cache)
- [Sauvegarde & restauration](#sauvegarde--restauration-admin)
- [Notifications push](#notifications-push)
- [LDAP](#ldap-admin)
- [SSO / OpenID Connect](#sso--openid-connect-admin)
- [Connexion Windows (Kerberos)](#connexion-windows-kerberos)
- [Assistant IA (Ollama)](#assistant-ia-ollama)
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

**Erreurs :**
- `403` — Inscription désactivée (`allow_registration = false`) ou domaine non autorisé (voir paramètre admin `registration_allowed_domains`).
- `409` — Email déjà utilisé.

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

### POST /api/auth/forgot-password

Demande de réinitialisation du mot de passe par l'utilisateur (auto-service). Nécessite que le paramètre admin `login_forgot_password` soit activé.

**Body :**
```json
{ "email": "user@example.com" }
```

**Réponse 200 :**
```json
{ "message": "Si un compte existe avec cet email, un lien de réinitialisation vous a été envoyé. Vérifiez également vos courriers indésirables." }
```

> La réponse est **toujours identique** que l'adresse email existe ou non, afin d'éviter l'énumération d'adresses. Si le compte existe et que le SMTP est configuré, un email est envoyé via le template `password_reset` avec un lien valable 24 h. Tout token précédent non consommé pour cet utilisateur est invalidé.

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
Un cookie `wm_refresh` (httpOnly, SameSite=Strict, scope `/api/auth`, TTL 90 j glissant) est également posé, ainsi qu'un cookie d'identité d'appareil `wm_device` (httpOnly, SameSite=Lax, scope `/api/auth`, TTL 1 an, prolongé à chaque login/refresh, jamais effacé au logout) qui sert à l'alerte « connexion depuis un appareil inconnu » : appareil connu = cookie enregistré pour l'utilisateur (table `known_devices`, hash SHA-256), sinon repli nom d'appareil + même sous-réseau IP.

**Réponse 200 (compte avec passkey enrôlée — 2FA obligatoire) :**
```json
{
  "requires2FA": true,
  "pendingToken": "eyJhbGciOi...",
  "userId": "uuid"
}
```
Aucun cookie n'est posé à ce stade. Le client doit poursuivre avec `/api/auth/webauthn/login/options` puis `/verify` en passant le `pendingToken` (validité 5 min).

**Erreur 401 :** Identifiants invalides (ou compte verrouillé — `423`)
**Erreur 403 :** IP blacklistée ou compte désactivé

> Cet endpoint génère un log d'audit (catégorie `auth`) : `user.login` en cas de succès, `user.login_failed` en cas d'échec, `user.login_blocked` si l'IP est blacklistée ou le compte verrouillé.

### POST /api/auth/logout

Déconnexion — révoque le refresh token du device courant, détruit la session legacy et efface les cookies de session (`wm_refresh`, `connect.sid`). Le cookie d'identité d'appareil `wm_device` est volontairement conservé : l'appareil reste « connu » entre deux sessions.

**Réponse 200 :** `{ "message": "Déconnecté" }`

> Génère un log d'audit `user.logout` (catégorie `auth`).

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

### GET /api/mail/accounts/:accountId/folders/status

Renvoie les compteurs `STATUS` IMAP (`messages` / `unseen` / `recent`) pour **tous les dossiers sélectionnables** d'un compte, en une seule connexion IMAP. Utilisé par le volet « Dossiers » pour afficher les indicateurs de mails non lus (compteur, nom en gras, pastille rouge).

**Query params :**
- `refresh=1` (optionnel) : ignore le cache mémoire et force une nouvelle interrogation IMAP.

**Réponse 200 (succès) :**
```json
{
  "folders": {
    "INBOX": { "messages": 150, "unseen": 12, "recent": 0 },
    "INBOX.Sent": { "messages": 89, "unseen": 0, "recent": 0 },
    "INBOX.Archives": { "messages": 1240, "unseen": 0, "recent": 0 }
  },
  "cached": false
}
```

**Réponse 200 (échec d'auth IMAP — token OAuth expiré, mot de passe changé, etc.) :**
```json
{ "folders": {}, "cached": false, "failed": true, "reason": "auth" }
```

**Notes :**
- Les dossiers portant les flags `\Noselect` ou `\NonExistent` (conteneurs Gmail, etc.) sont ignorés.
- Les erreurs par dossier sont silencieusement avalées — un seul dossier en erreur ne casse pas le listing global.
- Cache mémoire serveur de **20 s** par couple `(userId, accountId)` en cas de succès, **5 min** en cas d'échec d'auth IMAP, pour ne pas marteler le serveur distant.
- Côté client, requête activée uniquement si l'utilisateur a activé au moins un indicateur de mails non lus dans Paramètres → Apparence ou dans le ruban *Afficher → Non lus*.

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

Liste toutes les listes de distribution accessibles à l'utilisateur : listes dont il est propriétaire (non supprimées) + listes partagées avec lui directement ou via un groupe.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "user_id": "uuid-owner",
    "name": "Restauration Responsable",
    "description": "Équipe restauration",
    "members": [
      { "email": "alice@example.com", "name": "Alice" },
      { "email": "bob@example.com", "name": "Bob" }
    ],
    "shared_with": [
      { "type": "user", "id": "uuid", "display": "Jean Dupont" }
    ],
    "is_deleted": false,
    "created_by": "uuid-owner",
    "owner_email": "owner@example.com",
    "owner_name": "Propriétaire"
  }
]
```

### POST /api/contacts/distribution-lists

Crée une liste de distribution. Les adresses e-mail des membres qui n'existent pas encore dans les contacts sont automatiquement créées comme contacts locaux.

**Body :**
```json
{
  "name": "Restauration Responsable",
  "description": "Équipe restauration (optionnel)",
  "members": [
    { "email": "alice@example.com", "name": "Alice" },
    { "email": "bob@example.com" }
  ]
}
```

**Réponse 201 :** objet liste créé.

### PUT /api/contacts/distribution-lists/:id

Met à jour une liste. Le propriétaire peut modifier tous les champs (y compris `sharedWith`). Un utilisateur avec qui la liste est partagée peut modifier `name`, `description` et `members`, mais pas `sharedWith`.

**Body (tous les champs sont optionnels) :**
```json
{
  "name": "Nouveau nom",
  "description": "Nouvelle description",
  "members": [{ "email": "carol@example.com", "name": "Carol" }],
  "sharedWith": [{ "type": "user", "id": "uuid", "display": "Jean" }]
}
```

### DELETE /api/contacts/distribution-lists/:id

**Suppression douce** (soft delete) : la liste est marquée `is_deleted = true` et disparaît pour l'utilisateur. Elle reste visible et récupérable par les administrateurs via le panneau d'administration.

**Réponse 200 :** `{ "success": true }`

### POST /api/contacts/distribution-lists/:id/share

Partage la liste avec des utilisateurs et/ou des groupes (propriétaire uniquement). Remplace entièrement la liste `shared_with`.

**Body :**
```json
{
  "sharedWith": [
    { "type": "user",  "id": "uuid-user",  "display": "Jean Dupont" },
    { "type": "group", "id": "uuid-group", "display": "Équipe RH" }
  ]
}
```

**Réponse 200 :** objet liste mis à jour.

---

## Administration — Listes de distribution

> 🔒 Rôle `admin` requis

### GET /api/admin/distribution-lists

Liste toutes les listes de la plateforme avec filtres.

| Paramètre | Type | Description |
|-----------|------|-------------|
| `search` | string | Filtre sur le nom de la liste ou l'email/nom du propriétaire. |
| `userId` | UUID | Filtre sur le propriétaire. |
| `includeDeleted` | boolean | Si `true`, inclut les listes supprimées (soft-deleted). |

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "name": "Restauration Responsable",
    "description": "...",
    "members": [...],
    "shared_with": [...],
    "is_deleted": false,
    "owner_email": "owner@example.com",
    "owner_name": "Propriétaire",
    "member_count": 5
  }
]
```

### PUT /api/admin/distribution-lists/:id

Modifie n'importe quelle liste (surcharge admin, sans vérification de propriété).

**Body :** identique à `PUT /api/contacts/distribution-lists/:id`.

### DELETE /api/admin/distribution-lists/:id

**Suppression définitive** (hard delete) — irréversible.

**Réponse 200 :** `{ "success": true }`

### POST /api/admin/distribution-lists/:id/share

Partage n'importe quelle liste avec des utilisateurs/groupes (y compris une liste dont l'utilisateur a été re-partagée après soft-delete).

**Body :** identique à `POST /api/contacts/distribution-lists/:id/share`.

### POST /api/admin/distribution-lists/:id/restore

Restaure une liste soft-deleted (`is_deleted` → `false`).

**Réponse 200 :** objet liste restauré.

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

## Notes

> 🔒 Authentification requise

Bloc-notes personnel, alimenté par le panneau **Insérer → Notes & fichiers** de la fenêtre de composition et par la grande modale « Notes & fichiers » de la barre du haut. Contrairement aux modèles de mail, une note **n'est jamais partagée** : elle appartient à un seul utilisateur, et toutes les routes filtrent sur `user_id`.

Le champ `contentHtml` est **assaini côté serveur** avec la même liste blanche que les modèles de mail (pas de `<script>`, pas de `style` hors attributs autorisés) — une note finit dans le corps d'un e-mail, elle en respecte les contraintes. À chaque écriture, le serveur recalcule `contentText`, la projection texte du HTML, qui alimente la recherche plein texte et l'extrait affiché en liste.

### GET /api/notes

Liste les notes de l'utilisateur, **épinglées d'abord**, puis les plus récemment modifiées.

**Paramètres de requête :**

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| `q` | — | Filtre plein texte sur le titre et le contenu. Combine `websearch_to_tsquery('french', …)` et un repli `ILIKE %q%`, pour que la recherche réponde aussi sur un mot partiel pendant la frappe (`factur` trouve `facture`). |
| `limit` | `200` | Nombre maximum de notes renvoyées (borné à `500`). |

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "title": "Coordonnées service technique",
    "contentHtml": "<p>Tel : 02 …</p>",
    "contentText": "Tel : 02 …",
    "color": "yellow",
    "tags": [],
    "isPinned": true,
    "sourcePath": null,
    "createdAt": "2026-…",
    "updatedAt": "2026-…"
  }
]
```

`color` vaut `default`, `yellow`, `green`, `blue`, `pink`, `purple` ou `orange`. `sourcePath` porte le chemin Nextcloud d'origine quand la note a été créée par *Enregistrer comme note* depuis un fichier ; `null` sinon.

### GET /api/notes/:id

Renvoie une note. `404 Note introuvable` si elle n'existe pas **ou** si elle appartient à un autre utilisateur (aucune distinction, pour ne pas révéler l'existence de la note).

### POST /api/notes

Crée une note.

**Body :**
```json
{
  "title": "Coordonnées service technique",
  "contentHtml": "<p>Tel : 02 …</p>",
  "color": "yellow",
  "tags": [],
  "isPinned": false,
  "sourcePath": "/Documents/annuaire.docx"
}
```

Tous les champs sont optionnels. **Si `title` est vide, le serveur le déduit** de la première ligne non vide du contenu (tronquée à 120 caractères), ou retombe sur `Note sans titre` — le panneau latéral s'en sert pour créer une note en une frappe, sans demander de titre.

**Réponse 201 :** la note créée (même forme que `GET /api/notes`).

### PUT /api/notes/:id

Met à jour une note. **Tous les champs sont optionnels et seuls ceux fournis sont écrits** : un simple « épingler » n'a pas besoin de renvoyer le corps, et ne le repasse donc pas au sanitizer.

**Body (exemple, épinglage seul) :**
```json
{ "isPinned": true }
```

### DELETE /api/notes/:id

Supprime définitivement une note. `404` si elle n'appartient pas à l'utilisateur.

**Réponse 200 :**
```json
{ "ok": true }
```

**Limites :**
- `contentHtml` : 500 000 caractères max.
- `title` : 255 caractères max. `tags` : 20 entrées de 40 caractères max.

---

## Courrier indésirable

> 🔒 Authentification requise

Trois sources de décision, appliquées **dans cet ordre** :

1. **Expéditeurs autorisés** (liste personnelle, liste globale de l'admin, et les contacts si l'option `trustContacts` est active) — un expéditeur autorisé n'est **jamais** classé indésirable, quel que soit le verdict du serveur. C'est le garde-fou qui rend la fonction utilisable sans crainte de perdre un message important.
2. **Expéditeurs bloqués** (liste personnelle + liste globale) — décision explicite, appliquée telle quelle.
3. **En-têtes du filtre antispam du serveur** (SpamAssassin, Rspamd, Exchange…), selon le niveau choisi.

Une même valeur ne peut pas être simultanément bloquée et autorisée : l'ajouter dans une liste la retire automatiquement de l'autre, sans quoi la règle « autorisé gagne toujours » rendrait le blocage silencieusement inopérant.

Les motifs sont normalisés en minuscules : `jean@exemple.fr` (`kind: "address"`) ou `exemple.fr` (`kind: "domain"`, stocké **sans** `@`). Les saisies `@exemple.fr` et `Jean Dupont <jean@exemple.fr>` sont acceptées et normalisées.

**Niveaux du filtre serveur :**

| Niveau | Comportement |
|--------|--------------|
| `off` | Les en-têtes du serveur sont ignorés ; seules les listes s'appliquent. |
| `normal` | Classe indésirable si `X-Spam-Flag: YES` ou si le score ≥ **5**. |
| `strict` | Idem, seuil de score abaissé à **3**. |

Le drapeau prime sur le score : SpamAssassin ne pose `X-Spam-Flag: YES` qu'au-delà du seuil configuré sur le serveur lui-même, le niveau ne sert donc qu'à **durcir** cette décision, jamais à l'assouplir. Le score est extrait de `X-Spam-Status` (`score=…`), à défaut de `X-Spam-Score`, à défaut du nombre d'étoiles de `X-Spam-Level`.

### GET /api/junk/settings

**Réponse 200 :**
```json
{
  "featureEnabled": true,
  "customized": false,
  "settings": { "enabled": true, "serverFilter": "normal", "trustContacts": true, "purgeDays": 30 },
  "defaults": { "enabled": true, "serverFilter": "normal", "trustContacts": true, "purgeDays": 30 }
}
```

`featureEnabled` reflète l'interrupteur global de l'administrateur : à `false`, l'onglet disparaît des préférences et plus rien n'est classé automatiquement. `customized` vaut `false` tant que l'utilisateur n'a jamais enregistré de réglage — il hérite alors de `defaults`, et une modification des valeurs par défaut côté admin le suit.

### PUT /api/junk/settings

**Body** (tous les champs obligatoires) :
```json
{ "enabled": true, "serverFilter": "strict", "trustContacts": true, "purgeDays": 30 }
```

`purgeDays` (0–365) vide le dossier indésirable des messages plus anciens — **suppression définitive**, `0` désactive. `enabled: false` conserve les listes mais arrête tout déplacement automatique.

### GET /api/junk/senders

Paramètre optionnel `?type=blocked|safe`. Renvoie les entrées personnelles **et** globales.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "listType": "blocked",
    "kind": "domain",
    "pattern": "pub-exemple.fr",
    "global": false,
    "note": null,
    "hitCount": 12,
    "lastHitAt": "2026-…",
    "createdAt": "2026-…"
  }
]
```

`global: true` marque une entrée posée par un administrateur : elle s'applique en plus des listes de l'utilisateur, qui ne peut pas la retirer (`DELETE` répond `404`). `hitCount` compte les messages effectivement écartés par cette entrée.

### POST /api/junk/senders

```json
{ "listType": "blocked", "value": "jean@exemple.fr", "note": "démarchage" }
```

`kind` est déduit de `value`. `400` si la valeur n'est ni une adresse ni un domaine plausible (les domaines à label unique, type `localhost`, sont refusés).

### DELETE /api/junk/senders/:id

`404` si l'entrée n'existe pas, appartient à un autre utilisateur, ou est une entrée globale.

### POST /api/junk/block

Bloque un expéditeur et, si demandé, déplace **immédiatement** ses messages déjà présents. C'est le seul chemin par lequel des messages anciens sont déplacés : le service de fond, lui, ne touche qu'aux nouveaux.

```json
{
  "accountId": "uuid",
  "address": "jean@exemple.fr",
  "scope": "address",
  "sweep": true,
  "folder": "INBOX"
}
```

`scope` vaut `address` ou `domain`. Le balayage est ignoré si `folder` est déjà le dossier indésirable.

**Réponse 200 :**
```json
{ "success": true, "entry": { "…": "…" }, "moved": 14, "junkFolder": "INBOX.Junk" }
```

### POST /api/junk/not-junk

Le pendant symétrique : débloque l'adresse **et** son domaine, ajoute l'adresse aux autorisés (`addToSafe`, `true` par défaut) et remet le message en boîte de réception.

```json
{ "accountId": "uuid", "address": "jean@exemple.fr", "uid": 4211, "folder": "INBOX.Junk", "addToSafe": true }
```

`uid` et `address` sont tous deux optionnels : sans `uid` on se contente de débloquer, sans `address` on se contente de déplacer.

**Réponse 200 :** `{ "success": true, "unblocked": 1, "restored": true, "address": "jean@exemple.fr" }`

### POST /api/junk/unsubscribe

Désabonnement d'après l'en-tête `List-Unsubscribe` (RFC 2369) du message.

```json
{ "accountId": "uuid", "uid": 4211, "folder": "INBOX" }
```

**Réponse 200** — trois issues possibles :

| `outcome` | Signification |
|-----------|---------------|
| `done` | La démarche a été effectuée : POST *one-click* (`method: "one-click"`) quand l'expéditeur annonce `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), sinon e-mail envoyé à l'adresse `mailto:` depuis le compte concerné (`method: "mailto"`). |
| `open` | Seule une page web est proposée : `url` est renvoyée au client, qui l'ouvre dans un onglet — l'utilisateur termine lui-même (souvent un formulaire). |
| `none` | Le message ne propose aucun mécanisme de désabonnement. |

> 🔒 Le POST *one-click* est la **seule** requête sortante que le serveur émette vers une URL issue d'un e-mail. Elle réutilise la protection anti-SSRF du proxy d'images (résolution DNS filtrée + blocage des IP littérales privées/loopback/link-local). Toutes les autres cibles sont soit envoyées par SMTP, soit rendues au navigateur.

### POST /api/junk/sweep

Applique le filtre aux N derniers messages de la boîte de réception, à la demande — sans lui, un utilisateur qui vient d'activer le filtre ne verrait rien se passer avant le prochain message reçu.

```json
{ "accountId": "uuid", "limit": 100 }
```

`limit` : 1–200 (défaut `100`). Le balayage s'exécute même si le classement automatique est en veille (`enabled: false`), puisqu'il est déclenché explicitement.

**Réponse 200 :** `{ "success": true, "examined": 100, "moved": 3 }`

### POST /api/junk/explain

Renvoie le verdict qui serait rendu pour un expéditeur donné — sert à expliquer un classement en langage clair.

```json
{ "address": "jean@exemple.fr", "headers": { "X-Spam-Status": "Yes, score=7.3 required=5.0" } }
```

**Réponse 200 :** `{ "junk": true, "reason": "server-score", "detail": "score antispam 7.3" }`

`reason` vaut `blocked-address`, `blocked-domain`, `server-flag`, `server-score`, ou `null` quand le message n'est pas indésirable.

---

## Courrier indésirable *(admin)*

> 🔒 Authentification + rôle administrateur requis

### GET /api/admin/junk/settings

```json
{
  "featureEnabled": true,
  "defaults": { "enabled": true, "serverFilter": "normal", "trustContacts": true, "purgeDays": 30 },
  "globalCounts": { "blocked": 4, "safe": 2 }
}
```

### PUT /api/admin/junk/settings

```json
{
  "featureEnabled": true,
  "defaults": { "enabled": true, "serverFilter": "normal", "trustContacts": true, "purgeDays": 30 }
}
```

Les valeurs par défaut ne s'appliquent qu'aux utilisateurs n'ayant **jamais** enregistré leurs propres réglages : les modifier ne réécrit aucun choix existant. `featureEnabled: false` désactive la fonctionnalité pour tout le monde, quels que soient les réglages individuels.

### GET / POST / DELETE /api/admin/junk/senders

Mêmes formats que les routes utilisateur, mais les entrées créées sont **globales** (`user_id NULL`) : elles s'ajoutent aux listes de chaque utilisateur et y apparaissent en lecture seule.

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
  },
  "login_appearance": {
    "title": "WebMail",
    "subtitle": "Connectez-vous à votre messagerie",
    "backgroundColor": "#0078d4",
    "backgroundImage": null,
    "backgroundBlur": 0,
    "backgroundOverlay": null,
    "cardBgColor": "#ffffff",
    "cardTextColor": "#323130",
    "accentColor": "#0078d4",
    "accentHoverColor": null,
    "showRegister": true,
    "showPasskeyButton": true,
    "showForgotPassword": false
  }
}
```

Le champ `custom.<type>` indique si un fichier personnalisé a été téléversé (`true`) ou si l'icône par défaut du bundle est servie (`false`). Le suffixe `?v=...` dans les URLs est un hash du `mtime` du fichier côté serveur pour forcer le rafraîchissement lorsqu'un admin remplace l'image.

`login_appearance.showForgotPassword` — contrôle l'affichage du lien « Mot de passe oublié ? » sur la page de connexion. Configurable dans *Admin → Apparence connexion*.

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
    "oauth_provider": null,
    "oauth_status": "ok",
    "oauth_last_error": null,
    "oauth_last_error_at": null,
    "oauth_token_expires_at": null,
    "oauth_last_refresh_at": null,
    "created_at": "2026-04-21T10:00:00Z"
  }
]
```

Les champs `oauth_*` ne sont renseignés que pour les boîtes liées en OAuth (Microsoft 365). `oauth_status` vaut `ok`, `degraded` (échec passager, nouvelle tentative automatique), `needs_reauth` (jeton révoqué — la boîte doit être reconnectée) ou `config_error` (secret client Azure refusé — la cause est commune à tous les comptes). Voir [docs/CONFIGURATION.md](docs/CONFIGURATION.md#fiabilité-du-lien-oauth).

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

### GET /api/nextcloud/files/search?q=rapport

Recherche fichiers **et** dossiers dans tout le drive via l'API OCS Unified Search (Nextcloud 20+). Requête de 2 caractères minimum.

Utilisée par le sélecteur de pièces jointes et par l'onglet *Fichiers* du panneau **Notes & fichiers**. La portée dépend du fournisseur de recherche installé côté Nextcloud : **sans l'application *Full text search*, la recherche porte sur les noms de fichiers**, pas sur leur contenu.

**Réponse 200 :**
```json
{
  "items": [
    { "name": "rapport.pdf", "path": "/Mail/rapport.pdf", "isFolder": false, "size": 245312, "contentType": "application/pdf" }
  ]
}
```

**Erreurs :**
- `400 Query must be at least 2 characters`
- `409 NextCloud not linked`

### GET /api/nextcloud/files/search-folders?q=factures

Recherche **dossiers uniquement**, via `PROPFIND Depth: infinity` directement sur WebDAV. Contrairement à `/search`, elle ne dépend pas de l'index de recherche Nextcloud et trouve donc toujours les dossiers, quel que soit l'état de l'indexation. Requête de 2 caractères minimum.

**Réponse 200 :**
```json
{ "items": [ { "name": "Factures", "path": "/Mail/2026/Factures", "isFolder": true } ] }
```

### GET /api/nextcloud/files/get?path=/Mail/rapport.pdf

Télécharge un fichier du drive utilisateur et le renvoie encodé en base64.

Utilisée pour joindre un fichier Nextcloud à un message, et par le panneau **Notes & fichiers** qui en extrait ensuite le contenu **côté navigateur** (texte brut, `.docx` via *mammoth*, `.xlsx` via *xlsx*) — le serveur ne fait aucune conversion.

**Réponse 200 :**
```json
{ "filename": "rapport.pdf", "contentType": "application/pdf", "contentBase64": "JVBERi0xLjQK..." }
```

**Erreurs :**
- `400 Missing path`
- `409 NextCloud not linked`
- `413 File too large` — au-delà de 100 Mo. Le panneau Notes applique en plus un plafond client de **8 Mo** avant d'appeler cette route, l'extraction se faisant en mémoire dans l'onglet.

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
| `category` | string | — | Filtrer par catégorie (`auth`, `admin`, `mail`, `o2switch`, `calendars`, `security`, `system`) |
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

Recherche globale dans les emails mis en cache, les contacts et les événements de calendrier. La recherche e-mail s'effectue sur la table `cached_emails` en `ILIKE`, appuyée par des index trigrammes (`pg_trgm`).

> ⚠️ **Portée limitée aux en-têtes.** `cached_emails` ne contient ni corps ni pièces jointes : cette route ne peut trouver que sur l'objet, l'expéditeur et les destinataires. La recherche dans le **contenu** des messages est assurée côté client sur le cache local complet du poste (voir [Synchronisation du cache](#synchronisation-du-cache) et `docs/PWA.md`). L'interface n'appelle cette route qu'en repli, tant qu'un dossier de la portée demandée n'est pas entièrement rapatrié localement.

**Query params :**
| Paramètre | Type | Défaut | Description |
|-----------|------|--------|-------------|
| `q` | string | — | **Requis.** Terme de recherche (min. 2 caractères). Recherche dans objet et expéditeur du mail (**pas le corps**, voir l'avertissement ci-dessus) ; titre, description, lieu pour les événements ; nom, prénom, email, entreprise pour les contacts. |
| `type` | string | `all` | Portée : `all` \| `mail` \| `contacts` \| `events` |
| `limit` | number | `20` | Nombre maximum de résultats par type (max `100`) |
| `offset` | number | `0` | Décalage pour la pagination |
| `folder` | string | — | **Mail uniquement.** Chemin IMAP exact du dossier (ex. `INBOX`). Limite la recherche à ce dossier dans `cached_emails`. |
| `accountId` | UUID | — | **Mail uniquement.** Limite la recherche à ce compte mail. |
| `dateFrom` | string | — | **Mail / Événements.** Date de début au format `YYYY-MM-DD`. Pour les e-mails, filtre sur `date` ; pour les événements, filtre sur `start_date`. |
| `dateTo` | string | — | **Mail / Événements.** Date de fin au format `YYYY-MM-DD` (inclus jusqu'à 23:59:59). |
| `from` | string | — | **Mail uniquement.** Filtre sur le nom ou l'adresse de l'expéditeur (ILIKE). |
| `hasAttachment` | string | — | **Mail uniquement.** `true` = avec pièces jointes uniquement · `false` = sans pièces jointes uniquement. |
| `isRead` | string | — | **Mail uniquement.** `true` = lus uniquement · `false` = non lus uniquement. |
| `calendarId` | UUID | — | **Événements uniquement.** Limite la recherche à ce calendrier. |

**Réponse 200 :**
```json
{
  "emails": [
    {
      "id": "uuid",
      "uid": 1234,
      "subject": "Réunion de projet",
      "from_name": "Marie Durand",
      "from_address": "marie@example.com",
      "snippet": "Bonjour, je vous rappelle...",
      "date": "2026-05-14T10:30:00Z",
      "folder": "INBOX",
      "is_read": false,
      "is_flagged": false,
      "has_attachments": true,
      "account_id": "uuid"
    }
  ],
  "contacts": [
    {
      "id": "uuid",
      "email": "marie@example.com",
      "first_name": "Marie",
      "last_name": "Durand",
      "display_name": "Marie Durand",
      "company": "ACME Corp",
      "avatar_url": null
    }
  ],
  "events": [
    {
      "id": "uuid",
      "title": "Réunion d'équipe",
      "description": "Revue hebdomadaire",
      "start_date": "2026-05-20T14:00:00Z",
      "end_date": "2026-05-20T15:00:00Z",
      "location": "Salle B12",
      "calendar_name": "Personnel",
      "calendar_color": "#0078d4"
    }
  ],
  "totals": {
    "emails": 42,
    "contacts": 3,
    "events": 7
  }
}
```

> `totals` indique le nombre **total** de résultats pour chaque catégorie (avant application de `limit`/`offset`), utile pour l'affichage des compteurs et la pagination.

**Erreurs :**
- `200` avec tableaux vides — terme de recherche trop court (< 2 caractères).
- `500` — erreur base de données.

---

## Synchronisation du cache

> 🔒 Authentification requise

Primitives permettant au client d'entretenir son cache local complet (en-têtes **et** corps de tous les messages) sans tout retélécharger à chaque fois.

Ces routes sont **sans état côté serveur** : aucune table de synchronisation n'est créée ni maintenue. Le serveur répond « voici l'état actuel du dossier » ; c'est le client, qui détient l'état précédent dans IndexedDB, qui calcule la différence. Ce partage rend la synchronisation naturellement reprenable après interruption, et permet à plusieurs appareils du même utilisateur d'avancer à des rythmes différents sans interférer.

L'accès passe par `getAccountForUser` : possession directe, attribution de boîte et partage sont tous honorés.

### POST /api/sync/accounts/:accountId/state

Sonde bon marché : un `STATUS` IMAP par dossier, sur **une seule connexion**. C'est le point d'entrée de tout cycle de synchronisation.

**Body :** `{ "folders": ["INBOX", "Sent"] }` — facultatif ; omis, tous les dossiers sélectionnables sont renvoyés (ce qui permet aussi de découvrir un nouveau dossier).

**Réponse `200` :**
```json
{
  "folders": {
    "INBOX": { "uidValidity": "1418733411", "uidNext": 4507, "messages": 3204, "highestModseq": "98140" }
  }
}
```

`uidValidity` et `highestModseq` sont des **chaînes** : IMAP les expose en 64 bits, et les convertir en `Number` corromprait silencieusement les grandes valeurs. Comparez-les en chaîne. `highestModseq` n'est présent que si le serveur IMAP annonce CONDSTORE.

**Comment l'exploiter :** `uidNext` ne fait que croître. L'y voir inchangé prouve qu'aucun message n'a été ajouté ; combiné à un nombre de messages inchangé, cela exclut aussi toute suppression. Un `uidValidity` différent signifie que le dossier a été renuméroté — son cache local doit être purgé, **lui seul**.

### GET /api/sync/accounts/:accountId/uidflags

UID et drapeaux de **tous** les messages d'un dossier, en une commande.

**Query params :** `folder` (défaut `INBOX`).

**Réponse `200` :**
```json
{
  "uidValidity": "1418733411", "uidNext": 4507, "messages": 3204,
  "uids": [[4102, 3], [4103, 0], [4104, 1]]
}
```

Chaque couple est `[uid, masque]`, le masque combinant `1` Seen, `2` Flagged, `4` Answered, `8` Draft. Pour 10 000 messages cela pèse ~120 Ko, contre ~900 Ko avec des objets nommés — c'est ce qui rend supportable la vérification d'un dossier entier sans dépendre de CONDSTORE.

Le client en déduit par différence d'ensembles ce qui a été **supprimé** (UID connus absents de la réponse), **ajouté** (UID nouveaux) et **relu ailleurs** (masque différent).

### POST /api/sync/accounts/:accountId/envelopes

En-têtes d'un lot d'UID précis.

**Body :** `{ "folder": "INBOX", "uids": [4505, 4506] }` — **500 UID maximum**.

**Réponse `200` :** `{ "folder": "INBOX", "messages": [...] }`, où chaque élément a **exactement la forme** de ceux de `GET /api/mail/accounts/:id/messages`. C'est délibéré : un message servi depuis le cache local et un message servi par un listage direct doivent être indiscernables dans la liste.

### POST /api/sync/accounts/:accountId/bodies

Corps texte et HTML d'un lot d'UID, **sans les octets des pièces jointes**.

**Body :** `{ "folder": "INBOX", "uids": [4505] }` — **25 UID maximum** (le téléchargement se fait partie par partie).

**Réponse `200` :**
```json
{
  "folder": "INBOX",
  "bodies": [{
    "uid": 4505,
    "bodyText": "Bonjour…",
    "bodyHtml": "<p>Bonjour…</p>",
    "attachments": [{ "filename": "devis.pdf", "contentType": "application/pdf", "size": 84213, "inline": false }],
    "truncated": false
  }]
}
```

La route lit la `BODYSTRUCTURE` et ne rapatrie que les parties texte : sur un message de 8 Mo dont le corps fait 12 Ko, elle coûte 12 Ko. Les pièces jointes ne sont décrites que par leurs métadonnées ; leurs octets se récupèrent via `GET /api/mail/accounts/:id/messages/:uid`.

`truncated` vaut `true` au-delà de 512 Ko de texte pour une partie — au-delà, c'est du bruit pour l'indexation et du poids inutile.

> Cette extraction alimente le cache et l'index de recherche. **L'ouverture d'un message par l'utilisateur continue de passer par `GET /api/mail/accounts/:id/messages/:uid`**, qui rend fidèlement le message avec ses images inline. Une extraction imparfaite sur un message exotique dégrade donc la recherche, jamais l'affichage.

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

---

## Sauvegarde & restauration *(admin)*

Toutes les routes sont sous `/api/admin/backup` et nécessitent le rôle **admin**.
Les sauvegardes sont des fichiers `.json.gz` stockés dans `server/backups/` sur le serveur.

### GET /api/admin/backup/list

Liste toutes les sauvegardes enregistrées.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "filename": "backup_2026-05-12T02-00-00_auto.json.gz",
    "size_bytes": 204800,
    "type": "auto",
    "label": "Sauvegarde automatique",
    "created_at": "2026-05-12T02:00:00Z",
    "file_exists": true
  }
]
```

### POST /api/admin/backup/create

Crée une sauvegarde manuelle immédiate.

**Body :**
```json
{ "label": "Avant migration" }
```

**Réponse 200 :**
```json
{
  "id": "uuid",
  "filename": "backup_2026-05-12T15-30-00_manual.json.gz",
  "sizeBytes": 204800
}
```

### GET /api/admin/backup/download/:id

Télécharge le fichier de sauvegarde correspondant à l'identifiant.

**Réponse 200 :** Fichier binaire `.json.gz` (Content-Disposition: attachment).

**Erreurs :**
- `404` — Sauvegarde introuvable ou fichier absent du disque.

### DELETE /api/admin/backup/:id

Supprime une sauvegarde (fichier + entrée base de données).

**Réponse 200 :** `{ "success": true }`

### POST /api/admin/backup/restore

Restaure la base de données depuis un fichier de sauvegarde uploadé.
Toutes les données actuelles sont remplacées dans une transaction atomique.

**Body :** `multipart/form-data`

| Champ | Type | Requis | Description |
|---|---|---|---|
| `backup` | File | ✅ | Fichier `.json.gz` créé par cette application |
| `oldUrl` | string | — | URL du serveur source (ex. `https://mail.ancien.fr`) |
| `newUrl` | string | — | URL de ce serveur (ex. `https://mail.nouveau.fr`) |

Quand `oldUrl` et `newUrl` sont fournis :
- Toutes les valeurs de `admin_settings` contenant l'ancienne URL sont remplacées.
- Si le **hostname change**, les credentials WebAuthn (`webauthn_credentials`) sont
  supprimés car ils sont liés au domaine d'origine et bloqueraient la connexion.

**Réponse 200 :** `{ "success": true }`

**Erreurs :**
- `400` — Fichier manquant.
- `500` — Format invalide, fichier corrompu ou erreur de base de données (la transaction est annulée).

### GET /api/admin/backup/settings

Retourne la configuration de la sauvegarde automatique.

**Réponse 200 :**
```json
{
  "backup_auto_enabled": false,
  "backup_frequency": "daily",
  "backup_time": "02:00",
  "backup_day_of_week": 1,
  "backup_day_of_month": 1,
  "backup_retention_daily": 7,
  "backup_retention_weekly": 4,
  "backup_retention_monthly": 12,
  "backup_retention_yearly": 3,
  "backup_last_auto_run": "2026-05-12T02:00:00Z"
}
```

### PUT /api/admin/backup/settings

Met à jour la configuration de la sauvegarde automatique.

**Body :** Un ou plusieurs des champs ci-dessus (seuls les champs autorisés sont acceptés).

**Réponse 200 :** `{ "success": true }`

### GET /api/admin/backup/stats

Retourne le nombre de lignes par table et l'utilisation disque des sauvegardes.

**Réponse 200 :**
```json
{
  "table_counts": {
    "users": 12,
    "mail_accounts": 34,
    "contacts": 156
  },
  "disk_usage_bytes": 1048576,
  "backup_file_count": 8
}
```

---

## LDAP *(admin)*

Configuration et gestion de l'authentification LDAP. Tous les endpoints requièrent `is_admin = true`.

### GET /api/admin/ldap/settings

Retourne la configuration LDAP actuelle. Le mot de passe du compte de service est remplacé par `"__encrypted__"` s'il est enregistré.

**Réponse 200 :**
```json
{
  "ldap_enabled": false,
  "ldap_url": "ldap://192.168.1.10:389",
  "ldap_bind_dn": "cn=service,dc=example,dc=com",
  "ldap_bind_password": "__encrypted__",
  "ldap_base_dn": "dc=example,dc=com",
  "ldap_user_filter": "(mail={{email}})",
  "ldap_display_name_attr": "displayName",
  "ldap_admin_group_dn": "",
  "ldap_admin_group_names": "admin,administrateur,administrators,admins",
  "ldap_tls_reject_unauthorized": true,
  "ldap_fallback_local": false
}
```

---

### PUT /api/admin/ldap/settings

Enregistre la configuration LDAP. Le mot de passe n'est mis à jour que si une valeur différente de `"__encrypted__"` est fournie.

**Body :**
```json
{
  "ldap_enabled": true,
  "ldap_url": "ldaps://ldap.example.com:636",
  "ldap_bind_dn": "cn=service,dc=example,dc=com",
  "ldap_bind_password": "mot_de_passe_service",
  "ldap_base_dn": "dc=example,dc=com",
  "ldap_user_filter": "(mail={{email}})",
  "ldap_display_name_attr": "displayName",
  "ldap_admin_group_dn": "",
  "ldap_admin_group_names": "admin,administrateur",
  "ldap_tls_reject_unauthorized": true,
  "ldap_fallback_local": false
}
```

**Réponse 200 :** `{ "ok": true }`

---

### POST /api/admin/ldap/test

Teste la connexion au serveur LDAP avec les paramètres fournis (ou ceux sauvegardés si non fournis). N'enregistre rien.

**Body :** mêmes champs que `PUT /api/admin/ldap/settings` (tous optionnels, fusionnés avec la config sauvegardée).

**Réponse 200 (succès) :**
```json
{ "ok": true, "message": "Connexion réussie", "userCount": 42 }
```

**Réponse 200 (échec) :**
```json
{ "ok": false, "message": "ECONNREFUSED 192.168.1.10:389" }
```

---

### GET /api/admin/ldap/group-mappings

Liste les mappings manuels DN LDAP → groupe applicatif.

**Réponse 200 :**
```json
[
  {
    "id": "uuid",
    "ldap_dn": "cn=superadmins,ou=groups,dc=example,dc=com",
    "group_id": "uuid",
    "group_name": "Super Admins",
    "group_color": "#0078D4",
    "created_at": "2026-05-27T10:00:00Z"
  }
]
```

---

### POST /api/admin/ldap/group-mappings

Crée un mapping manuel. Si `groupId` est absent et `groupName` est fourni, le groupe applicatif est créé à la volée.

**Body :**
```json
{ "ldapDn": "cn=superadmins,ou=groups,dc=example,dc=com", "groupId": "uuid" }
```
ou (création à la volée) :
```json
{ "ldapDn": "cn=superadmins,ou=groups,dc=example,dc=com", "groupName": "Super Admins" }
```

**Réponse 201 :**
```json
{
  "id": "uuid",
  "ldap_dn": "cn=superadmins,ou=groups,dc=example,dc=com",
  "group_id": "uuid",
  "created_group": true
}
```

**Erreurs :**
- `400` — `ldapDn` manquant, ou ni `groupId` ni `groupName` fourni.
- `409` — Ce mapping existe déjà.

---

### DELETE /api/admin/ldap/group-mappings/:id

Supprime un mapping manuel.

**Réponse 200 :** `{ "ok": true }`

---

## SSO / OpenID Connect *(admin)*

Configuration de l'authentification unique via un fournisseur OIDC (Synology SSO Server, Keycloak, Azure AD…).

### GET /api/auth/sso/config

Endpoint **public** — retourne la configuration minimale pour la page de connexion (bouton SSO affiché ou non).

**Réponse 200 :**
```json
{ "enabled": true, "providerName": "Synology SSO" }
```

---

### GET /api/auth/sso/login

Démarre le flux OIDC Authorization Code. Redirige le navigateur vers la page d'authentification du fournisseur.

> Stocke `state` et `nonce` en session serveur pour validation au callback.

**Réponse :** `302 Redirect → {authorization_endpoint}?...`

**Erreurs :**
- `403` — SSO désactivé.
- `503` — URL du serveur ou Client ID manquant.
- `302 /login?sso_error=discovery_failed` — Serveur SSO inaccessible.

---

### GET /api/auth/sso/callback

Callback OIDC. Reçoit le code d'autorisation du fournisseur, l'échange contre des tokens, provisionne l'utilisateur et émet une session.

> Cet endpoint est appelé automatiquement par le fournisseur SSO — il ne doit pas être appelé manuellement.

**Flux :**
1. Vérifie `state` et `nonce` contre les valeurs de session.
2. Échange le code contre `access_token` + `id_token`.
3. Récupère les informations utilisateur (`email`, `name`) via `userinfo`.
4. Crée ou met à jour l'utilisateur en base (`email`, `display_name`).
5. Émet un device session + cookie `wm_refresh` (httpOnly).
6. Redirige vers `/?sso=1` — le client appelle `/api/auth/refresh` pour obtenir le JWT.

**Réponse succès :** `302 Redirect → /?sso=1`

**Erreurs (redirections) :**
- `302 /login?sso_error=callback_failed` — Erreur d'échange de code ou validation échouée.
- `302 /login?sso_error=no_email` — Le fournisseur n'a pas retourné d'adresse email.
- `302 /login?sso_error=account_disabled` — Le compte est désactivé dans l'application.

---

### GET /api/admin/sso/settings

Retourne la configuration SSO. Le Client Secret est remplacé par `"__encrypted__"` s'il est enregistré.

> Requiert `is_admin = true`.

**Réponse 200 :**
```json
{
  "sso_enabled": false,
  "sso_provider_name": "Synology SSO",
  "sso_issuer_url": "https://nas.local:5001/webman/sso",
  "sso_client_id": "mon-app-client-id",
  "sso_client_secret": "__encrypted__",
  "sso_redirect_uri": "",
  "sso_tls_reject_unauthorized": true
}
```

---

### PUT /api/admin/sso/settings

Enregistre la configuration SSO. Le Client Secret n'est mis à jour que si une valeur différente de `"__encrypted__"` est fournie.

> Requiert `is_admin = true`. Invalide le cache du client OIDC.

**Body :**
```json
{
  "sso_enabled": true,
  "sso_provider_name": "Synology SSO",
  "sso_issuer_url": "https://nas.local:5001/webman/sso",
  "sso_client_id": "mon-app-client-id",
  "sso_client_secret": "mon-client-secret",
  "sso_redirect_uri": "",
  "sso_tls_reject_unauthorized": true
}
```

**Réponse 200 :** `{ "success": true }`

---

### POST /api/admin/sso/test

Teste la connexion au serveur OIDC avec les paramètres fournis (ou ceux sauvegardés si non fournis). N'enregistre rien.

> Requiert `is_admin = true`.

**Body :** mêmes champs que `PUT /api/admin/sso/settings` (tous optionnels).

**Réponse 200 (succès) :**
```json
{
  "ok": true,
  "message": "Connexion au serveur SSO réussie",
  "issuer": "https://nas.local:5001/webman/sso",
  "authEndpoint": "https://nas.local:5001/webman/sso/SSOOauth.cgi"
}
```

**Réponse 200 (échec) :**
```json
{ "ok": false, "message": "connect ECONNREFUSED 192.168.1.10:5001" }
```

---

## Connexion Windows (Kerberos)

Authentification integree Windows via SPNEGO / Kerberos. Sur un poste joint au domaine, le
navigateur repond seul au defi `Negotiate` : aucune saisie utilisateur.

### GET /api/auth/kerberos/config

Endpoint **public** — indique a la page de connexion si elle doit proposer, voire tenter,
la connexion Windows.

`enabled` integre le filtre reseau evalue sur l'IP appelante : depuis une adresse hors des
plages autorisees, la reponse est `false` meme si la fonctionnalite est active.

**Reponse 200 :**
```json
{ "enabled": true, "autoLogin": true }
```

---

### GET /api/auth/kerberos/login

Handshake SPNEGO en deux temps, puis emission de session.

**Flux :**
1. Sans en-tete `Authorization`, repond `401` + `WWW-Authenticate: Negotiate`.
2. Le navigateur obtient un ticket aupres du KDC et rejoue la requete avec
   `Authorization: Negotiate <token>`.
3. Le serveur valide le ticket avec le keytab (**hors ligne**, sans contacter le KDC).
4. Le principal est resolu via LDAP (`{{sam}}` / `{{principal}}`) : email, nom, `memberOf`.
5. Provisionnement, synchronisation des groupes, puis device session + cookie `wm_refresh`.

**Reponse 200 :**
```json
{
  "token": "<access token>",
  "user": { "id": "…", "email": "jdupont@domaine.local", "displayName": "Jean Dupont", "isAdmin": false }
}
```
> En-tete `WWW-Authenticate: Negotiate <token>` renvoye pour l'authentification mutuelle.

**Erreurs :**

| Statut | `code` | Signification |
|--------|--------|---------------|
| `401` | `negotiate` | Etape normale du protocole : defi envoye au navigateur |
| `401` | `ntlm_rejected` | Le navigateur a propose NTLM — refuse volontairement |
| `401` | `context_incomplete` | Negociation multi-etapes non supportee |
| `401` | `spnego_failed` | Ticket invalide, expire, ou horloge decalee |
| `403` | `ip_blocked` | IP en liste noire |
| `403` | `ldap_no_match` | Aucun compte d'annuaire ne correspond au principal |
| `403` | `account_disabled` | Compte desactive dans l'application |
| `404` | `disabled` / `network_not_allowed` | Methode inactive, ou appelant hors des plages CIDR |
| `503` | `unavailable` | Module natif absent, keytab illisible ou SPN non configure |
| `503` | `no_user_mapping` | LDAP desactive et aucun domaine email de repli |

---

### GET /api/admin/kerberos/settings

Retourne les reglages Kerberos, plus un objet `_availability` (module charge, keytab trouve,
raison de l'indisponibilite le cas echeant). Aucun secret : le keytab est un fichier monte,
seul son chemin est stocke.

> Requiert `is_admin = true`.

---

### PUT /api/admin/kerberos/settings

Cles acceptees : `kerberos_enabled`, `kerberos_auto_login`, `kerberos_realm`, `kerberos_kdcs`,
`kerberos_service_principal`, `kerberos_keytab_path`, `kerberos_user_filter`,
`kerberos_email_domain`, `kerberos_allowed_cidrs`.

Le realm est normalise en majuscules et le SPN accepte les deux notations
(`HTTP/mail.domaine.local` comme `HTTP@mail.domaine.local`).

**Erreurs :** `400` — realm, SPN, CIDR invalides, ou filtre sans `{{sam}}` ni `{{principal}}`.

> Le chemin du keytab prend effet immediatement ; **le realm et les KDC exigent un redemarrage**
> du conteneur (libkrb5 ne relit pas son profil).

---

### POST /api/admin/kerberos/test

Diagnostic, dans l'ordre ou les choses cassent en pratique.

**Reponse 200 :**
```json
{
  "ok": false,
  "checks": [
    { "id": "module",  "label": "Module natif Kerberos", "ok": true,  "detail": "Charge" },
    { "id": "keytab",  "label": "Keytab", "ok": true, "detail": "Lisible : /etc/webmail/webmail.keytab" },
    { "id": "spn",     "label": "Cle de service (SPN)", "ok": true, "detail": "…" },
    { "id": "clock",   "label": "Horloge du serveur", "ok": false, "detail": "Decalage de 812 s — au-dela de 300 s le KDC rejette tous les tickets." },
    { "id": "mapping", "label": "Resolution des comptes", "ok": true, "detail": "Via LDAP, filtre (sAMAccountName={{sam}})" }
  ]
}
```

Le decalage d'horloge est mesure contre l'attribut `currentTime` du RootDSE de l'annuaire.

---

## Assistant IA (Ollama)

> 🔒 Authentification requise. Les routes `/api/ai/*` sont plafonnees a 30 requetes
> par tranche de 5 minutes **et par compte** : une generation occupe le serveur
> Ollama pendant plusieurs secondes.

L'URL du serveur Ollama et sa cle d'API eventuelle ne sortent jamais du backend.
Le client ne connait que l'etat renvoye par `/api/ai/status`.

### GET /api/ai/status

Etat de l'assistant pour l'utilisateur courant. Sert a afficher (ou masquer) les
boutons IA de l'interface.

**Reponse 200 :**
```json
{
  "enabled": true,
  "model": "llama3.2",
  "language": "fr",
  "features": { "summarize": true, "reply": true, "improve": true }
}
```

### POST /api/ai/summarize

**Body :**
```json
{ "subject": "Devis chantier", "from": "Marie Durand", "body": "Bonjour, …" }
```

**Reponse 200 :**
```json
{ "result": "Marie Durand demande…", "model": "llama3.2" }
```

### POST /api/ai/reply

**Body :**
```json
{
  "subject": "Devis chantier",
  "from": "Marie Durand",
  "body": "Bonjour, …",
  "tone": "professional",
  "instructions": "propose mardi 14 h"
}
```

`tone` : `professional` (defaut) | `formal` | `friendly` | `concise`.
`instructions` est facultatif — consigne libre de l'utilisateur pour cette reponse.

### POST /api/ai/improve

**Body :**
```json
{ "text": "je voudré confirmé le rdv de mardi", "style": "professional" }
```

`style` accepte les memes valeurs que `tone`.

**Erreurs communes aux trois actions :**

| Code | Cause |
|------|-------|
| 400 | Aucun texte a traiter |
| 403 | Fonction desactivee par l'administrateur |
| 404 | Modele absent du serveur Ollama |
| 503 | Assistant desactive |
| 504 | Ollama n'a pas repondu dans le delai configure |
| 502 | Serveur Ollama injoignable ou reponse illisible |

---

## Administration — Assistant IA

> 🔒 Administrateur requis

### GET /api/admin/ai/settings

Renvoie les cles `ai_*` de `admin_settings`. La cle d'API est remplacee par la
sentinelle `"__encrypted__"` — elle n'est jamais renvoyee en clair.

### PUT /api/admin/ai/settings

**Body (toutes les cles sont facultatives) :**
```json
{
  "ai_enabled": true,
  "ai_url": "http://host.docker.internal:11434",
  "ai_model": "llama3.2",
  "ai_api_key": "__encrypted__",
  "ai_language": "fr",
  "ai_temperature": 0.4,
  "ai_max_tokens": 800,
  "ai_timeout": 120,
  "ai_max_input_chars": 12000,
  "ai_feature_summarize": true,
  "ai_feature_reply": true,
  "ai_feature_improve": true
}
```

`ai_api_key` : la sentinelle `"__encrypted__"` laisse la cle existante intacte, une
chaine vide la supprime, toute autre valeur est chiffree puis stockee.

**Erreurs :** `400` si l'URL n'est pas un `http(s)://` valide, ou si `ai_enabled`
passe a `true` sans modele.

### POST /api/admin/ai/models

Liste les modeles presents sur le serveur Ollama (`GET /api/tags` cote Ollama).
Le body accepte `ai_url`, `ai_model`, `ai_api_key`, `ai_timeout` pour tester une
configuration **non encore enregistree** ; ce qui manque est repris de la base.

**Reponse 200 :**
```json
{
  "ok": true,
  "models": [
    { "name": "llama3.2:latest", "size": 2019393189, "parameterSize": "3.2B", "quantization": "Q4_K_M", "modifiedAt": "2026-08-01T09:12:44Z" }
  ]
}
```

### POST /api/admin/ai/test

Diagnostic complet, execute **depuis le serveur applicatif** : joignabilite,
modeles disponibles, presence du modele selectionne, puis une generation reelle.
Meme body que `/api/admin/ai/models`.

**Reponse 200 :**
```json
{
  "ok": false,
  "checks": [
    { "id": "reach",    "label": "Serveur Ollama joignable", "ok": true,  "detail": "http://…:11434 — version 0.6.2" },
    { "id": "models",   "label": "Modeles telecharges", "ok": true, "detail": "llama3.2:latest, mistral:latest" },
    { "id": "model",    "label": "Modele selectionne (phi3.5)", "ok": false, "detail": "Absent — lancez : ollama pull phi3.5" }
  ],
  "models": []
}
```

Le diagnostic s'arrete a la premiere etape en echec : les suivantes n'auraient
rien de fiable a dire.

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
