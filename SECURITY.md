# Politique de Sécurité

## Versions supportées

| Version | Supportée |
|---------|-----------|
| 1.3.x   | ✅ Oui    |
| 1.2.x   | ✅ Oui    |
| 1.1.x   | ⚠️ Correctifs critiques uniquement |
| 1.0.x   | ❌ Non    |

## Signaler une vulnérabilité

Si vous découvrez une faille de sécurité, **ne créez pas d'Issue publique**.

### Procédure

1. Envoyez un email à **security@votre-domaine.com** avec :
   - Description détaillée de la vulnérabilité
   - Étapes de reproduction
   - Impact potentiel estimé
   - Suggestion de correction (si vous en avez une)

2. Vous recevrez un accusé de réception sous **48 heures**
3. Une évaluation sera faite sous **7 jours ouvrés**
4. Un correctif sera publié avec un crédit dans le CHANGELOG

### Ce que nous considérons comme vulnérabilité

- Injection SQL / NoSQL
- Cross-Site Scripting (XSS)
- Cross-Site Request Forgery (CSRF)
- Contournement d'authentification ou d'autorisation
- Exposition de données sensibles
- Exécution de code à distance (RCE)
- Server-Side Request Forgery (SSRF)
- Élévation de privilèges

---

## Mesures de sécurité implémentées

### Authentification & Sessions

| Mesure | Détail |
|--------|--------|
| Hachage des mots de passe | bcryptjs (10 rounds de salt) |
| Sessions | express-session + connect-pg-simple (stockées en BDD) |
| JWT | Tokens signés pour l'authentification API et PWA |
| Expiration | Sessions limitées dans le temps |
| Premier utilisateur | Automatiquement administrateur |

### Chiffrement

| Mesure | Détail |
|--------|--------|
| Mots de passe mail | Chiffrés AES-256-GCM (pas stockés en clair) |
| Tokens API O2Switch | Chiffrés AES-256-GCM (même algorithme) |
| Clé de chiffrement | Variable d'environnement `ENCRYPTION_KEY` |
| Transport | HTTPS recommandé en production |
| Communication cPanel | HTTPS obligatoire (port 2083) |

### Protection des entrées

| Mesure | Détail |
|--------|--------|
| Validation | Zod pour toutes les entrées API |
| Sanitisation HTML | DOMPurify côté client, sanitize-html côté serveur |
| SQL | Requêtes paramétrées via Drizzle ORM (pas de concaténation) |
| Upload | Validation de type MIME et taille max |

### En-têtes HTTP

| Mesure | Détail |
|--------|--------|
| Helmet | Protection automatique des en-têtes |
| CORS | Origines autorisées configurables |
| CSP | Content Security Policy via Helmet |
| HSTS | Strict Transport Security |
| X-Frame-Options | Protection contre le clickjacking |

### Architecture

| Mesure | Détail |
|--------|--------|
| Conteneurs isolés | Réseau Docker dédié |
| Base de données | Accessible uniquement via le réseau interne |
| Healthcheck | Monitoring de la disponibilité PostgreSQL |
| Variables d'environnement | Aucun secret dans le code source |
| Fichier .env | Exclu du dépôt Git |

### Audit et traçabilité

| Mesure | Détail |
|--------|--------|
| Logs d'audit | Toutes les actions admin enregistrées en BDD |
| Catégorisation | Logs classés par catégorie (auth, admin, mail, o2switch, system) |
| Informations capturées | IP source, User-Agent, utilisateur, action, cible, détails |
| Recherche et filtrage | Interface admin avec pagination et filtres |
| Rétention | Stockage permanent en table `admin_logs` |

---

## Bonnes pratiques de déploiement

### Obligatoire

- [ ] Changer `SESSION_SECRET` (minimum 64 caractères aléatoires)
- [ ] Changer `ENCRYPTION_KEY` (minimum 32 caractères aléatoires)
- [ ] Changer `DB_PASSWORD` (mot de passe fort)
- [ ] Activer HTTPS (via reverse proxy)
- [ ] Ne pas exposer le port PostgreSQL (5432) publiquement

### Recommandé

- [ ] Utiliser un reverse proxy (Nginx / Traefik)
- [ ] Configurer un pare-feu (ufw, iptables)
- [ ] Mettre en place des sauvegardes automatiques
- [ ] Activer les mises à jour automatiques de l'OS
- [ ] Limiter le nombre de tentatives de connexion (fail2ban)
- [ ] Surveiller les logs applicatifs

### Génération des secrets

```bash
# SESSION_SECRET (64 caractères hex)
openssl rand -hex 32

# ENCRYPTION_KEY (32 caractères hex)
openssl rand -hex 16

# DB_PASSWORD
openssl rand -base64 24
```

---

## Dépendances et audit

### Vérification des vulnérabilités

```bash
# Backend
cd server && npm audit

# Frontend
cd client && npm audit

# Correction automatique
npm audit fix
```

### Mises à jour de sécurité

Les dépendances sont régulièrement vérifiées. Utilisez :

```bash
# Voir les packages obsolètes
npm outdated

# Mettre à jour
npm update
```

---

## Scope de sécurité

### Dans le périmètre

- Application WebMail (frontend et backend)
- Configuration Docker fournie
- Plugins officiels (plugins/)
- Intégration NextCloud

### Hors périmètre

- Infrastructure de l'hébergeur
- Configuration du serveur mail IMAP/SMTP
- Instance NextCloud tierce
- Plugins développés par des tiers
- Navigateurs web
