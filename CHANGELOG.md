# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versioning Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Corrigé
- Liste des messages : stabilisation de la hauteur des lignes en mode étroit pour supprimer la légère variation de taille lors du survol ou de la sélection (réservation de la hauteur des boutons d'action).
- Volet Dossiers : correction d'un crash (React #300 « Rendered fewer hooks than expected ») déclenché par le bouton « Masquer les dossiers » — le hook `useMailStore` était appelé conditionnellement dans le JSX.

### Ajouté

#### Rédaction
- Nouveau bouton **Agrandir / Réduire** dans l'en-tête de la fenêtre de rédaction en ligne (entre Joindre un fichier et Fermer). En mode agrandi, la liste des dossiers et la liste des messages sont masquées pour donner toute la largeur au compose ; un clic sur le bouton (Minimize) ou la fermeture du brouillon restaure la vue normale.
- **Glisser-déposer de pièces jointes** dans la fenêtre de rédaction : un overlay bleu en pointillés indique la zone de dépôt lors du survol, et le(s) fichier(s) déposé(s) sont automatiquement ajouté(s) comme pièces jointes.

#### Onglets
- **Vue côte à côte** : clic droit sur un onglet message dans la barre du bas → « Afficher côte à côte ». L'onglet sélectionné est affiché à côté de l'onglet actif, avec une **poignée centrale redimensionnable** (ratio persisté dans `splitRatio`). L'onglet en vue latérale est repéré visuellement par un anneau bleu. Option « Retirer de la vue côte à côte » ou « Fermer l'onglet » disponibles depuis le même menu. Si l'onglet latéral est activé, la paire s'inverse automatiquement pour conserver la vue.
- Lorsque la vue côte à côte est active, la **liste des dossiers et la liste des messages sont automatiquement masquées** pour laisser toute la largeur aux deux lecteurs.
- Nouveau bouton **« Inverser les côtés »** (groupe *Vue*) dans l'onglet **Accueil** du ruban (classique et simplifié) — visible uniquement lorsque la vue côte à côte est active.
- Nouveau groupe **« Côte à côte »** dans l'onglet **Afficher** du ruban (classique et simplifié) avec deux bascules pour personnaliser l'affichage en vue split : **garder le volet Dossiers visible** et **garder la liste des messages visible**. Préférences persistées (`splitKeepFolderPane`, `splitKeepMessageList`).
- Nouvelle bascule **« Réponse à côté »** dans le même groupe : lorsqu'elle est active, cliquer sur **Répondre / Répondre à tous / Transférer** ouvre la rédaction à droite et **garde le mail d'origine visible à gauche**, avec la même poignée de redimensionnement. Le brouillon s'ouvre **entièrement vide** (ni objet, ni quote, ni en-têtes) puisque l'original reste affiché juste à côté. Un **bouton × en haut à gauche du volet original** permet de masquer ce mail d'origine pour basculer la rédaction en **pleine largeur**. Fermer le brouillon ou l'envoyer réinitialise la vue. Préférence persistée (`splitComposeReply`).

#### Favoris (nouveau)
- Section **Favoris** en haut du volet Dossiers avec icône étoile, pliable/dépliable (état persisté).
- Deux vues unifiées fixes en tête de la section, agrégeant tous les comptes sélectionnés :
  - **Boîte de réception** (cumul des INBOX)
  - **Éléments envoyés** (cumul des dossiers Sent détectés par heuristique)
  - Les actions (lu/non-lu, drapeau, suppression, déplacement, copie) sur un message d'une vue unifiée sont routées automatiquement vers le compte et le dossier d'origine.
- Épinglage de n'importe quel dossier IMAP en favori via le menu contextuel (« Ajouter aux favoris » / « Retirer des favoris »).
- **Réorganisation des favoris par glisser-déposer** : les dossiers épinglés peuvent être réordonnés dans la liste. Les deux vues unifiées restent toujours en tête et ne sont pas déplaçables. Un indicateur bleu affiche la position d'insertion.
- Nouveau bouton **Boîtes favoris** dans l'onglet **Afficher** du ruban (menu déroulant) :
  - Cases à cocher pour afficher/masquer « Boîte de réception » et « Éléments envoyés » unifiées.
  - Sélection des comptes inclus dans les vues unifiées (bouton « Tout inclure »).
- Préférences persistées localement (`mail.favoriteFolders`, `mail.unifiedAccounts`, `mail.favoritesExpanded`, `mail.unifiedInboxEnabled`, `mail.unifiedSentEnabled`).
- Réactivité croisée : tout changement (ruban ↔ menu contextuel ↔ glisser-déposer) est reflété instantanément dans les deux composants sans rafraîchissement de la page.

#### Ruban et rédaction
- Nouvel onglet **Message** dans le ruban (style Outlook) visible uniquement pendant la rédaction, regroupant les outils de mise en forme : polices, tailles, styles (Titre 1/2/3, citation, code), gras/italique/souligné/barré, indice/exposant, couleurs de texte et de surlignage, listes, retraits, alignements.
- Nouvel onglet **Insérer** avec les groupes Inclure (joindre un fichier, lien, image), Tableaux (grille 8×10), Symboles (emojis, ligne horizontale, date/heure) et boutons Emoji / GIF.
- Les onglets restent visibles en mode ruban simplifié.
- Hauteur du ruban constante sur tous les onglets.
- Les menus déroulants (police, taille, styles, couleurs, lien, tableau) utilisent désormais des portails React pour éviter le clipping.

#### Panneau Emojis
- Panneau latéral droit dédié (320 px), style Outlook web, ouvert depuis l'onglet Insérer.
- Champ de recherche, catégories (Smileys, Gestes, Nature, Nourriture, Voyages, Activités, Objets, Symboles) et section **Récents** persistée localement.
- Insertion à la position du curseur, sélection préservée entre plusieurs insertions.

#### Panneau GIF (GIPHY)
- Panneau latéral droit dédié, alimenté par l'API GIPHY.
- Modes **Tendances** et **Stickers**, recherche avec debounce et affichage en deux colonnes façon masonry.
- Clé API GIPHY configurable via la variable d'environnement `VITE_GIPHY_API_KEY` (build) ou saisissable directement dans le panneau (stockage local `giphyApiKey`).
- Insertion du GIF sous forme d'`<img>` à la position du curseur.

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

## [1.4.0] - 2026-04-21

### Ajouté

#### Composeur d'emails amélioré
- **Sélecteur de compte expéditeur** : affiche le nom du compte avec email en sous-texte (plus de double email)
- **Modal de sélection de contacts** : clic sur les labels "À", "Cc", "Cci" ouvre un carnet d'adresses complètes
- **Autocomplète amélioré** : sensibilité à 1 caractère, liste déroulante avec noms des contacts et badges "Expéditeur"
- **Chips destinataires stylisés** : les destinataires sélectionnés affichent le nom avec arrondis bleus
- **Éditeur de texte riche style Outlook** :
  - Sélection de police (Arial, Times, Courier, Georgia, Verdana, etc.) avec aperçu en direct
  - Taille de police (8px à 72px) avec menu déroulant
  - **Gras**, *Italique*, <u>Souligné</u>, ~~Barré~~
  - Couleur du texte et surlignage avec grille de 30 couleurs
  - Alignement : gauche, centré, droite, justifié
  - Listes à puces et numérotées avec indentation
  - Insertion de liens hypertextes
  - Insertion d'images par URL
  - Effacer la mise en forme (reset)

#### Gestion des expéditeurs (contacts non enregistrés)
- **Auto-enregistrement** : tout expéditeur de mail reçu est automatiquement enregistré comme "Expéditeur" (non permanent)
- **Source de contact** : colonne `source` dans les contacts (`'local'`, `'sender'`, `'nextcloud'`)
- **Page Contacts** : nouvelle section "Expéditeurs non enregistrés" avec compteur orange
- **Promotion de contact** : bouton "Enregistrer comme contact permanent" pour passer un expéditeur en contact local
- **Intégration autocompléte** : les expéditeurs non enregistrés sont disponibles dans l'autocompléte avec badge distinctif

#### Endpoints API nouveaux
- `POST /api/contacts/senders/record` : enregistre automatiquement un expéditeur
- `POST /api/contacts/:id/promote` : promeut un expéditeur en contact permanent
- `GET /api/contacts` : paramètre `source` optionnel pour filtrer par type

#### Base de données
- Colonne `source` sur la table `contacts` (valeurs : `'local'`, `'sender'`, `'nextcloud'`)
- Enregistrement automatique des expéditeurs lors de la lecture d'un message
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

## [1.5.0] - 2026-04-21

### Ajouté

#### Amélioration du composeur d'emails
- **Indicateur d'état réseau** : le bouton "Envoyer" affiche "Envoyer (hors-ligne)" quand la connexion est perdue
- **Destinataires en attente auto-ajoutés** : les emails tapés dans le champ "À" sont automatiquement validés et ajoutés à l'envoi, sans besoin d'appuyer sur Entrée
- **Activation intelligente du bouton** : le bouton "Envoyer" reste actif tant qu'il y a du texte en attente dans le champ "À" (permettant l'envoi sans confirmation préalable)

### Supprimé

#### Composeur d'emails
- Bouton dropdown inutile à côté du bouton "Envoyer" (anciennement grisé)

### Amélioré

#### Rendu du bouton "Envoyer"
- Design plus prominent avec padding augmenté et icône plus grande
- Ajout d'une shadow subtile qui s'intensifie au survol
- Coins arrondis complets et cohérents dans les deux modes (inline et modal)
- Meilleure hiérarchie visuelle pour mettre en avant l'action principale

## [1.6.0] - 2026-04-21

### Corrigé

#### Envoi de mail
- **Erreur 400 sur `POST /api/mail/send`** : normalisation automatique côté client des destinataires (`address` → `email`) pour correspondre au schéma Zod du serveur
- **Mails envoyés absents du dossier "Éléments envoyés"** : copie IMAP automatique du message dans le dossier Envoyés après envoi SMTP réussi
  - Détection automatique du dossier via `specialUse = \Sent` puis fallback sur les noms courants (`Sent`, `Sent Items`, `INBOX.Sent`, `Envoyés`, `Éléments envoyés`, etc., avec normalisation des accents)
  - Ajout silencieux en cas d'erreur (log uniquement, l'envoi reste réussi)

#### "De la part de" (send_on_behalf)
- **Classement systématique en spam** : refonte de la stratégie d'en-têtes pour améliorer la délivrabilité
  - En-tête `Sender` conservé uniquement quand le domaine de l'utilisateur délégué correspond au domaine de la boîte partagée (comportement "on behalf of" classique)
  - En domaine différent : suppression de `Sender` (souvent pénalisé par les filtres anti-spam) et utilisation de `Reply-To` vers l'utilisateur délégué
- **Nom de l'utilisateur manquant** : réaffichage du nom de l'utilisateur délégué dans le champ `From` (avec l'email de la boîte partagée)
  - `From: "Prénom Nom" <boite@domaine.fr>`
  - Préserve la lisibilité côté destinataire tout en gardant l'identité mail alignée sur la boîte

### Ajouté

#### Service mail
- Support de `replyTo` dans les options `sendMail()` (`MailService`)
- Méthodes privées : `formatAddress`, `plainTextFromHtml`, `resolveSentMailboxPath`, `appendToSentFolder`
## [1.7.0] - 2026-04-21

### Ajouté

#### Gestion multi-comptes dans le volet de dossiers
- **Extension simultanée de plusieurs boîtes mail** : chaque compte a son propre chevron d'expansion, les dossiers de plusieurs comptes sont visibles en même temps
- **Persistance des comptes développés** en `localStorage` (`mail.expandedAccounts`)
- **Renommage local des boîtes mail** : clic droit sur un compte → « Renommer la boîte mail » (override côté client uniquement, stocké en `localStorage`, n'affecte pas le serveur)
- **Réinitialisation du nom** : option dans le menu contextuel pour revenir au nom serveur

#### Réorganisation par glisser-déposer
- **Réordonnancement des comptes** : glisser un compte sur un autre (barre bleue avant/après)
- **Réordonnancement des dossiers** au sein d'un compte (bords haut/bas de la cible ou `Shift`)
- **Persistance des ordres** en `localStorage` (`mail.accountOrder`, `mail.folderOrder`)
- **Réinitialisation** des ordres via les menus contextuels des comptes/dossiers

#### Copie et déplacement cross-comptes
- **Déplacement d'un message entre comptes** : glisser une ligne de la liste vers un dossier d'un autre compte (maintenir `Ctrl/Cmd` pour copier au lieu de déplacer)
- **Copie d'un dossier complet entre comptes** : glisser un dossier vers un autre compte, ou clic droit → « Copier le dossier vers… » (sous-menu listant tous les comptes) avec prompt de nom
- Endpoints serveur :
  - `POST /api/mail/messages/transfer` — transfert d'un message `{srcAccountId, srcFolder, uid, destAccountId, destFolder, mode: 'copy'|'move'}` (move/copy IMAP natif si même compte, sinon FETCH + APPEND, suivi d'un DELETE pour le mode move)
  - `POST /api/mail/folders/copy` — copie d'un dossier complet entre deux comptes avec itération UID par UID
- Invalidation du cache TanStack Query ciblée par `accountId`

#### Arborescence de dossiers hiérarchique
- **Rendu en arbre** du volet de dossiers : les sous-dossiers sont indentés sous leur parent (construction de l'arbre à partir de `delimiter` et `path`)
- **Imbrication (nest) par drag-and-drop** : déposer un dossier au centre d'un autre le déplace en sous-dossier (IMAP `RENAME` avec changement de parent)
- **Désimbrication (un-nest)** : déposer un sous-dossier sur l'en-tête de son compte le remonte au niveau racine
- **Préservation du namespace personnel** : sur les serveurs type Courier (o2switch) où tout doit rester sous `INBOX.`, le un-nest conserve automatiquement le préfixe (`INBOX.a.b` → `INBOX.b`)
- **Shift + drag** force le mode réorganisation entre frères même au centre d'un dossier
- **Protection** : interdiction de déplacer un dossier dans lui-même ou dans un de ses descendants

#### Création et déplacement avec delimiter IMAP réel
- Création de sous-dossier (clic droit → « Nouveau sous-dossier ») utilise le `delimiter` du parent (`.` ou `/` selon le serveur) au lieu d'un séparateur codé en dur
- Même logique pour le renommage et la copie cross-comptes

#### Affichage des libellés de dossiers
- **Nom court** affiché dans le volet et l'en-tête de la liste : `INBOX.test.sous` → « sous »
- Le `path` IMAP complet reste utilisé pour toutes les opérations API (rename, delete, move, copy, messages), assurant la compatibilité avec les autres clients mail

#### Souscription IMAP automatique
- `createFolder` et `renameFolder` appellent désormais `mailboxSubscribe` sur le nouveau chemin et `mailboxUnsubscribe` sur l'ancien (après un rename), afin que les autres clients (Roundcube, Thunderbird) qui filtrent par dossiers souscrits voient immédiatement les changements

### Corrigé
- Réordonnancement instantané : les `useMemo` de tri (`sortAccounts`, `sortFolders`) incluent désormais un `prefsVersion` pour prendre en compte les changements de `localStorage` sans refresh de la page
- Erreur 500 sur `PATCH /api/mail/accounts/:id/folders` quand le dossier appartenait à un compte non-actif : les handlers de création/renommage/suppression et les mutations reçoivent désormais l'`accountId` du compte cible
- Erreur 500 sur le un-nest vers la racine sur serveurs à namespace (o2switch/Courier) : le chemin cible préserve le préfixe personnel détecté dynamiquement

### Nouveau fichier
- `client/src/utils/mailPreferences.ts` — utilitaires de persistance des préférences côté client : noms affichés, ordre des comptes, ordre des dossiers par compte, comptes développés, helpers de tri (`sortAccounts`, `sortFolders`)
## [Non publié]

### Ajouté
- Aperçu avancé des pièces jointes dans la vue message : images (JPEG/PNG/etc.), PDF, DOCX, XLSX, HEIC/HEIF (conversion côté client).
- Nouveau mode d'ouverture des pièces jointes par utilisateur : `Aperçu`, `Téléchargement`, ou `Menu (Aperçu / Télécharger)`.
- Nouvelle option dans le ruban : `Afficher > Pièce jointe` pour changer ce comportement à la volée.
- Nouvel écran dédié dans les paramètres utilisateur : `Paramètres > Messagerie` pour gérer la même préférence.
- Clarification documentation : l'aperçu DOCX/XLSX actuel est simplifié (fidélité partielle de mise en page).
- Intégration d'un moteur bureautique plus fidèle reportée à une future étape via l'environnement NextCloud Office.

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
