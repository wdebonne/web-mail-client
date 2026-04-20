# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versioning Sémantique](https://semver.org/lang/fr/).

## [1.0.0] - 2026-04-20

### Ajouté

#### Messagerie
- Interface trois panneaux style Outlook (dossiers, liste, lecture)
- Support multi-comptes IMAP/SMTP
- Compatible o2switch / cPanel et tout hébergeur standard
- Éditeur HTML riche pour la rédaction
- Gestion des pièces jointes (upload / download)
- Drapeaux, marquage lu/non-lu, déplacement entre dossiers
- Signature HTML configurable par compte
- Synchronisation automatique (intervalle configurable)
- Répondre, Répondre à tous, Transférer
- Boîte d'envoi hors-ligne avec envoi automatique au retour réseau

#### Contacts
- Gestion complète CRUD des contacts
- Recherche par email, nom, prénom, entreprise
- Groupes de contacts
- Listes de distribution
- Autocomplétion dans le composeur d'emails
- Enrichissement NextCloud (photo de profil, fonction, rôle, service)

#### Calendrier
- Vues mois, semaine, jour
- Calendriers multiples avec couleurs personnalisées
- Calendriers partagés entre utilisateurs
- Gestion des participants aux événements
- Rappels d'événements

#### PWA & Hors-ligne
- Application Progressive Web App installable
- Lecture des emails en mode hors-ligne (cache IndexedDB)
- Rédaction hors-ligne avec mise en file d'attente
- Envoi automatique des messages en attente au retour de la connexion
- Cache des contacts et événements pour consultation hors-ligne
- Sauvegarde automatique des brouillons

#### Système de Plugins
- Architecture de plugins extensible
- Plugin **Ollama AI** inclus (résumé, suggestion de réponse, traduction, amélioration)
- Configuration par plugin via l'interface d'administration
- Attribution des plugins par utilisateur ou par groupe
- Chargement dynamique depuis le dossier `/plugins`

#### Intégration NextCloud (optionnel)
- Synchronisation CardDAV (contacts)
- Synchronisation CalDAV (calendriers)
- Récupération des photos de profil utilisateurs
- Import des listes de distribution

#### Administration
- Gestion des utilisateurs (CRUD, rôles, activation)
- Gestion des groupes
- Configuration système globale
- Interface de configuration NextCloud avec test de connexion
- Gestion centralisée des plugins

#### Infrastructure
- Déploiement Docker (2 conteneurs : app + PostgreSQL)
- Docker Compose avec healthcheck
- Compatible Portainer
- Dockerfile multi-stage optimisé (Node 20 Alpine)
- Variables d'environnement externalisées
- Chiffrement AES-256-GCM des mots de passe mail
- Sessions sécurisées (JWT + express-session)
- Protection Helmet, CORS, sanitisation HTML

#### Stack Technique
- **Backend** : Node.js, Express, TypeScript
- **Frontend** : React 18, TypeScript, Vite, Tailwind CSS
- **Base de données** : PostgreSQL 16 avec Drizzle ORM
- **Mail** : imapflow (IMAP), nodemailer (SMTP), mailparser
- **État** : Zustand (client), React Query (server state)
- **Temps réel** : WebSocket (ws)
- **Validation** : Zod

## [1.1.0] - 2026-04-20

### Ajouté

#### Drag & Drop
- Glisser-déposer des messages entre dossiers
- Surbrillance visuelle du dossier cible (contour bleu) pendant le survol
- Déplacement IMAP automatique au lâcher
- API HTML5 Drag and Drop avec type MIME personnalisé

#### Interface Responsive
- Navigation mobile séquentielle (dossiers → liste → message) avec boutons retour
- FolderPane et MessageList en pleine largeur sur mobile
- ComposeModal en plein écran sur mobile
- Barre de navigation latérale adaptative sur petits écrans
- Largeurs adaptatives via breakpoints Tailwind (md/lg)

## [Non publié]

### Prévu
- Thème sombre complet
- Import/export de contacts (vCard, CSV)
- Règles de filtrage automatique des emails
- Support S/MIME et PGP
- Notifications push natives
- Vue conversation (groupement par thread)
- Recherche avancée avec filtres
- Support multi-langue complet (i18n)
- Sauvegarde et restauration de la configuration
