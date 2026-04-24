# Configuration

Guide complet de configuration de WebMail.

## Variables d'environnement

Toutes les variables sont définies dans le fichier `.env` à la racine du projet.

### Variables obligatoires

| Variable | Description | Exemple |
|----------|-------------|---------|
| `DATABASE_URL` | URL de connexion PostgreSQL | `postgresql://webmail:pwd@db:5432/webmail` |
| `DB_PASSWORD` | Mot de passe PostgreSQL | `mot_de_passe_fort` |
| `SESSION_SECRET` | Clé secrète pour les sessions (min 64 car.) | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Clé de chiffrement des mots de passe mail (min 32 car.) | `openssl rand -hex 16` |

### Variables optionnelles

| Variable | Description | Défaut |
|----------|-------------|--------|
| `PORT` | Port d'écoute du serveur | `3000` |
| `NODE_ENV` | Environnement d'exécution | `production` |
| `DEFAULT_IMAP_PORT` | Port IMAP par défaut | `993` |
| `DEFAULT_SMTP_PORT` | Port SMTP par défaut | `465` |

### Variables NextCloud

> Depuis la V2, la configuration NextCloud se fait **exclusivement via l'UI Admin → NextCloud**
> (URL, compte admin, app password, provisioning auto, intervalle de sync). Les valeurs sont
> chiffrées en base avec `ENCRYPTION_KEY`. Les anciennes variables `NEXTCLOUD_URL` /
> `NEXTCLOUD_USERNAME` / `NEXTCLOUD_PASSWORD` / `NEXTCLOUD_ENABLED` sont **obsolètes**.
> Voir [NEXTCLOUD.md](NEXTCLOUD.md) pour le guide complet.

### Variables Notifications push (optionnelles)

Voir [docs/PWA.md](PWA.md#notifications-push-natives) pour le guide complet. Si les clés VAPID ne sont pas fournies, elles sont **générées automatiquement** au premier démarrage et persistées en base (table `admin_settings`).

| Variable | Description | Défaut |
|----------|-------------|--------|
| `VAPID_PUBLIC_KEY` | Clé publique VAPID (Web Push) | *(auto-générée)* |
| `VAPID_PRIVATE_KEY` | Clé privée VAPID (Web Push) | *(auto-générée)* |
| `VAPID_CONTACT` | Contact d'administrateur (format `mailto:` ou URL) transmis aux services push | `mailto:admin@example.com` |
| `NEW_MAIL_POLL_INTERVAL_MS` | Intervalle (ms) du sondeur IMAP pour détecter les nouveaux mails. Minimum 30000. | `60000` |

Pour générer manuellement une paire de clés :

```bash
npx web-push generate-vapid-keys
```

Les valeurs obtenues peuvent être collées telles quelles dans `.env` (formats base64url).

### Variables client (build-time, préfixe `VITE_`)

Ces variables sont injectées dans le bundle au moment du build du client (`cd client && npm run build`). Elles doivent donc être présentes lors du build Docker.

| Variable | Description | Défaut |
|----------|-------------|--------|
| `VITE_GIPHY_API_KEY` | Clé API GIPHY utilisée par le panneau GIF de la rédaction | *(non défini)* |

---

## Clé API GIPHY

Le panneau **GIF** du ruban Insérer utilise l'[API publique GIPHY](https://developers.giphy.com/). Une clé API est requise.

### Obtenir une clé

1. Créer un compte gratuit sur <https://developers.giphy.com/>.
2. Créer une application de type **API** (et non SDK).
3. Copier la clé générée (format alphanumérique, ~32 caractères).

### Configurer la clé

Deux méthodes au choix :

- **Au build (recommandé pour le déploiement)** : définir la variable `VITE_GIPHY_API_KEY` dans le fichier `.env` avant le build du client. Elle sera compilée dans le bundle.
  ```
  VITE_GIPHY_API_KEY=votre_cle_giphy
  ```
- **Au runtime (par utilisateur, pour les tests)** : ouvrir le panneau GIF depuis l'onglet Insérer, saisir la clé dans le formulaire affiché. Elle est stockée dans `localStorage` sous la clé `giphyApiKey` et peut être réinitialisée depuis le pied du panneau.

La clé saisie dans `localStorage` prend le pas sur la variable d'environnement.

### Limites et conformité

- GIPHY applique des quotas sur la clé (voir le tableau de bord développeur).
- Le contenu est filtré en `rating=pg-13` côté client.
- L'attribution « powered by GIPHY » est affichée dans l'en-tête du panneau, conformément aux conditions d'utilisation GIPHY.

---

## Configuration initiale

### 1. Copier le fichier exemple

```bash
cp .env.example .env
```

### 2. Générer les secrets

```bash
# Sous Linux / macOS
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)
DB_PASSWORD=$(openssl rand -base64 24)

# Sous Windows (PowerShell)
$SESSION_SECRET = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
$ENCRYPTION_KEY = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
```

### 3. Fichier .env complet

```env
# ===== Base de données =====
DB_PASSWORD=votre_mot_de_passe_bdd
DATABASE_URL=postgresql://webmail:votre_mot_de_passe_bdd@db:5432/webmail

# ===== Sécurité =====
SESSION_SECRET=votre_cle_session_64_caracteres
ENCRYPTION_KEY=votre_cle_chiffrement_32_caracteres

# ===== Serveur =====
PORT=3000
NODE_ENV=production

# ===== Ports mail par défaut =====
DEFAULT_IMAP_PORT=993
DEFAULT_SMTP_PORT=465

# ===== OAuth2 Microsoft (Outlook / Microsoft 365) =====
# Requis pour connecter les comptes Microsoft 365 avec MFA (Authenticator).
# Ces variables sont PRIORITAIRES sur les valeurs saisies dans l'UI Admin
# (Administration → Comptes mail → Configuration OAuth Microsoft).
# Vous pouvez les définir dans Portainer / docker-compose pour verrouiller la
# configuration en production. Laissez-les vides pour piloter la config
# uniquement via l'UI.
#
# Créez une App Registration sur https://entra.microsoft.com (gratuit même
# sans entreprise, avec un simple compte Microsoft perso) :
#  - Supported account types : « Accounts in any organizational directory and personal Microsoft accounts »
#  - Redirect URI (Web) : {PUBLIC_URL}/api/admin/mail-accounts/oauth/microsoft/callback
#  - API permissions (Delegated) : offline_access, openid, email, profile,
#    IMAP.AccessAsUser.All (Office 365 Exchange Online), SMTP.Send
#  - Client secret → reportez la valeur dans MICROSOFT_OAUTH_CLIENT_SECRET
PUBLIC_URL=https://mail.exemple.com
MICROSOFT_OAUTH_CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
MICROSOFT_OAUTH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# Optionnel : `common` (par défaut, perso + pro), `organizations` (pro uniquement),
# ou un tenant GUID spécifique.
MICROSOFT_OAUTH_TENANT=common
# Optionnel : par défaut déduit de PUBLIC_URL.
# MICROSOFT_OAUTH_REDIRECT_URI=https://mail.exemple.com/api/admin/mail-accounts/oauth/microsoft/callback

# NextCloud : se configure via l'UI Admin → NextCloud (plus aucune variable d'env).
```

> **Note** : Les comptes O2Switch et leurs tokens API sont gérés directement via l'interface d'administration (Administration > O2Switch). Les tokens sont chiffrés en AES-256-GCM avant stockage en base de données avec la même `ENCRYPTION_KEY`.

---

## Configuration des comptes mail

Les comptes mail sont créés par l'administrateur via **Administration → Comptes mail → + Nouveau compte**, puis attribués aux utilisateurs.

### Assistant par fournisseur

Au clic sur **+ Nouveau compte**, un sélecteur affiche les fournisseurs pris en charge et pré-remplit automatiquement la configuration :

| Fournisseur | IMAP | SMTP | Remarques |
|-------------|------|------|-----------|
| **Outlook / Microsoft 365** | `outlook.office365.com:993` | `smtp.office365.com:587` | **OAuth2 obligatoire** (bouton « Se connecter avec Microsoft ») — Basic Auth est désactivé par Microsoft depuis 2022 |
| **Gmail** | `imap.gmail.com:993` | `smtp.gmail.com:465` | IMAP doit être activé ; mot de passe d'application requis |
| **Yahoo Mail** | `imap.mail.yahoo.com:993` | `smtp.mail.yahoo.com:465` | Mot de passe d'application requis |
| **iCloud Mail** | `imap.mail.me.com:993` | `smtp.mail.me.com:587` | Mot de passe d'application Apple ID requis |
| **O2Switch** | saisie manuelle | saisie manuelle | Active la synchro CalDAV + CardDAV |
| **IMAP / SMTP (autre)** | saisie manuelle | saisie manuelle | Configuration libre (OVH, Zoho, Fastmail…) |

Pour les quatre premiers fournisseurs, les champs serveur et port sont masqués (résumé en lecture seule) et l'identifiant est automatiquement l'adresse e-mail. Seul le mot de passe (d'application si nécessaire) reste à saisir.

### Microsoft 365 / Outlook — Authentification OAuth2

Microsoft a désactivé l'authentification basique IMAP/SMTP en septembre 2022. Les comptes Outlook.com, Hotmail, Live et Microsoft 365 — et *a fortiori* ceux protégés par Microsoft Authenticator — doivent obligatoirement passer par OAuth2.

**Deux façons de fournir les identifiants Azure (Microsoft Entra ID) — variables d'environnement prioritaires :**

| Source | Quand l'utiliser | Persistance |
|--------|------------------|-------------|
| **Variables d'environnement** (`MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_TENANT`, `MICROSOFT_OAUTH_REDIRECT_URI`) | Recommandé en prod, déploiement Portainer/Docker. Verrouille la configuration via l'infra. | `.env` / `docker-compose.yml` / stack Portainer |
| **Interface Admin** → Comptes mail → *Configuration OAuth Microsoft* | Simple à modifier sans redémarrer, idéal pour démarrer rapidement. | Table `admin_settings` (secret chiffré AES-256-GCM) |

> Si une variable d'environnement est définie, elle écrase la valeur correspondante saisie dans l'UI Admin (champ par champ : vous pouvez par exemple fixer le `CLIENT_ID` par env et laisser le secret en base).

**Procédure complète :**

1. **Créer l'App Registration Azure (gratuit, compte perso accepté)** :
   - Allez sur https://entra.microsoft.com et connectez-vous avec votre compte Microsoft. Un tenant personnel est créé automatiquement — aucune entreprise ni abonnement payant requis.
   - **Applications → Inscriptions d'applications → + Nouvelle inscription**.
   - *Types de comptes pris en charge* : « Accounts in any organizational directory and personal Microsoft accounts » (3ᵉ option).
   - *URI de redirection (Web)* : `{PUBLIC_URL}/api/admin/mail-accounts/oauth/microsoft/callback`. La valeur exacte est affichée dans le panneau **Configuration OAuth Microsoft** (encadré bleu).
2. **Récupérer les identifiants** :
   - *Application (client) ID* → `MICROSOFT_OAUTH_CLIENT_ID` (ou champ Client ID dans l'UI).
   - *Certificates & secrets → + New client secret* → copiez la **Valeur** → `MICROSOFT_OAUTH_CLIENT_SECRET`.
3. **Permissions API (déléguées)** :
   - *Office 365 Exchange Online* : `IMAP.AccessAsUser.All`, `SMTP.Send`.
   - *Microsoft Graph* : `offline_access`, `openid`, `email`, `profile`.
   - Cliquez **Grant admin consent** (sur votre tenant personnel, vous en êtes admin).
4. **Configurer l'application**, au choix :
   - Via Portainer : ajoutez les variables dans la stack et redémarrez le conteneur.
   - Via l'UI : **Administration → Comptes mail → Configuration OAuth Microsoft** (panneau dépliable en haut de la liste), remplissez les champs et **Enregistrer**. Prend effet immédiatement sans redémarrage.
5. **Connecter un compte** : **+ Nouveau compte → Outlook / Microsoft 365 → Se connecter avec Microsoft**. Authentifiez-vous (mot de passe + Microsoft Authenticator), acceptez les permissions, cliquez **Enregistrer**. Le serveur stocke un `refresh_token` chiffré (AES-256-GCM) et rafraîchit automatiquement le jeton d'accès avant chaque opération IMAP/SMTP.

Pour reconnecter un compte dont le refresh token a été révoqué (changement de mot de passe, consentement révoqué), rouvrez la fiche du compte et cliquez sur **Reconnecter**.

### Paramètres IMAP/SMTP pour o2switch

| Paramètre | Valeur |
|-----------|--------|
| Serveur IMAP | `mail.votre-domaine.com` |
| Port IMAP | `993` |
| Sécurité IMAP | SSL/TLS |
| Serveur SMTP | `mail.votre-domaine.com` |
| Port SMTP | `465` |
| Sécurité SMTP | SSL/TLS |
| Identifiant | `adresse@votre-domaine.com` |
| Mot de passe | Mot de passe email cPanel |

### Paramètres pour Gmail

| Paramètre | Valeur |
|-----------|--------|
| Serveur IMAP | `imap.gmail.com` |
| Port IMAP | `993` |
| Serveur SMTP | `smtp.gmail.com` |
| Port SMTP | `465` |
| Identifiant | `votre-adresse@gmail.com` |
| Mot de passe | Mot de passe d'application |

> ⚠️ Gmail nécessite un [mot de passe d'application](https://support.google.com/accounts/answer/185833).

### Paramètres pour Outlook.com / Office 365

| Paramètre | Valeur |
|-----------|--------|
| Serveur IMAP | `outlook.office365.com` |
| Port IMAP | `993` |
| Serveur SMTP | `smtp.office365.com` |
| Port SMTP | `587` |
| Sécurité SMTP | STARTTLS |

### Paramètres pour OVH

| Paramètre | Valeur |
|-----------|--------|
| Serveur IMAP | `ssl0.ovh.net` |
| Port IMAP | `993` |
| Serveur SMTP | `ssl0.ovh.net` |
| Port SMTP | `465` |

---

## Configuration Docker

### Personnaliser les ports

Dans `docker-compose.yml` :
```yaml
ports:
  - "8080:3000"  # Accès sur le port 8080 au lieu de 3000
```

### Limiter les ressources

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          memory: 256M
  db:
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 256M
```

### Volumes personnalisés

```yaml
volumes:
  - ./plugins:/app/plugins           # Plugins
  - ./uploads:/app/uploads           # Pièces jointes
  - ./data:/app/data                 # Données applicatives
  - /opt/backups:/app/backups        # Sauvegardes
```

---

## Configuration Tailwind / Thème

Le thème visuel Outlook est défini dans `client/tailwind.config.js`. Les couleurs principales :

| Nom | Valeur | Usage |
|-----|--------|-------|
| `outlook-blue` | `#0078d4` | Couleur primaire |
| `outlook-dark-blue` | `#106ebe` | Hover |
| `outlook-light-blue` | `#deecf9` | Sélection |
| `outlook-bg-primary` | `#f3f2f1` | Fond principal |
| `outlook-bg-secondary` | `#ffffff` | Fond secondaire |
| `outlook-border` | `#edebe9` | Bordures |
| `outlook-text-primary` | `#323130` | Texte principal |
| `outlook-text-secondary` | `#605e5c` | Texte secondaire |

---

## Administration

### Premier lancement

1. Accédez à l'application
2. Créez un compte → automatiquement **administrateur**
3. Accédez au panneau d'administration via l'icône ⚙️ dans la barre de navigation

### Paramètres système

Depuis **Administration > Système** :

| Paramètre | Description | Défaut |
|-----------|-------------|--------|
| Nom de l'application | Affiché dans l'en-tête | `WebMail` |
| Inscription ouverte | Permettre la création de comptes | `Oui` |
| Taille max des pièces jointes | En octets | `25 000 000` (25 Mo) |
| Dossier racine d'archive | Clé `archive_root_folder` — dossier IMAP de base utilisé par le bouton « Archiver » | `Archives` |
| Motif des sous-dossiers d'archive | Clé `archive_subfolder_pattern` — arborescence construite depuis la date de réception du mail | `{YYYY}/{MM} - {MMMM}` |

#### Motif des sous-dossiers d'archive

Le motif est évalué à partir de la date de réception (`INTERNALDATE` IMAP ou date de l'enveloppe) du message archivé. Les segments sont séparés par `/` ; le délimiteur IMAP réel du serveur (`.` sur Courier, `/` sur Dovecot…) est utilisé lors de la création physique des dossiers.

Jetons disponibles :

| Jeton | Valeur | Exemple (avril 2026) |
|-------|--------|----------------------|
| `{YYYY}` | Année sur 4 chiffres | `2026` |
| `{YY}` | Année sur 2 chiffres | `26` |
| `{MM}` | Mois sur 2 chiffres | `04` |
| `{M}` | Mois sans padding | `4` |
| `{MMMM}` | Nom du mois en français | `Avril` |
| `{MMM}` | Nom abrégé | `Avr.` |

Exemples de motifs :

- `{YYYY}/{MM} - {MMMM}` → `Archives/2026/04 - Avril` (par défaut)
- `{YYYY}` → `Archives/2026`
- `{YYYY}/{MMMM}` → `Archives/2026/Avril`
- `{YY}/{MM}` → `Archives/26/04`

Les dossiers manquants sont créés automatiquement et souscrits (`SUBSCRIBE`) pour apparaître dans les autres clients IMAP (Thunderbird, Roundcube…).

### Gestion des utilisateurs

Depuis **Administration > Utilisateurs** :

- Créer, modifier, supprimer des utilisateurs
- Attribuer des rôles (`admin` / `user`)
- Activer ou désactiver des comptes

### Gestion des groupes

Depuis **Administration > Groupes** :

- Créer des groupes avec une couleur distinctive
- Attribuer des utilisateurs aux groupes
- Utiliser les groupes pour l'attribution de plugins et comptes O2Switch

### Dashboard

Depuis **Administration > Dashboard** :

- Vue d'ensemble des statistiques système en temps réel
- Nombre d'utilisateurs, groupes, comptes mail, contacts
- Statistiques d'emails, calendriers, plugins actifs
- Informations d'infrastructure (taille BDD, mémoire, uptime)
- Rafraîchissement automatique toutes les 30 secondes

### Gestion O2Switch

Depuis **Administration > O2Switch** :

1. **Ajouter un compte cPanel** : hostname, username, token API cPanel
2. **Tester la connexion** : vérifie l'accès à l'API cPanel UAPI v3
3. **Lister les emails** : affiche tous les comptes email du serveur avec quotas
4. **Créer un email** : crée un nouveau compte email directement sur cPanel
5. **Synchroniser** : importe automatiquement les emails O2Switch comme comptes locaux
6. **Lier un email** : associe un email O2Switch à un compte local avec attribution d'utilisateurs et groupes

> **Sécurité** : Les tokens API sont chiffrés AES-256-GCM en base de données. Ils ne sont jamais exposés dans l'interface ou les réponses API.

#### Obtenir un token API cPanel

1. Connectez-vous à cPanel (https://votre-site.o2switch.net:2083)
2. Allez dans **Sécurité > Gérer les tokens API**
3. Créez un nouveau token avec les permissions nécessaires
4. Copiez le token et ajoutez-le dans l'interface d'administration

### Logs d'audit

Depuis **Administration > Logs** :

- Consultation de toutes les actions administratives
- Filtrage par catégorie : auth, admin, mail, o2switch, system
- Recherche par mot-clé
- Informations : utilisateur, action, IP, date, détails
