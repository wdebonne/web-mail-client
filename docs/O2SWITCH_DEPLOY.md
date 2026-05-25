# Déploiement sur O2switch (hébergement mutualisé)

> **Usage principal recommandé : Docker sur VPS.**
> Ce guide couvre le déploiement sur l'hébergement **mutualisé** O2switch (cPanel), utile si vous n'avez pas accès à un VPS. Il présuppose que vous connaissez les limitations listées en fin de document.

---

## Prérequis

- Un hébergement mutualisé O2switch actif
- Accès SSH activé (cPanel → **SSH Access** → ajouter votre clé ou activer le mot de passe)
- Un domaine ou sous-domaine configuré dans cPanel

---

## 1. Base de données PostgreSQL

Dans cPanel → **Bases de données PostgreSQL** (ou **Assistant de base de données PostgreSQL**) :

1. Créer une base de données, ex. `webmail`
2. Créer un utilisateur dédié avec un mot de passe fort
3. Attribuer tous les privilèges à cet utilisateur sur la base
4. Noter la **chaîne de connexion** :
   ```
   postgresql://<user>:<password>@localhost:5432/<dbname>
   ```

> O2switch PostgreSQL écoute sur `localhost` par défaut. Si vous avez besoin d'un accès distant, activez **PostgreSQL distant** dans cPanel.

---

## 2. Configurer Node.js via Passenger

Dans cPanel → **Setup Node.js App** → **Créer une application** :

| Champ | Valeur recommandée |
|---|---|
| Version Node.js | **22** (la plus récente disponible) |
| Mode d'application | **Production** |
| Racine de l'application | `webmail` (dossier que vous allez créer) |
| URL de l'application | votre domaine ou sous-domaine |
| Fichier de démarrage | `server/dist/index.js` |

Cliquer **CREATE** puis noter le chemin absolu affiché (ex. `/home/<cpanel_user>/webmail`).

---

## 3. Préparer les fichiers sur le serveur

### Via SSH

```bash
# Activer Node.js 22 dans le shell
export PATH="$PATH:/opt/alt/alt-nodejs22/root/usr/bin/"

# Cloner le dépôt dans le dossier configuré à l'étape 2
cd ~
git clone <url-du-depot> webmail
cd webmail
```

### Compiler le frontend (React)

```bash
cd client
npm install
npm run build
cd ..
```

### Compiler le backend (Express)

```bash
cd server
npm install
npm run build   # tsc → génère server/dist/
cd ..
```

### Copier le frontend dans le dossier servi par Express

```bash
# En production, Express sert les fichiers depuis server/dist/public/
mkdir -p server/dist/public
cp -r client/dist/* server/dist/public/
```

---

## 4. Variables d'environnement

Dans cPanel → **Setup Node.js App** → votre application → **Environment variables**, ajouter :

| Variable | Valeur |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `3000` (ou celui affiché par Passenger) |
| `DATABASE_URL` | `postgresql://<user>:<pwd>@localhost:5432/<dbname>` |
| `SESSION_SECRET` | chaîne aléatoire longue (32+ caractères) |
| `ENCRYPTION_KEY` | chaîne aléatoire de 32 caractères minimum |
| `JWT_SECRET` | chaîne aléatoire longue |
| `WEBAUTHN_RP_ID` | votre domaine, ex. `mail.mondomaine.fr` |
| `WEBAUTHN_RP_NAME` | `WebMail` |
| `WEBAUTHN_ORIGIN` | `https://mail.mondomaine.fr` |
| `APP_URL` | `https://mail.mondomaine.fr` |

> Les variables VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT`) sont nécessaires uniquement si vous activez les notifications Web Push.
> Générer les clés VAPID avec : `npx web-push generate-vapid-keys`

---

## 5. Migrations de la base de données

```bash
cd ~/webmail/server
export PATH="$PATH:/opt/alt/alt-nodejs22/root/usr/bin/"
export DATABASE_URL="postgresql://<user>:<pwd>@localhost:5432/<dbname>"
npm run migrate
```

---

## 6. Démarrer l'application

Dans cPanel → **Setup Node.js App** → votre application → **Restart**.

Passenger démarre automatiquement `server/dist/index.js` à la prochaine requête HTTP.

---

## 7. Mettre à jour (déploiement continu)

```bash
cd ~/webmail
git pull

# Recompiler frontend
cd client && npm install && npm run build && cd ..

# Recompiler backend
cd server && npm install && npm run build && cd ..

# Copier le nouveau frontend
cp -r client/dist/* server/dist/public/

# Relancer les migrations si nécessaire
cd server && npm run migrate && cd ..
```

Puis : cPanel → **Setup Node.js App** → **Restart**.

---

## Limitations connues sur hébergement mutualisé

| Fonctionnalité | État | Raison |
|---|---|---|
| Lecture/envoi de mails (interactif) | ✅ Fonctionne | Requêtes HTTP normales |
| Authentification, contacts, calendrier | ✅ Fonctionne | Requêtes HTTP normales |
| **Polling IMAP en arrière-plan** | ⚠️ Instable | Passenger tue le process en cas d'inactivité, stoppant les `setInterval` |
| **WebSocket** (`/ws`) | ⚠️ Instable | Les connexions longue durée peuvent être coupées par Passenger |
| **Notifications push temps réel** | ⚠️ Partiel | Dépend du polling IMAP actif |
| **Sauvegardes automatiques** | ⚠️ Instable | Même cause que le polling |
| Sauvegardes manuelles | ✅ Fonctionne | Déclenchées par requête HTTP |
| Plugin O2switch (gestion comptes mail) | ✅ Fonctionne | Appels API cPanel à la demande |

### Conséquence concrète

Si aucun utilisateur ne fait de requête pendant quelques minutes, Passenger suspend le process Node.js. À la prochaine connexion, le process redémarre et le polling reprend — mais les notifications de nouveaux mails reçus pendant la période d'inactivité n'auront pas été envoyées en temps réel.

---

## Alternative recommandée : VPS O2switch

Pour un fonctionnement complet (polling, WebSocket, sauvegardes auto), utiliser la méthode **Docker** sur un VPS O2switch :

```bash
# Sur le VPS (accès root SSH)
git clone <url-du-depot> webmail
cd webmail
cp .env.example .env   # éditer les variables
docker compose up -d
```

Voir [DEPLOYMENT.md](../DEPLOYMENT.md) pour le guide Docker complet.
