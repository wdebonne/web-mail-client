# Guide de Déploiement

Ce guide couvre les différentes méthodes de déploiement de WebMail.

## Table des matières

- [Prérequis](#prérequis)
- [Déploiement Docker (recommandé)](#déploiement-docker-recommandé)
- [Déploiement Portainer](#déploiement-portainer)
- [Déploiement manuel](#déploiement-manuel)
- [Reverse Proxy (Nginx)](#reverse-proxy-nginx)
- [Reverse Proxy (Traefik)](#reverse-proxy-traefik)
- [SSL / HTTPS](#ssl--https)
- [Sauvegarde & Restauration](#sauvegarde--restauration)
- [Mise à jour](#mise-à-jour)
- [Monitoring](#monitoring)
- [Dépannage](#dépannage)

---

## Prérequis

| Composant | Version minimale |
|-----------|-----------------|
| Docker | 20.10+ |
| Docker Compose | 2.0+ |
| Git | 2.30+ |
| RAM | 512 Mo minimum, 1 Go recommandé |
| Disque | 1 Go minimum + espace pour les données |

## Déploiement Docker (recommandé)

### 1. Cloner le dépôt

```bash
git clone https://votre-repo.git webmail
cd webmail
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
```

Éditez le fichier `.env` avec vos valeurs :

```env
# OBLIGATOIRE - Sécurité (générer des valeurs uniques)
DB_PASSWORD=mot_de_passe_fort_bdd
SESSION_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 16)

# OBLIGATOIRE - Base de données
DATABASE_URL=postgresql://webmail:${DB_PASSWORD}@db:5432/webmail

# OPTIONNEL - Serveur
PORT=3000
NODE_ENV=production

# OPTIONNEL - NextCloud
NEXTCLOUD_URL=https://cloud.example.com
NEXTCLOUD_USERNAME=admin
NEXTCLOUD_PASSWORD=votre_mot_de_passe
```

> ⚠️ **Important** : Générez toujours des clés uniques et fortes pour `SESSION_SECRET` et `ENCRYPTION_KEY` en production.

### 3. Construire et lancer

```bash
# Construction
docker-compose build

# Lancement en arrière-plan
docker-compose up -d

# Vérifier le statut
docker-compose ps

# Voir les logs
docker-compose logs -f app
```

### 4. Premier accès

1. Accédez à `http://votre-ip:3000`
2. Créez le premier compte — il sera automatiquement **administrateur**
3. Configurez vos comptes mail dans **Paramètres > Comptes mail**
4. (Optionnel) Configurez NextCloud dans **Administration > NextCloud**

---

## Déploiement Portainer

### Via l'interface Portainer

1. Connectez-vous à votre instance Portainer
2. Allez dans **Stacks** > **Add Stack**
3. Donnez un nom : `webmail`
4. Collez le contenu de `docker-compose.yml` dans l'éditeur
5. Dans la section **Environment variables**, ajoutez :

| Variable | Valeur |
|----------|--------|
| `DB_PASSWORD` | votre_mot_de_passe_bdd |
| `SESSION_SECRET` | clé_secrète_64_caractères |
| `ENCRYPTION_KEY` | clé_chiffrement_32_caractères |

6. Cliquez sur **Deploy the stack**

### Via Git dans Portainer

1. **Stacks** > **Add Stack** > onglet **Repository**
2. URL du dépôt : `https://votre-repo.git`
3. Référence : `main`
4. Fichier Compose : `docker-compose.yml`
5. Activez **Automatic updates** si souhaité
6. Configurez les variables d'environnement
7. **Deploy the stack**

---

## Déploiement manuel

### Prérequis supplémentaires

| Composant | Version |
|-----------|---------|
| Node.js | 20 LTS+ |
| PostgreSQL | 16+ |
| npm | 10+ |

### Installation

```bash
# Cloner
git clone https://votre-repo.git webmail
cd webmail

# Installer les dépendances
cd server && npm ci
cd ../client && npm ci
cd ..

# Construire le frontend
cd client && npm run build
cd ..

# Construire le backend
cd server && npm run build
cd ..

# Copier le frontend dans le dossier du serveur
cp -r client/dist server/dist/public

# Créer les répertoires nécessaires
mkdir -p plugins uploads data
```

### Configuration

```bash
cp .env.example .env
# Éditer .env avec une DATABASE_URL pointant vers votre PostgreSQL
```

### Lancement

```bash
cd server
NODE_ENV=production node dist/index.js
```

### Avec PM2 (recommandé en production)

```bash
npm install -g pm2

# Démarrer
pm2 start server/dist/index.js --name webmail

# Démarrage automatique au boot
pm2 startup
pm2 save

# Monitoring
pm2 monit
```

---

## Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name mail.example.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name mail.example.com;

    ssl_certificate /etc/letsencrypt/live/mail.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mail.example.com/privkey.pem;

    # Sécurité SSL
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Taille max des pièces jointes (25 Mo)
    client_max_body_size 25M;

    # Proxy vers l'application
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Timeout pour les connexions WebSocket
        proxy_read_timeout 86400;
    }

    # Cache pour les assets statiques
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        proxy_pass http://127.0.0.1:3000;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## Reverse Proxy (Traefik)

Ajoutez les labels au service `app` dans `docker-compose.yml` :

```yaml
services:
  app:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.webmail.rule=Host(`mail.example.com`)"
      - "traefik.http.routers.webmail.tls=true"
      - "traefik.http.routers.webmail.tls.certresolver=letsencrypt"
      - "traefik.http.services.webmail.loadbalancer.server.port=3000"
    networks:
      - webmail-network
      - traefik  # Réseau partagé avec Traefik
```

---

## SSL / HTTPS

### Avec Certbot (Let's Encrypt)

```bash
# Installer Certbot
sudo apt install certbot python3-certbot-nginx

# Obtenir un certificat
sudo certbot --nginx -d mail.example.com

# Renouvellement automatique (déjà configuré par défaut)
sudo certbot renew --dry-run
```

### Avec Docker et Traefik

Le certificat est géré automatiquement via les labels Traefik ci-dessus.

---

## Sauvegarde & Restauration

### Sauvegarde de la base de données

```bash
# Sauvegarde manuelle
docker exec webmail-db pg_dump -U webmail webmail > backup_$(date +%Y%m%d_%H%M%S).sql

# Sauvegarde compressée
docker exec webmail-db pg_dump -U webmail webmail | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Sauvegarde automatique (cron)

```bash
# Ajouter au crontab (sudo crontab -e)
# Sauvegarde quotidienne à 2h du matin, conservation 30 jours
0 2 * * * docker exec webmail-db pg_dump -U webmail webmail | gzip > /opt/backups/webmail_$(date +\%Y\%m\%d).sql.gz && find /opt/backups -name "webmail_*.sql.gz" -mtime +30 -delete
```

### Sauvegarde complète (données + plugins)

```bash
#!/bin/bash
BACKUP_DIR="/opt/backups/webmail/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# Base de données
docker exec webmail-db pg_dump -U webmail webmail | gzip > "$BACKUP_DIR/database.sql.gz"

# Plugins
tar -czf "$BACKUP_DIR/plugins.tar.gz" -C /chemin/vers/webmail plugins/

# Uploads
tar -czf "$BACKUP_DIR/uploads.tar.gz" -C /chemin/vers/webmail uploads/

# Configuration
cp /chemin/vers/webmail/.env "$BACKUP_DIR/env.bak"

echo "Sauvegarde terminée dans $BACKUP_DIR"
```

### Restauration

```bash
# Arrêter l'application
docker-compose stop app

# Restaurer la base de données
gunzip -c backup.sql.gz | docker exec -i webmail-db psql -U webmail webmail

# Redémarrer
docker-compose start app
```

---

## Mise à jour

### Mise à jour Docker

```bash
cd webmail

# Récupérer les dernières modifications
git pull origin main

# Reconstruire et redémarrer
docker-compose build --no-cache
docker-compose up -d

# Vérifier les logs
docker-compose logs -f app
```

### Mise à jour avec temps d'arrêt minimal

```bash
# Construire la nouvelle image sans arrêter l'ancienne
docker-compose build

# Basculer (temps d'arrêt < 5s)
docker-compose up -d --force-recreate app
```

---

## Monitoring

### Logs Docker

```bash
# Logs en temps réel
docker-compose logs -f

# Logs de l'application uniquement
docker-compose logs -f app

# Dernières 100 lignes
docker-compose logs --tail 100 app
```

### Santé des conteneurs

```bash
# Statut des services
docker-compose ps

# Utilisation des ressources
docker stats webmail-app webmail-db
```

### Endpoint de santé

L'application expose un endpoint de santé :

```bash
curl http://localhost:3000/api/health
```

---

## Dépannage

### L'application ne démarre pas

```bash
# Vérifier les logs
docker-compose logs app

# Vérifier que la base est prête
docker-compose logs db

# Redémarrer proprement
docker-compose down
docker-compose up -d
```

### Problème de connexion IMAP/SMTP

- Vérifiez que les ports 993 (IMAP) et 465/587 (SMTP) ne sont pas bloqués par un firewall
- Testez la connexion depuis le conteneur :
  ```bash
  docker exec webmail-app sh -c "nc -zv imap.example.com 993"
  ```

### Base de données corrompue

```bash
# Arrêter tout
docker-compose down

# Supprimer le volume (ATTENTION: perte de données!)
docker volume rm webmail_postgres_data

# Relancer (la base sera recréée)
docker-compose up -d
```

### Performance lente

- Vérifiez les ressources : `docker stats`
- Augmentez la mémoire du conteneur dans `docker-compose.yml` :
  ```yaml
  deploy:
    resources:
      limits:
        memory: 1G
  ```

### Port 3000 déjà utilisé

Modifiez le port dans `docker-compose.yml` :
```yaml
ports:
  - "8080:3000"  # Accès via le port 8080
```
