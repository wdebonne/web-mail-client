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

### Variables NextCloud (optionnelles)

| Variable | Description | Défaut |
|----------|-------------|--------|
| `NEXTCLOUD_URL` | URL de l'instance NextCloud | *(non défini)* |
| `NEXTCLOUD_USERNAME` | Nom d'utilisateur NextCloud | *(non défini)* |
| `NEXTCLOUD_PASSWORD` | Mot de passe NextCloud | *(non défini)* |
| `NEXTCLOUD_ENABLED` | Activer l'intégration NextCloud | `false` |

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

# ===== NextCloud (optionnel) =====
# NEXTCLOUD_URL=https://cloud.example.com
# NEXTCLOUD_USERNAME=admin
# NEXTCLOUD_PASSWORD=mot_de_passe
# NEXTCLOUD_ENABLED=true
```

---

## Configuration des comptes mail

Les comptes mail sont configurés par utilisateur via l'interface web : **Paramètres > Comptes mail**.

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

### Gestion des utilisateurs

Depuis **Administration > Utilisateurs** :

- Créer, modifier, supprimer des utilisateurs
- Attribuer des rôles (`admin` / `user`)
- Activer ou désactiver des comptes

### Gestion des groupes

Depuis **Administration > Groupes** :

- Créer des groupes avec une couleur distinctive
- Attribuer des utilisateurs aux groupes
- Utiliser les groupes pour l'attribution de plugins
