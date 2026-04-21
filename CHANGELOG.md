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

## [1.2.0] - 2026-04-20

### Ajouté

#### Plugin O2Switch cPanel
- Intégration complète avec l'API cPanel UAPI v3
- Gestion des comptes O2Switch (ajout, suppression, test de connexion)
- Liste des comptes email distants avec recherche et filtrage
- Création / suppression d'adresses email sur cPanel
- Modification des quotas et mots de passe
- Synchronisation automatique des comptes email O2Switch
- Liaison des emails O2Switch vers des comptes mail locaux
- Attribution des comptes liés à des utilisateurs et groupes
- Chiffrement AES-256-GCM des tokens API O2Switch
- Indicateur de statut de connexion en temps réel

#### Dashboard Administrateur
- Tableau de bord avec statistiques système en temps réel
- Nombre d'utilisateurs, groupes, comptes mail, contacts
- Nombre d'emails, calendriers, plugins actifs, comptes O2Switch
- Informations infrastructure : taille BDD, mémoire, uptime, logs
- Rafraîchissement automatique toutes les 30 secondes

#### Logs d'Audit
- Journal d'audit complet des actions administratives
- Catégorisation des logs (auth, admin, mail, o2switch, system)
- Recherche par mot-clé dans les logs
- Filtrage par catégorie avec badges colorés
- Pagination côté serveur
- Enregistrement de l'IP et du User-Agent

#### Base de données
- Table `admin_logs` pour l'audit trail
- Table `o2switch_accounts` pour les comptes cPanel
- Table `o2switch_email_links` pour les liaisons email
- Contraintes d'unicité et clés étrangères

## [1.3.0] - 2026-04-20

### Ajouté

#### Interface Block Layout (style Outlook Web)
- Disposition en blocs avec marges, coins arrondis et ombres entre les panneaux
- Fond tertiaire `#E8E6E4` visible entre les blocs (dossiers, liste, lecture, ruban)
- Marges uniformes autour du ruban et de la zone de contenu

#### Système d'onglets
- Barre d'onglets en bas du volet de lecture pour naviguer entre messages/brouillons ouverts
- Deux modes d'ouverture configurables :
  - **Brouillons uniquement** : seuls les brouillons créent des onglets (par défaut)
  - **Tous les mails ouverts** : chaque message cliqué ouvre un onglet
- Nombre maximum d'onglets paramétrable (2-20, défaut 6) en mode "tous les mails"
- Suppression automatique du plus ancien onglet inactif quand la limite est atteinte
- Barre d'onglets masquée automatiquement quand moins de 2 onglets ouverts
- Coins arrondis adaptatifs sur le volet de lecture selon la présence de la barre d'onglets
- Options de configuration dans le ruban (onglet Afficher > groupe Onglets)
- Persistance du mode et du max en `localStorage`

#### Volet de dossiers redimensionnable
- Poignée de redimensionnement entre le volet dossiers et la liste de messages
- Largeur min 160px, max 400px, défaut 224px
- Persistance de la largeur en `localStorage`

#### Ruban auto-adaptatif
- Basculement automatique du ruban classique vers simplifié quand la largeur < 700px (ResizeObserver)
- Bouton "Réduire le ruban" (chevron ▲) en mode classique → passe en mode simplifié
- Bouton "Développer le ruban" (chevron ▼) en mode simplifié → passe en mode classique
- Suppression du menu déroulant "Options du ruban" redondant

## [Non publié]

### Ajouté
- Aperçu avancé des pièces jointes dans la vue message : images (JPEG/PNG/etc.), PDF, DOCX, XLSX, HEIC/HEIF (conversion côté client).
- Nouveau mode d'ouverture des pièces jointes par utilisateur : `Aperçu`, `Téléchargement`, ou `Menu (Aperçu / Télécharger)`.
- Nouvelle option dans le ruban : `Afficher > Pièce jointe` pour changer ce comportement à la volée.
- Nouvel écran dédié dans les paramètres utilisateur : `Paramètres > Messagerie` pour gérer la même préférence.

### Corrigé
- Persistance de connexion après rafraîchissement de page : l'endpoint `/api/auth/me` valide désormais correctement l'authentification via session ou JWT.
- Synchronisation du token d'authentification côté client entre l'état persisté (Zustand) et `localStorage` pour éviter les déconnexions involontaires.
- Masquage visuel du préfixe `INBOX.` dans l'interface des dossiers (exemple : `INBOX.test` affiché comme `test`) sans modifier le chemin IMAP réel.
- Mise à jour fiable du mot de passe des boîtes mail en administration : la liste `GET /api/admin/mail-accounts` renvoie maintenant aussi `username`, `imap_secure` et `smtp_secure`, évitant l'écrasement involontaire de l'identifiant lors de l'édition.
- Élimination de l'erreur React #310 à l'ouverture d'un message (ordre des hooks stabilisé dans la vue de lecture).

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
