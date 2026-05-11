# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versioning Sémantique](https://semver.org/lang/fr/).

---

## [Unreleased]

---

## [1.8.0] - 2026-05-11

### Ajouté

- **Listes de distribution** : créez des listes nommées (ex. « Restauration Responsable ») regroupant plusieurs destinataires. Lors de la composition d'un e-mail, tapez le nom de la liste dans les champs À/Cc/Cci — tous les membres sont automatiquement ajoutés comme destinataires individuels, sans avoir à saisir chaque adresse manuellement.

  - **Création et édition** : depuis l'onglet « Listes de distribution » dans la page Contacts — ajoutez des membres en recherchant vos contacts existants ou en saisissant un e-mail manuellement (l'adresse est automatiquement ajoutée à vos contacts).
  - **Suppression douce** : supprimer une liste l'archive (invisible pour l'utilisateur) mais elle reste visible et récupérable par les administrateurs.
  - **Partage** : partagez vos listes avec d'autres utilisateurs ou des groupes. Les listes partagées apparaissent dans l'autocomplete de leurs destinataires.
  - **Gestion administrateur** : nouvelle section « Listes de distribution » dans le panneau d'administration — filtrage par nom/utilisateur, affichage des listes archivées, modification, partage, restauration et suppression définitive de toutes les listes.

### Technique

- **BDD** : migration `distribution_lists` — ajout des colonnes `is_deleted BOOLEAN`, `shared_with JSONB` et `created_by UUID`.
- **Serveur** : mise à jour des routes `contacts.ts` (soft delete, partage, auto-création de contacts, autocomplete filtré). Nouvelles routes admin `admin.ts` (`GET/PUT/DELETE /admin/distribution-lists`, `/share`, `/restore`).
- **Client** : nouvelles méthodes API (`shareDistributionList`, `getAdminDistributionLists`, `adminUpdateDistributionList`, `adminDeleteDistributionList`, `adminShareDistributionList`, `adminRestoreDistributionList`).
- **Client** : `ComposeModal` — `handleSuggestionSelect()` expand les membres d'une liste en destinataires individuels au lieu d'essayer d'ajouter l'adresse de la liste.
- **Client** : `ContactsPage` — nouvel onglet « Listes de distribution » (virtual group `__distribution_lists__`) avec composants `DistListRow`, `DistListDetail`, `DistListForm`, `ShareDistListDialog`.
- **Client** : `AdminPage` — nouvel onglet dans le groupe Messagerie avec composants `AdminDistributionLists`, `AdminDLEditModal`, `AdminDLShareModal`.

---

## [1.7.6] - 2026-05-11

### Corrigé

- **WebSocket : reconnexion infinie sur token expiré** : l'access token JWT expire toutes les 15 minutes. Jusqu'ici, un token expiré provoquait une boucle infinie (`invalid_token` → attente 8 s → reconnexion avec le même token expiré), obligeant l'utilisateur à se déconnecter et reconnecter manuellement. Désormais, à réception du code 4001, le client rafraîchit automatiquement le token via le cookie de session (valide 90 jours) avant de se reconnecter — sans aucune action utilisateur.

### Technique

- **Client** : `useWebSocket.ts` — sur fermeture avec code 4001, appel explicite à `tryRestoreSession()` avant la reconnexion. Si le refresh échoue (cookie expiré), les tentatives de reconnexion s'arrêtent ; le prochain appel HTTP redirige vers la page de login.

---

## [1.7.5] - 2026-05-11

### Ajouté

- **Suppression en masse (sélection)** : sélectionnez plusieurs messages via le mode sélection (bouton ☑ dans la barre d'outils de la liste), puis supprimez-les tous d'un clic grâce à la barre d'actions qui apparaît. L'opération utilise un seul appel IMAP par groupe de compte/dossier (sequence set).

- **File d'attente debounce pour les suppressions manuelles** : supprimer des emails un par un ne déclenche plus d'appel IMAP immédiat. Chaque suppression retire instantanément le message de l'interface (optimiste), puis un minuteur de 7 secondes se réinitialise. Dès que plus aucune suppression n'arrive depuis 7 secondes, toutes les suppressions en attente sont envoyées en une seule opération IMAP batch — éliminant les erreurs de connexions concurrentes lors de suppressions rapides.

### Corrigé

- **Erreurs IMAP lors de suppressions rapides** : l'envoi de N connexions IMAP simultanées (une par suppression) causait des erreurs de rollback après 2-3 suppressions. Le nouveau système debounce regroupe toutes les suppressions en une seule séquence IMAP.
- **Rollback intempestif** : en cas d'échec, seul le message dont la suppression a échoué est réinséré à son index d'origine — les autres suppressions réussies restent effectives.

### Technique

- **Serveur** : deux nouvelles méthodes dans `MailService` — `deleteMessages(folder, uids[])` et `moveMessages(fromFolder, uids[], toFolder)` — IMAP sequence set en une seule connexion.
- **Serveur** : nouvel endpoint `POST /mail/accounts/:accountId/messages/bulk-delete` (`{ uids, folder, toTrash?, trashFolder? }`). Suppression SQL via `ANY($2::int[])`.
- **Client** : `api.deleteMessages()` correspondante.
- **Client** : `pendingDeletesRef` + `deleteTimerRef` + `flushPendingDeletes` + `queueDelete` remplacent `deleteMutation`. `requestDelete` appelle maintenant `queueDelete` (le minuteur de 7 s est réinitialisé à chaque nouvelle suppression).
- **Client** : prop `onBulkDelete` ajoutée à `MessageList` ; barre d'actions contextuelle visible quand au moins un message est coché.

---

## [1.7.3] - 2026-05-10

### Ajouté

- **Marquer tout comme lu** : nouvelle option dans le menu contextuel des dossiers (clic droit sur un dossier) permettant de marquer d'un seul clic l'ensemble des messages du dossier comme lus. L'opération est appliquée côté serveur via IMAP (`\Seen` sur toute la séquence), le cache SQL est mis à jour immédiatement et les vues (liste de messages, compteurs non lus, dossiers virtuels) se rafraîchissent automatiquement.

### Technique

- **Serveur** : nouvel endpoint `PATCH /mail/accounts/:accountId/folders/mark-all-read?folder=` — applique `messageFlagsAdd('1:*', ['\\Seen'])` puis met à jour la table `cached_emails`.
- **Client** : nouvelle fonction `api.markFolderAllRead(accountId, folder)` dans `api/index.ts`.
- **Client** : prop `onMarkFolderAllRead` ajoutée à `FolderPane` ; handler `handleMarkFolderAllRead` dans `MailPage` invalidant les caches React Query (`messages`, `folder-status`, `virtual-messages`).

---

## [1.7.2] - 2026-05-10

### Ajouté

#### Nextcloud — intégration fichiers étendue

- **Joindre un fichier depuis Nextcloud** : nouveau bouton *Nextcloud* (icône nuage) dans le ruban **Insérer → Inclure**, visible uniquement lorsque le compte Nextcloud de l'utilisateur est synchronisé. En cliquant dessus, une modal de navigation s'ouvre et permet de parcourir l'arborescence du drive NC (dossiers et fichiers), de sélectionner un ou plusieurs fichiers (cases à cocher, taille affichée) et de les télécharger automatiquement depuis Nextcloud pour les attacher à l'e-mail en cours de rédaction. Disponible en mode ruban *classique* et *simplifié*.
- **Mode d'ouverture « Nextcloud »** : nouveau mode dans **Afficher → Pièce jointe** (et **Paramètres → Messagerie → Ouverture des pièces jointes**). Quand il est actif, cliquer sur une pièce jointe reçue ouvre directement le sélecteur de dossier Nextcloud pour l'enregistrer dans le drive NC — sans passer par le menu intermédiaire. Désactivé automatiquement si NC n'est pas lié.

### Modifié

- Vérification de la liaison Nextcloud dans le ruban Insérer : désormais basée sur `GET /calendar/nextcloud-status` (même endpoint que la barre de statut), plus fiable que l'ancienne vérification via `GET /nextcloud/files/status`.

### Technique

- **Serveur** : ajout de la méthode `NextCloudService.getFile(relPath)` — télécharge un fichier du drive NC en tant que `Buffer` via GET WebDAV.
- **Serveur** : nouvelle route `GET /api/nextcloud/files/get?path=` — exposée via `nextcloudFilesRouter`, renvoie `{ filename, contentType, contentBase64 }` (limite 100 Mo).
- **Client** : nouvelle fonction `api.nextcloudFilesGet(path)` correspondante.
- **Client** : nouveau composant `NextcloudFilePicker.tsx` — modal de navigation fichiers + dossiers NC avec multi-sélection, affichage de la taille, navigation par fil d'Ariane.

---

## [1.7.1] - 2026-05-10

### Ajouté

#### Applications Desktop — fonctionnalités natives Tauri v2

- **Barre système (system tray)** : icône WebMail dans la taskbar Windows/macOS avec menu contextuel (*Ouvrir WebMail*, *✉ Nouveau message*, *Quitter*). Clic gauche affiche/masque la fenêtre. Le tooltip affiche le nombre de mails non lus (ex: *WebMail — 3 non lu(s)*), synchronisé toutes les 60 s via `GET /api/mail/badge`.
- **Fermeture dans le tray** : la croix de la fenêtre masque l'application au lieu de la quitter. Seul le menu tray "Quitter" termine le processus.
- **Raccourci global `Ctrl+Shift+M`** : affiche ou masque l'application depuis n'importe quelle autre application Windows/macOS, même quand WebMail est en arrière-plan.
- **Démarrage automatique avec Windows** : l'application se lance au démarrage du système en arrière-plan (`--hidden`). Activable/désactivable via le hook `useAutostart()` — prêt à brancher dans les Paramètres.
- **Instance unique** (`tauri-plugin-single-instance`) : relancer l'exécutable met le focus sur la fenêtre existante au lieu d'en ouvrir une seconde.
- **Protocole `mailto:`** (`tauri-plugin-deep-link`) : cliquer sur un lien `mailto:` dans Chrome/Edge/Firefox ouvre directement la fenêtre de composition avec les champs `To`, `CC`, `Subject` et `Body` pré-remplis. Scheme custom `webmail://` également enregistré.
- **Hook `useTauri.ts`** (`client/src/hooks/useTauri.ts`) : utilitaires frontend pour `isTauri`, `updateTrayBadge()`, `getAutostart()`, `setAutostart()`, `useTauriCompose()`, `useTauriDeepLink()`.
- **Capabilities Tauri** (`src-tauri/capabilities/default.json`) : permissions déclaratives pour tous les plugins (global-shortcut, autostart, deep-link, notification).

#### Applications — panneau admin amélioré

- **Persistance des paramètres GitHub** : owner, repo, branche, URL du serveur, version et token sont sauvegardés dans `localStorage` (`webmail:github-build-settings`) et rechargés automatiquement à chaque ouverture de l'onglet.
- **Bouton "Récupérer"** sur chaque run GitHub Actions réussi : télécharge automatiquement les artefacts du run (`.exe`, `.msi`, `.deb`, `.AppImage`, `.dmg`) depuis l'API GitHub, les extrait du ZIP et les dépose dans `server/downloads/` — ils apparaissent immédiatement dans la liste de téléchargements sans manipulation manuelle.
- **Endpoint `POST /api/admin/applications/build/github/download-artifacts`** : accepte `{ token, owner, repo, runId }`, liste les artefacts du run via l'API GitHub, télécharge chaque ZIP, extrait les binaires reconnus avec `adm-zip` et les copie dans le dossier de téléchargements.

### Modifié

- `src-tauri/Cargo.toml` : ajout de `tauri-plugin-single-instance`, `tauri-plugin-autostart`, `tauri-plugin-global-shortcut`, `tauri-plugin-deep-link`, `tauri-plugin-notification` ; feature `tray-icon` activée sur `tauri`.
- `src-tauri/tauri.conf.json` : `withGlobalTauri: true`, config `plugins.deepLink` avec schemes `webmail` et `mailto`, icône tray.
- `server/package.json` : ajout de `adm-zip` pour l'extraction ZIP des artefacts GitHub.
- `client/src/App.tsx` : intégration des hooks `useTauriCompose` (menu tray → compose) et `useTauriDeepLink` (mailto: → compose), mise à jour du badge tray toutes les 60 s.

---

## [1.7.0] - 2026-05-10

### Ajouté

#### Applications Desktop & Mobile — génération native depuis l'admin

- **Nouveau panneau d'administration « Applications »** (`Admin → Applications`) permettant de gérer l'ensemble des distributions natives de l'application depuis l'interface web.
- **Détection automatique de l'environnement** : le panneau identifie si l'utilisateur consulte la page depuis un navigateur web standard, une PWA installée (`display-mode: standalone`) ou une application desktop Tauri (`__TAURI_INTERNALS__`), et adapte l'affichage en conséquence.

#### PWA — installation depuis l'admin

- **Bouton d'installation PWA contextuel** dans le panneau Applications : utilise l'événement natif `beforeinstallprompt` du navigateur pour proposer l'installation en un clic, sans redirection. Désactivé si la PWA est déjà installée ou si le navigateur ne supporte pas l'installation.

#### Applications Desktop — Tauri v2

- **Projet Tauri v2 intégré** (`src-tauri/`) : la webview native charge directement l'URL du serveur Express en cours d'exécution (`frontendDist` = URL du serveur), ce qui garantit que l'API REST et le WebSocket fonctionnent sans aucune modification de code.
- **Support multi-plateforme** :
  - 🪟 Windows : `.exe` (NSIS) + `.msi`
  - 🐧 Linux : `.deb` + `.AppImage`
  - 🍎 macOS : `.dmg`
- **Scripts npm dédiés** dans `package.json` (racine et `client/`) :
  - `npm run tauri:dev` — fenêtre desktop en mode développement (Vite dev server)
  - `npm run tauri:build` — build de production
  - `npm run tauri:icon` — génération des icônes depuis `icon-512.png`

#### Builder Docker — build Linux depuis Portainer

- **Nouveau service Docker `tauri-builder`** (`Dockerfile.tauri-builder`) basé sur Ubuntu 22.04 avec Rust stable, Cargo, Tauri CLI et toutes les dépendances système WebKit2GTK / AppIndicator nécessaires à la compilation Tauri sur Linux.
- **Micro-serveur HTTP** (`tauri-builder/server.mjs`) exposé en interne sur le port 4000 : accepte les requêtes de build (`POST /build`) et diffuse les logs en temps réel via **Server-Sent Events** (`GET /log`).
- **Volume Docker partagé** `tauri_downloads` monté dans les deux conteneurs (`/downloads` côté builder, `/app/server/downloads` côté app) : les binaires générés sont immédiatement disponibles au téléchargement depuis l'admin sans copie manuelle.
- **Activation via profile Docker Compose** : `docker compose --profile builder up -d tauri-builder` — n'impacte pas les déploiements existants qui ne démarrent pas ce service.
- **Variable d'environnement** `TAURI_BUILDER_URL` (défaut : `http://tauri-builder:4000`) pour pointer vers le builder depuis le serveur principal.

#### GitHub Actions — build multi-plateforme

- **Workflow `.github/workflows/tauri-build.yml`** déclenché manuellement (`workflow_dispatch`) ou depuis le panneau admin : builds parallèles sur runners GitHub Windows, Linux et macOS avec la matrice `ubuntu-22.04 / windows-latest / macos-latest`.
- **URL du serveur configurable** en entrée du workflow (`server_url`) — baked dans l'application générée via le flag `--config` de Tauri CLI, sans modifier les fichiers source.
- **Artefacts GitHub** conservés 30 jours sur le run Actions, téléchargeables directement depuis GitHub.
- **Interface admin dédiée** : formulaire owner/repo/token GitHub, déclenchement en un clic, suivi des derniers runs (statut, date, lien direct GitHub Actions).

#### Endpoint API `/api/admin/applications`

- `GET /info` — état du builder Docker (ping) + liste des binaires disponibles.
- `POST /build/docker` — déclenche un build Linux dans le conteneur `tauri-builder`.
- `GET /build/docker/log` — proxy SSE temps réel vers les logs du builder.
- `POST /build/github` — déclenche le workflow GitHub Actions via l'API REST GitHub.
- `GET /build/github/runs` — liste les 5 derniers runs du workflow avec statut et lien.
- `GET /download/:filename` — téléchargement d'un binaire depuis `server/downloads/`.
- `DELETE /download/:filename` — suppression d'un binaire.

### Modifié

- **`docker-compose.yml`** : ajout du service `tauri-builder` (profile `builder`), du volume `tauri_downloads`, de la variable `TAURI_BUILDER_URL` dans le service `app`.
- **`.gitignore`** : exclusion de `src-tauri/target/` et des binaires dans `server/downloads/`.
- **`client/package.json`** : ajout de `@tauri-apps/cli ^2` en devDependency et des scripts `tauri:*`.

---

## [1.6.0] - 2026-05-10

### Ajouté

#### Administration — gestion avancée des utilisateurs

- **Correction du statut utilisateur** : la colonne `is_active` manquait dans la table `users` (migration automatique `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`) — le statut affichait toujours « Inactif » même pour les comptes connectés.
- **Quatre nouvelles actions par utilisateur** dans le tableau de bord Admin → Utilisateurs :
  - ✏️ **Modifier** : modale permettant de changer le nom d'affichage, l'e-mail et le rôle.
  - ✅/❌ **Activer / Désactiver** : bascule en un clic ; un compte désactivé ne peut plus se connecter (erreur 403 à la connexion).
  - 🛡️ **Changer le mot de passe** : modale avec champ de confirmation et validation de concordance.
  - 🔗 **Lien de réinitialisation** : génère un token sécurisé (24 h) et affiche le lien à copier/envoyer manuellement à l'utilisateur.
- **Recherche et filtrage des utilisateurs** : champ de recherche instantanée (nom, e-mail, rôle) avec bouton ✕ pour effacer, filtre rapide Tous / Actifs / Inactifs, et compteur dynamique (`X / Y` quand un filtre est actif).
- **Page publique `/reset-password?token=…`** : formulaire permettant à l'utilisateur de définir un nouveau mot de passe via le lien reçu. Le token ne peut être utilisé qu'une seule fois.
- **Table `password_resets`** : stockage des tokens de réinitialisation avec expiration, marquage `used_at` pour éviter la réutilisation.
- **Blocage à la connexion** pour les comptes désactivés (`is_active = false`) : message « Ce compte est désactivé ».

#### Page Paramètres utilisateur — refonte de l'organisation

- **Groupes visuels dans les sidebars** (`Compte / Messagerie / Interface / Sécurité / Données`) : séparateurs de groupe avec label en petites capitales, présents sur mobile, tablette et desktop.
- **Réorganisation des onglets** : `Sécurité` placé avant `Mes appareils` (logique : credentials de sécurité > gestion des sessions) ; `Comportement mail` (ex `Messagerie`) avec icône `SlidersHorizontal` plus représentative.
- **Sidebar élargie** : `w-56` → `w-60` pour accommoder les libellés de groupes.
- **Badge de version** `v{APP_VERSION}` en bas de la sidebar, persistent entre rechargements.

#### Profil utilisateur — nouveaux champs

- **Sélecteur de langue fonctionnel** : boutons visuels Français 🇫🇷 / English 🇬🇧 ; appelle `i18n.changeLanguage()` et persiste dans `localStorage('user.language')` — survit aux rechargements de page (lecture au démarrage dans `main.tsx`).
- **Sélecteur de fuseau horaire** : liste de 25 fuseaux organisés par région (Europe / Amérique / Asie-Pacifique / UTC), détection automatique du fuseau navigateur affiché en indication.
- **Indicateur de force du mot de passe** : barre à 4 niveaux (rouge → vert) avec label textuel.
- **Champ de confirmation du mot de passe** : validation visuelle (bordure rouge + message) si les deux champs ne correspondent pas ; bouton désactivé jusqu'à concordance.

#### Apparence — thème fonctionnel

- **Thème branché sur `useThemeStore`** : les 3 modes (Clair / Sombre / Système) sont désormais fonctionnels (sélect était précédemment mort, sans état ni onChange).
- Affichage en 3 cartes avec description de chaque mode et coche active.
- Langue et fuseau horaire supprimés de cet onglet (déplacés dans Profil).
- Sections `Mise en page mobile` et `Lisibilité` avec séparateurs visuels.

#### Page Administration — refonte de la navigation

- **Groupes visuels** (`Général / Utilisateurs / Messagerie / Calendrier / Intégrations / Système`) dans les sidebars.
- **Sidebar élargie** : `w-56` → `w-64` pour les labels plus longs.
- **Badge de version** `v{APP_VERSION}` dans le titre du Tableau de bord et en bas de sidebar.

#### Internationalisation — noms d'onglets améliorés

- `Répondeur` → `Répondeur auto` / `Messagerie` → `Comportement mail`
- Admin : `Logs` → `Journaux`, `Apparence connexion` → `Page de connexion`, `Appareils` → `Sessions actives`, `Modèles` → `Modèles de mail`, `Règles` → `Règles de filtrage`, `Plugins` → `Extensions`, `Notifications` → `Notifications par défaut`, `Système` → `Paramètres système`
- Ajout des clés `settings.group.*` et `admin.group.*` dans `fr.json` et `en.json`.

#### Système de versioning

- **Version unique** dans `package.json` racine, `client/package.json`, `server/package.json` (`1.6.0`).
- **Injection Vite** via `define: { __APP_VERSION__ }` — `process.env.npm_package_version` permet de ne jamais désynchroniser le numéro affiché du `package.json`.
- **`client/src/utils/version.ts`** : export `APP_VERSION` utilisable partout dans le front-end.

---

## [1.5.0] - 2026-05-10

### Internationalisation (i18n)

- **Ajout d'une gestion complète de l’internationalisation** :
  - Interface traduite en français et anglais, détection automatique de la langue du navigateur.
  - Fichiers de traduction modulaires (`client/src/i18n/en.json`, `fr.json`).
  - Documentation enrichie pour expliquer comment contribuer à l’ajout ou la correction de traductions.
  - Section dédiée dans le README.md et CONTRIBUTING.md pour guider la contribution i18n.

### Corrigé

#### Endpoint `folders/status` qui crashait sur compte OAuth expiré

- **Symptôme** : un compte OAuth (Microsoft 365 / XOAUTH2) avec un access/refresh token révoqué ou expiré faisait remonter en boucle dans les logs `Get folder status error: 3 NO AUTHENTICATE failed` et générait une rafale de réponses `500` toutes les 30 s, visibles dans l'onglet Réseau du navigateur sous forme de fetches `status` empilés en attente.
- **Cause** : la nouvelle route `GET /accounts/:accountId/folders/status` ([server/src/routes/mail.ts](server/src/routes/mail.ts)) ne distinguait pas un échec d'authentification IMAP (problème de compte) d'une vraie erreur serveur, et le client repollait toutes les 30 s sans tenir compte de l'échec.
- **Correctif (serveur)** : la route détecte désormais les échecs d'auth (`authenticationFailed`, `responseStatus: 'NO'`, `AUTHENTICATE failed`) et renvoie `200 { folders: {}, failed: true, reason: 'auth' }` au lieu d'un `500`. Cache d'échec porté à **5 min** au lieu de 20 s pour ne plus marteler le serveur IMAP. Les vraies erreurs IMAP passent par `logger.warn` (plus de stack trace bruyante).
- **Correctif (client)** ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)) : `staleTime` 15 s → 30 s, `refetchInterval` 30 s → 60 s, `retry: false`, et `refetchInterval` retourne `false` quand la réponse précédente porte `failed: true` — un compte cassé n'est plus repollé qu'au prochain focus de la fenêtre ou rafraîchissement manuel.

#### WebSocket temps-réel rejetée avec « invalid signature »

- **Symptôme** : la connexion `/ws` montait bien (`101 Switching Protocols`) puis se fermait immédiatement, et les logs serveur affichaient en boucle `WebSocket auth failed (invalid/expired token) err=invalid signature`. Conséquence : aucun événement temps-réel (`new-mail`, `mail-moved`, …) ne parvenait au client.
- **Cause** : double souci.
  1. Côté serveur, le handshake WebSocket ne vérifiait le JWT qu'avec `SESSION_SECRET`, alors que les access tokens sont signés avec `JWT_SECRET` (avec fallback sur `SESSION_SECRET`) via `getJwtSecret()` dans [server/src/services/deviceSessions.ts](server/src/services/deviceSessions.ts).
  2. Côté client, le hook `useWebSocket` lisait le JWT depuis le store Zustand `authStore.token`, qui n'est mis à jour qu'au login explicite. Or l'intercepteur 401 dans [client/src/api/index.ts](client/src/api/index.ts) écrit le token rafraîchi uniquement dans `localStorage['auth_token']`, ce qui pouvait faire envoyer un access token périmé/signé avec un ancien secret au handshake `/ws`.
- **Correctif (serveur)** ([server/src/services/websocket.ts](server/src/services/websocket.ts)) : le handshake utilise désormais `verifyAccessToken` (le même validateur que les routes HTTP) en priorité, avec fallback sur `jwt.verify(SESSION_SECRET)` pour rester compatible avec les anciens tokens longs.
- **Correctif (client)** ([client/src/hooks/useWebSocket.ts](client/src/hooks/useWebSocket.ts)) : le hook lit `localStorage['auth_token']` (la source de vérité du transport, mise à jour à chaque rotation silencieuse) plutôt que `authStore.token`, et ré-ouvre la socket à chaque rotation pour ré-authentifier avec le JWT frais.

#### Liste de la boîte de réception qui ne se vide pas après une règle « Déplacer vers le dossier »

- **Symptôme** : quand une règle de courrier déplaçait un nouveau message hors de la boîte de réception (action *Déplacer vers le dossier*), le mail apparaissait simultanément dans la boîte de réception **et** dans le dossier cible côté UI, et ne disparaissait de la boîte de réception qu'au rafraîchissement automatique suivant (jusqu'à 30 s plus tard).
- **Cause** : le moteur de règles côté serveur effectue bien le `MOVE` IMAP, puis pose `ruleResult.silence = true` pour éviter une notification utilisateur sur un UID qui n'existe plus dans `INBOX` ([server/src/services/mailRules.ts](server/src/services/mailRules.ts)). Mais comme la branche silencieuse sortait directement de la boucle ([server/src/services/newMailPoller.ts](server/src/services/newMailPoller.ts)), **aucun événement WebSocket** n'était émis — l'UI ouverte ne savait pas qu'elle devait recharger la liste des messages.
- **Correctif (côté serveur)** ([server/src/services/newMailPoller.ts](server/src/services/newMailPoller.ts)) : quand une règle déplace ou supprime un message, le poller émet désormais un événement WebSocket léger `mail-moved` (`{ accountId, uid, srcFolder: 'INBOX', reason: 'rule', matchedRules }`) à destination de l'utilisateur propriétaire — sans notification visible, juste un signal de rafraîchissement. Le log de diffusion remonté en niveau `info` inclut `hasOpenWebSocket` pour distinguer immédiatement « pas de socket ouverte » de « socket ouverte mais frame perdu ».
- **Correctif (côté client — abonnement)** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx), [client/src/hooks/useWebSocket.ts](client/src/hooks/useWebSocket.ts)) : la page Messagerie s'abonne désormais aux événements temps-réel `new-mail`, `mail-moved`, `mail-deleted`, `mail-read` et `mail-archived` via `useWebSocket`. Le hook conserve les handlers dans une `ref` pour éviter de reconstruire/reconnecter la WebSocket à chaque re-rendu, et trace désormais chaque frame reçue (`[ws] frame ←`, `[ws] dispatch <type>`, `[ws] no handler for <type>`) pour faciliter le diagnostic en production.
- **Correctif (côté client — mutations chirurgicales)** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : à la réception de `mail-moved` / `mail-deleted` / `mail-archived`, la page **n'invalide plus** les caches `['messages']` / `['virtual-messages']` (un refetch complet ramenait la pagination à la page 1 et relançait la boucle « Tout charger » → tempête de requêtes `messages?folder=INBOX&page=N`). À la place, le UID concerné est retiré de manière chirurgicale via `queryClient.setQueryData(['messages', accountId, srcFolder], …)` et `removeMessageFromVirtualCaches`, en synchronisant aussi le store Zustand si le dossier est affiché. Seul `['folders']` est encore invalidé pour rafraîchir les compteurs. L'événement `new-mail` ne déclenche un refetch des listes **que si** aucun chargement progressif (`loadAllActive` / `loadingMore`) n'est en cours.

### Ajouté

#### Indicateurs de mails non lus dans le volet « Dossiers »

- **Trois indicateurs indépendants et combinables** ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)) : à côté du nom de chaque dossier (et de chaque favori, ainsi que des boîtes unifiées Inbox/Sent), l'application peut afficher au choix — ou en cumul — *(1)* le **nombre de mails non lus** entre parenthèses à la fin du nom (comportement par défaut, identique à Outlook), *(2)* le **nom du dossier en gras**, et *(3)* une **pastille rouge** devant le nom. Chaque indicateur est une bascule indépendante.
- **Portée configurable** : un sélecteur permet de limiter l'affichage des indicateurs à *(a)* la **boîte de réception uniquement**, *(b)* les **favoris uniquement**, *(c)* boîte de réception **et** favoris, ou *(d)* **tous les dossiers** (par défaut). Pratique pour ne pas surcharger la sidebar lorsqu'on a des dizaines de dossiers IMAP.
- **Endpoint serveur dédié** ([server/src/routes/mail.ts](server/src/routes/mail.ts), [server/src/services/mail.ts](server/src/services/mail.ts)) : nouvelle route `GET /accounts/:accountId/folders/status` qui ouvre **une seule connexion IMAP** par compte et exécute `STATUS` (`messages` / `unseen` / `recent`) sur tous les dossiers sélectionnables (`\Noselect` et `\NonExistent` ignorés). Les erreurs par dossier sont silencieusement avalées pour ne pas casser tout le listing. Cache mémoire **20 s** par utilisateur+compte (et **5 min** sur échec d'auth — voir section *Corrigé*) pour limiter le trafic IMAP, avec bypass `?refresh=1`.
- **Préférences synchronisées** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : nouvelle clé `localStorage` `mail.unreadIndicators.v1` (`{showCount, showBold, showDot, scope}`), helpers `getUnreadIndicatorPrefs/setUnreadIndicatorPrefs`, événement `mail-unread-indicators-changed` qui propage en temps réel la moindre modification entre le ruban, la sidebar et la page Paramètres sans rechargement.
- **Contrôle dans le ruban** ([client/src/components/mail/Ribbon.tsx](client/src/components/mail/Ribbon.tsx)) : nouveau bouton **« Non lus »** (icône cloche-pastille `BellDot`) dans le groupe *Disposition* de l'onglet **Afficher**, en mode classique comme simplifié. Le menu déroulant propose les 3 cases à cocher (Compteur / Gras / Pastille) et les 4 options de portée. Le bouton s'affiche en bleu lorsqu'un indicateur supplémentaire (gras ou pastille) est actif.
- **Contrôle dans Paramètres → Apparence** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : nouveau composant `UnreadIndicatorsPicker` avec les mêmes contrôles, intégré juste après le sélecteur de taille de texte du volet Dossiers, avec textes d'aide pour chaque option et toast de confirmation.
- **Performance côté client** : `useQuery(['folder-status', accountId])` parallèle aux requêtes `['folders']`, `staleTime` 30 s, `refetchInterval` 60 s, `refetchOnWindowFocus: true`, `retry: false`. La requête n'est lancée que si **au moins un indicateur est activé** (`enabled: showCount || showBold || showDot`) — aucun coût réseau si l'utilisateur n'a rien activé. Pour la portée *favoris-only*, un opt-out précis évite même de charger les statuts des comptes hors-favoris.

#### Transfert automatique pendant que le répondeur est actif

- **Nouvelle option « Transférer également les nouveaux mails reçus »** ([client/src/components/mail/AutoResponderForm.tsx](client/src/components/mail/AutoResponderForm.tsx)) : ajout d'une bascule dans le formulaire du Répondeur (visible dans la modale du ruban, l'onglet **Paramètres → Répondeur** *et* la page d'administration). Une fois activée, **chaque nouveau mail reçu** pendant que le répondeur est actif est dupliqué et envoyé aux destinataires choisis — indépendamment du cooldown anti-spam de la réponse automatique et du filtre *« uniquement à mes contacts »*.
- **Champ destinataires avec autocomplétion contacts** ([client/src/components/mail/AutoResponderForm.tsx](client/src/components/mail/AutoResponderForm.tsx)) : zone de saisie type *chips* (mêmes interactions que la fenêtre de rédaction) — l'autocomplétion interroge `api.searchContacts` (carnet d'adresses + listes de diffusion) et propose jusqu'à 8 suggestions filtrées (sans les destinataires déjà sélectionnés). Saisie manuelle libre validée comme adresse e-mail, validation par **Entrée**, **virgule**, **point-virgule** ou perte de focus ; **Backspace** retire le dernier chip. Plafond à **20 destinataires** par compte.
- **Validation côté serveur** ([server/src/routes/autoResponder.ts](server/src/routes/autoResponder.ts)) : nouveau champ `forwardTo` au schéma Zod (`z.array(z.string().trim().toLowerCase().email()).max(20)`), dédupliqué et persisté en `JSONB` dans une colonne `forward_to` ajoutée à la table `auto_responders` (migration `ADD COLUMN IF NOT EXISTS` rétro-compatible). La route admin renvoie également `forwardTo` côté GET pour pré-remplir le formulaire en mode admin.
- **Logique de transfert** ([server/src/services/autoResponderService.ts](server/src/services/autoResponderService.ts)) : le service `maybeSendAutoReply` est refactoré en deux étapes indépendantes — la phase *réponse automatique* est isolée dans une IIFE, ses retours anticipés (cooldown, filtre contacts, …) **ne court-circuitent plus** la phase *transfert*. Une nouvelle fonction `forwardIncoming` ré-émet le mail original (corps HTML, texte alternatif, **pièces jointes incluses**, en-tête `Fwd:` ajouté seulement si absent) à chaque adresse cible. Sujet préfixé `Fwd:`, en-têtes `Auto-Submitted: auto-forwarded`, `X-Auto-Response-Suppress: All`, `Precedence: auto_reply` et `X-Forwarded-For-Account` pour empêcher toute boucle si le destinataire a lui-même un répondeur. `skipSentFolder: true` pour ne pas polluer le dossier *Envoyés* du compte source.
- **Garde-fous anti-boucle** : exactement les mêmes que pour la réponse automatique — un message portant `Auto-Submitted ≠ no`, `Precedence: bulk/list/junk/auto_reply`, `List-Id`, `List-Unsubscribe`, `X-Loop`, `Return-Path: <>` ou `X-Auto-Response-Suppress` n'est **jamais transféré**. L'auto-adresse du compte source et l'expéditeur d'origine sont également filtrés des destinataires pour empêcher l'auto-renvoi.
- **Activation/désactivation propre** : dans le formulaire, décocher la bascule envoie une liste vide au serveur (le transfert s'arrête immédiatement) tout en **conservant la mémoire des destinataires saisis** dans l'état local jusqu'à l'enregistrement, pour faciliter la réactivation.

#### Action « Affecter à la catégorie » dans les règles de courrier

- **Nouveau type d'action** ([client/src/utils/mailRules.ts](client/src/utils/mailRules.ts), [client/src/api/index.ts](client/src/api/index.ts), [server/src/services/mailRules.ts](server/src/services/mailRules.ts), [server/src/routes/rules.ts](server/src/routes/rules.ts)) : ajout d'`assignCategory` dans `MailRuleActionType` (côté client et serveur), regroupé sous une nouvelle rubrique **Catégoriser** dans le sélecteur du wizard, entre *Marquer* et *Transférer / répondre*. Le schéma Zod côté serveur accepte les champs `categoryId` (id local) et `categoryName` (nom lisible, conservé comme repli si l'id n'est pas connu sur l'appareil consultant la règle).
- **Sélecteur de catégorie dans le wizard** ([client/src/components/mail/RuleWizard.tsx](client/src/components/mail/RuleWizard.tsx)) : à l'étape 3, choisir « Affecter à la catégorie » fait apparaître un menu déroulant peuplé depuis `getCategories()` (catégories partagées en `localStorage`, clé `mail.categories`). Le wizard s'abonne via `subscribeCategories` pour rafraîchir la liste si l'utilisateur ouvre le gestionnaire de catégories en parallèle. La validation refuse l'enregistrement tant qu'aucune catégorie n'est sélectionnée. Une catégorie inconnue localement (rule partagée par un autre utilisateur, suppression locale…) reste affichée en option *(inconnue ici)* pour ne pas perdre l'assignation.
- **Évaluateur côté client** ([client/src/utils/mailRulesEval.ts](client/src/utils/mailRulesEval.ts)) : nouveau module qui rejoue les règles activées sur les messages fraîchement reçus et applique l'action via `setMessageCategories`. L'évaluateur reproduit la même logique d'`AND/OR` + exceptions que `applyRulesToIncoming` côté serveur, ignore les conditions non disponibles côté client (`headerContains`, `importance`, `sensitivity`) et résout la catégorie d'abord par `categoryId` puis par `categoryName` (insensible à la casse).
- **Branchement dans la page Mail** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : `useQuery(['mail-rules'])` charge les règles avec `staleTime` de 60 s ; un `useEffect` rejoue `applyCategoryRules` à chaque réponse de `getMessages` puis déclenche `bumpPrefs()` pour re-rendre les badges de la liste. L'identité utilisateur (`email`, `display_name`) est lue depuis `useAuthStore` afin de gérer correctement les conditions « Mon nom dans À/Cc ».
- **Pourquoi côté client ?** Les catégories sont volontairement locales (persistées en `localStorage`, partagées entre boîtes mail mais pas entre appareils) — l'IMAP n'expose aucun mécanisme natif équivalent. Le moteur serveur traite donc `assignCategory` comme un no-op (cas explicite dans `runAction`) et s'appuie sur le client pour la matérialiser. Conséquence : la catégorisation s'applique dès qu'un message apparaît dans la liste, et est rejouée si l'utilisateur ouvre la même boîte sur un autre appareil.

#### Dossiers récents en tête des sous-menus « Déplacer » / « Copier »

- **Raccourci MRU** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx)) : les sous-menus *Déplacer vers…* et *Copier vers…* du menu contextuel d'un message affichent désormais en tête (juste sous la barre *Rechercher un dossier*) les **derniers dossiers utilisés** pour cette action, marqués d'une icône **horloge**. Un séparateur les distingue de la liste complète habituelle, qui reste accessible en dessous.
- **Réglage par action** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : le nombre de raccourcis affichés est paramétrable **indépendamment** pour Déplacer et Copier, parmi quatre valeurs — *Off* (désactivé), *1*, *2* ou *3* dossiers récents. Persistant en `localStorage` (`mail.recentMoveFoldersCount` / `mail.recentCopyFoldersCount`) avec un événement `mail-recent-folders-changed` pour synchroniser ruban et page Paramètres.
- **Suivi automatique** : à chaque clic dans le sous-menu (qu'il provienne de la zone *récents* ou de la liste complète), le dossier choisi remonte en tête de la liste MRU correspondante (`pushRecentMoveFolder` / `pushRecentCopyFolder`). Jusqu'à 5 dossiers stockés par action et par compte, déduplication automatique. Le repli utilise le prop `accountId` du composant pour fonctionner aussi en vue mono-compte (où `_accountId` n'est pas posé sur les messages).
- **Contrôle dans le ruban** ([client/src/components/mail/Ribbon.tsx](client/src/components/mail/Ribbon.tsx)) : nouveau bouton **« Dossiers récents »** (icône horloge) dans le groupe *Disposition* de l'onglet **Afficher** (modes classique et simplifié). Le menu déroulant propose une rangée de boutons `Off / 1 / 2 / 3` pour Déplacer puis pour Copier.
- **Contrôle dans Paramètres** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : section **Dossiers récents (Déplacer / Copier)** dans les préférences Mail, avec la même rangée `Off / 1 / 2 / 3` par action et un texte d'aide. Toute modification (ruban ou paramètres) est immédiatement visible dans l'autre via l'événement de synchronisation.

#### Case « Tout sélectionner » dans l'en-tête de la liste des messages

- **Nouvelle case à cocher** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx)) : ajout d'une case à cocher en tête du volet de messages, à gauche du bouton *Masquer/Afficher les dossiers*, qui sélectionne ou désélectionne en un clic **tous les messages actuellement visibles** dans le dossier. Idéal pour purger un dossier (corbeille, spam, dossier obsolète) sans cocher chaque ligne une par une.
- **Affichage contextuel** : la case n'apparaît que lorsque le **mode sélection est activé** (clic sur l'icône *Sélectionner* à droite de la barre d'outils), pour ne pas encombrer l'en-tête en utilisation normale.
- **État indéterminé** : la case affiche trois états — vide (rien de sélectionné), **indéterminé** (sélection partielle parmi les messages visibles), cochée (tout est sélectionné). Géré via la propriété `indeterminate` de l'élément `<input>` mise à jour par `useEffect`.
- **Respect des filtres** : la sélection cible uniquement les messages **filtrés** (filtres date, type — non lus, drapeau, pièces jointes…), pas la totalité des messages chargés. Cela permet par exemple de sélectionner d'un coup *tous les non lus du mois dernier* avant suppression.
- **Compatible vues unifiées** : utilise les clés composites existantes `accountId:folder:uid` pour ne pas confondre des messages partageant le même UID dans des dossiers/comptes différents (boîte de réception unifiée).
- **Surlignage cohérent des lignes cochées** : toutes les lignes sélectionnées partagent désormais le même fond bleu (`bg-outlook-blue/15`) et une **bordure gauche bleue**, indépendamment de l'état lu/non lu et de la catégorie (qui auparavant écrasaient le surlignage et ne mettaient en évidence que le message actuellement ouvert).

#### Étoile de favoris cliquable dans l'en-tête de la liste des messages

- **Bascule favori en un clic** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx)) : l'étoile décorative affichée à côté du nom du dossier en haut de la liste devient un vrai bouton. Un clic ajoute (ou retire) le dossier courant de la section **Favoris** du panneau de gauche, sans passer par le menu contextuel.
- **Indicateur visuel** : l'étoile s'affiche **pleine et orange** (`text-outlook-warning`, `fill="currentColor"`) quand le dossier est dans les favoris, **vide et grisée** sinon, avec un *tooltip* dynamique *Ajouter aux favoris / Retirer des favoris* et l'attribut `aria-pressed` pour les lecteurs d'écran.
- **Synchronisation immédiate** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : après bascule, `bumpPrefs()` re-rend le `FolderPane` et invalide la query `virtual-messages` pour que la section *Favoris* reflète le changement sans reload.
- **Masquage automatique** : l'étoile est cachée pour les vues virtuelles (Boîte de réception unifiée, Éléments envoyés unifiés) où la notion de favori-de-dossier n'a pas de sens — celles-ci restent gérées via le ruban.

### Corrigé

#### Plus d'expéditeur « Inconnu » dans la liste des messages

- **Cascade de repli sur l'enveloppe IMAP** ([server/src/services/mail.ts](server/src/services/mail.ts)) : certains messages (newsletters, listes de diffusion, en-têtes encodés exotiques, syntaxe « group » RFC-2822 du genre `Undisclosed-recipients:;`) renvoient une enveloppe IMAP dont `envelope.from[0]` existe mais avec `address` et `name` vides — le client recevait alors `from: null` et la liste affichait *Inconnu / ?*, particulièrement visible au changement de dossier ou pendant la synchronisation du cache (moment où la liste est repeuplée depuis IMAP). Nouveau helper `pickFirstAddress()` qui ignore les entrées vides puis cascade `envelope.from` → `envelope.sender` → `envelope.replyTo`.
- **Seconde passe sur les en-têtes bruts** : pour les UIDs encore sans expéditeur après la cascade enveloppe, une seconde requête `client.fetch(uids, { headers: ['from','sender','reply-to','return-path'] })` récupère les en-têtes RFC 5322 bruts. Le helper `parseAddressFromHeaders()` les déplie (continuations WSP), reconnaît les formats `"Nom" <a@b>`, `Nom <a@b>` et adresse nue, et remplit le champ `from` manquant. Erreurs IMAP non bloquantes (`logger.warn`).
- **Même cascade dans la vue détail** : `getMessage()` applique désormais `mailparser` → `pickFirstAddress(envelope.*)` → `parseAddressFromHeaders()` avant de tomber sur `null`, ce qui élimine également l'affichage *Inconnu* dans le panneau de lecture et les conversations.
- **Note migration** : les messages déjà mis en cache avec `from: null` continueront d'afficher *Inconnu* tant que le dossier n'est pas re-synchronisé. Forcer une resynchro (Paramètres → Cache → **Vider le cache**) ou attendre la fenêtre incrémentale de 10 min par dossier.

### Ajouté

#### Modèles de mail (templates) — personnels, partagés et globaux

- **Création depuis la fenêtre de composition** ([client/src/components/mail/ComposeModal.tsx](client/src/components/mail/ComposeModal.tsx)) : nouveau menu **« Plus »** (icône `MoreHorizontal`) dans la barre de la fenêtre de rédaction avec l'entrée **« Enregistrer comme modèle »** qui ouvre un mini-prompt demandant simplement le nom du modèle. L'objet et le corps HTML courant sont enregistrés tels quels.
- **Insertion depuis le ruban** ([client/src/components/mail/Ribbon.tsx](client/src/components/mail/Ribbon.tsx)) : nouveau groupe **Modèles** dans l'onglet **Insérer** (icône `FileText`) — versions classique et simplifiée. Un clic ouvre un sélecteur modal avec **champ de recherche autocomplete** (filtrage par nom et objet), **navigation clavier** (↑/↓/Entrée/Échap), **aperçu en cartes côte-à-côte** quand 1 à 3 résultats correspondent (corps rendu en HTML), bascule en **vue liste** au-delà. Un bouton **Insérer** remplace tout le contenu courant du mail (objet + corps) par celui du modèle sélectionné. Bouton **Gérer** (engrenage) ouvre directement le gestionnaire.
- **Gestion utilisateur** ([client/src/components/mail/MailTemplates.tsx](client/src/components/mail/MailTemplates.tsx)) : modal de gestion avec table listant les modèles propres + ceux partagés avec moi + globaux, avec **badge de scope** (*Personnel / Partagé / Global*). Actions par modèle : **modifier / renommer**, **partager**, **supprimer** (uniquement sur ses propres modèles ; les modèles partagés ou globaux sont en lecture seule).
- **Partage avec utilisateurs ou groupes** : modal de partage avec onglets *Utilisateur / Groupe*, filtre live sur la liste, ajout/retrait individuel des partages. La table `mail_template_shares` applique une contrainte XOR `user_id` / `group_id` pour forcer un type de cible unique par ligne.
- **Administration centralisée** ([client/src/components/admin/AdminMailTemplates.tsx](client/src/components/admin/AdminMailTemplates.tsx), [client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : nouvel onglet **Admin → Modèles** avec liste de tous les modèles de la plateforme (colonne *Propriétaire*, badge global), filtre texte couvrant nom + objet + propriétaire. Actions : créer un modèle pour le compte de n'importe quel utilisateur, créer un **modèle global** (visible par tous, lecture seule côté utilisateur), modifier, partager, supprimer.
- **Schéma serveur** ([server/src/database/connection.ts](server/src/database/connection.ts)) : nouvelles tables `mail_templates` (UUID, `owner_user_id` *nullable*, `name`, `subject`, `body_html`, `is_global`, contrainte `CHECK ((is_global=true AND owner_user_id IS NULL) OR (is_global=false AND owner_user_id IS NOT NULL))`) et `mail_template_shares` avec FK + index. Création idempotente au démarrage.
- **API REST** ([server/src/routes/mailTemplates.ts](server/src/routes/mailTemplates.ts)) : routes utilisateur `GET/POST/PUT/DELETE /api/mail-templates[/:id]`, partages `GET/POST/DELETE /api/mail-templates/:id/shares[/:shareId]`, et leurs équivalents admin sous `/api/admin/mail-templates` (avec `isGlobal` et `ownerUserId` modifiables). `GET` retourne les modèles possédés + globaux + partagés (via `user_id` ou groupes appartenance) avec `scope = 'owned' | 'global' | 'shared'`. Sanitization HTML alignée sur le pipeline compose (`sanitize-html` avec balises et data URI d'images autorisés).

#### Pastille (badge) sur l'icône PWA — style messagerie professionnelle

- **Compteur visible sur l'icône d'application** ([client/src/services/appBadgeService.ts](client/src/services/appBadgeService.ts)) : utilise la **Web App Badging API** (`navigator.setAppBadge` / `clearAppBadge`) pour afficher un nombre directement sur l'icône de la PWA installée — exactement comme style messagerie professionnelle (24). Mise à jour automatique au démarrage, à chaque retour au premier plan (`visibilitychange`), au retour de connexion (`online`), à la réception d'une notification push (message du Service Worker) et à intervalle configurable.
- **Personnalisation utilisateur** ([client/src/components/notifications/NotificationPreferencesEditor.tsx](client/src/components/notifications/NotificationPreferencesEditor.tsx), [client/src/utils/notificationPrefs.ts](client/src/utils/notificationPrefs.ts)) : nouvelle section *Pastille de l'application* dans **Réglages → Notifications**. Options exposées :
  - **Activer/désactiver** la pastille ;
  - **Type d'information** : *mails non lus* (UNSEEN — défaut style messagerie professionnelle), *nouveaux mails reçus* (RECENT) ou *total des mails dans la boîte de réception* ;
  - **Comptes pris en compte** : *tous mes comptes (cumulé)* ou *compte par défaut uniquement* ;
  - **Cadence de rafraîchissement** (1 à 60 minutes) ;
  - **Plafond d'affichage** (au-delà l'OS affiche « 99+ »).
  Les valeurs sont stockées dans `notifications.prefs.v1.appBadge` et synchronisées multi-appareil via le mécanisme `prefsSync` existant.
- **Endpoint serveur léger** ([server/src/routes/mail.ts](server/src/routes/mail.ts), [server/src/services/mail.ts](server/src/services/mail.ts)) : nouvelle route `GET /api/mail/badge?source=…&scope=…` qui interroge IMAP via `STATUS` (très peu coûteux — pas de fetch de messages) et agrège le compteur sur tous les comptes assignés et possédés de l'utilisateur. Cache mémoire de 30 s par utilisateur+source pour limiter les connexions IMAP.
- **Compatibilité documentée** : ✅ Chrome / Edge desktop (PWA installée), ✅ Chrome Android (PWA installée). ⚠️ Non disponible sur Safari / iOS PWA — l'éditeur affiche un bandeau ambre explicite quand l'API n'est pas exposée par le navigateur.

#### Aperçu de notification fidèle à la limite OS d'actions

- **Respect dynamique de `Notification.maxActions`** ([client/src/components/notifications/NotificationPreview.tsx](client/src/components/notifications/NotificationPreview.tsx)) : l'aperçu mobile affichait jusqu'à 3 boutons d'action alors qu'Android Chrome n'expose que `Notification.maxActions = 2` dans la bannière collapsed (lock screen / volet). Le composant lit désormais cette propriété au runtime et masque les actions excédentaires, garantissant une parité visuelle 1:1 avec la vraie notif.
- **Bandeau d'avertissement** : quand des actions configurées sont effectivement coupées par l'OS, un bandeau ambre *« +N action(s) masquée(s) par l'OS (limite Notification.maxActions = X) »* s'affiche sous les boutons — l'utilisateur sait immédiatement pourquoi son 3ᵉ bouton n'apparaît pas dans la notification réelle.

#### Personnalisation avancée des notifications push (par plateforme : PC / mobile / tablette)

- **Schéma de préférences unifié** ([client/src/utils/notificationPrefs.ts](client/src/utils/notificationPrefs.ts)) : nouvelle clé `notifications.prefs.v1` avec trois sous-blocs indépendants `desktop`, `mobile`, `tablet`. Chaque plateforme définit son propre titre/corps templatisés (`{sender}`, `{senderEmail}`, `{accountEmail}`, `{accountName}`, `{appName}`, `{siteUrl}`, `{subject}`, `{preview}`), ses booléens de visibilité (afficher l'expéditeur, l'aperçu, l'image, le compte, l'icône d'app, l'horodatage), son lot d'actions (preset *style messagerie professionnelle* avec **Archiver / Supprimer / Répondre**, *Lecture seule*, *Minimal*, ou personnalisé), son son (5 sons synthétiques via Web Audio + URL custom), son volume, son pattern de vibration et sa stratégie de regroupement (`per-message` / `per-account` / `global`). Synchronisé multi-appareil via `BACKUP_KEYS`.
- **Aperçu live multi-supports** ([client/src/components/notifications/NotificationPreview.tsx](client/src/components/notifications/NotificationPreview.tsx)) : maquettes visuelles fidèles du rendu sur **Windows 11 (Centre de notifications)**, **Android (heads-up)** et **iOS (lock screen)** — l'utilisateur voit en temps réel l'effet de chaque modification (templates, actions, icônes, image, badge) avant d'appliquer.
- **Éditeur unifié avec onglets par plateforme** ([client/src/components/notifications/NotificationPreferencesEditor.tsx](client/src/components/notifications/NotificationPreferencesEditor.tsx)) : onglets *Bureau / Mobile / Tablette* (avec auto-détection de l'appareil courant), boutons **Écouter le son**, **Tester la vibration** et **Tester le rendu sur cet appareil** (vrai `showNotification` avec actions), plus un bouton optionnel **Envoyer un test via le serveur** (vrai Web Push relayé par le serveur, donc fidèle à 100 % à la production).
- **Réglages utilisateur** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : nouvelle section *Personnalisation des notifications* dans l'onglet Notifications, persiste localement (effet immédiat) puis pousse vers le serveur via `prefsSync`.
- **Réglages admin (valeurs par défaut globales)** ([client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : nouvel onglet **Notifications** dans le panneau Admin, qui écrit `admin_settings.notification_defaults` — appliqué automatiquement aux utilisateurs n'ayant pas encore défini leurs préférences personnelles.
- **Pipeline serveur par-abonnement** ([server/src/services/notificationPrefs.ts](server/src/services/notificationPrefs.ts), [server/src/services/push.ts](server/src/services/push.ts), [server/src/services/websocket.ts](server/src/services/websocket.ts), [server/src/services/newMailPoller.ts](server/src/services/newMailPoller.ts)) : `sendPushToUser` accepte désormais un *builder* qui reçoit la plateforme et le `User-Agent` de chaque abonnement push enregistré, et construit un payload distinct **par appareil** (limites Web Push respectées : 2 actions desktop / 3 mobile-tablette, vibration omise sur desktop, `silent` propagé). Cache mémoire 60 s avec invalidation sur sauvegarde des préférences (utilisateur ou admin).
- **Boutons d'action de style messagerie professionnelle fonctionnels** ([client/src/sw.ts](client/src/sw.ts), [client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : remplace l'ancien duo *Lire / Ignorer*. Le Service Worker mappe les actions `archive` / `delete` / `reply` / `markRead` / `flag` vers une URL profonde `/mail/{accountId}/INBOX?notifAction=…&notifUid=…` ; la page Courrier détecte ces paramètres au chargement et déclenche directement la mutation correspondante (déplacement vers Archive, suppression vers Corbeille, marquage comme lu, drapeau, ouverture du composer en mode réponse) avant de nettoyer l'URL via `history.replaceState`. **Aucun clic supplémentaire requis** depuis la notification.
- **Lecture du son configuré au premier plan** ([client/src/pwa/push.ts](client/src/pwa/push.ts)) : lorsque l'app est ouverte au moment de l'arrivée d'un push, le SW poste un message `play-notification-sound` qui déclenche `playNotificationSound` (Web Audio + sons custom URL), contournant l'absence de prise en charge fiable du son par les Service Workers Chromium/Edge.

#### Enregistrement des pièces jointes dans Nextcloud (Files)

- **Sauvegarde directe vers le drive Nextcloud personnel** ([client/src/components/mail/MessageView.tsx](client/src/components/mail/MessageView.tsx), [client/src/components/ui/NextcloudFolderPicker.tsx](client/src/components/ui/NextcloudFolderPicker.tsx)) : lorsque l'utilisateur a un compte Nextcloud lié (via le provisionnement admin existant), une icône **« nuage »** apparaît à côté de chaque pièce jointe ainsi qu'un bouton global **« Tout enregistrer dans Nextcloud »** au début de la barre des pièces jointes. Une entrée équivalente est ajoutée au menu *Aperçu / Téléchargement* (mode menu) et un bouton dédié dans l'en-tête de la modal d'aperçu plein écran.
- **Sélecteur de dossier avec arborescence** ([client/src/components/ui/NextcloudFolderPicker.tsx](client/src/components/ui/NextcloudFolderPicker.tsx)) : modale qui liste en direct les sous-dossiers du drive Nextcloud (PROPFIND), avec fil d'Ariane cliquable, bouton *Racine*, remontée d'un niveau, et création de sous-dossier à la volée. Le champ de création **accepte les chemins multi-niveaux** (`2026/Factures/Mai`) et déclenche un MKCOL récursif côté serveur — toute l'arborescence manquante est créée en une étape.
- **Anti-collision automatique** ([server/src/services/nextcloud.ts](server/src/services/nextcloud.ts)) : si un fichier du même nom existe déjà à la destination, un suffixe `(2)`, `(3)`, … est appliqué (sauf si l'overwrite est explicitement demandé). Le serveur sanitise les chemins (suppression des `..` et `\`) et plafonne l'upload à 100 Mo par fichier.
- **Pont WebDAV côté serveur** ([server/src/routes/nextcloudFiles.ts](server/src/routes/nextcloudFiles.ts)) : nouveau routeur monté sur `/api/nextcloud/files` (auth requise) — `GET /status`, `GET /list?path=…`, `POST /mkdir`, `POST /upload` (base64). Réutilise le client `NextCloudService` par utilisateur basé sur les identifiants chiffrés stockés dans `nextcloud_users` ; aucune nouvelle exigence de configuration admin (le drive Files est inclus dès lors qu'un utilisateur est lié).
- **Affichage opt-in** : si Nextcloud n'est pas lié pour l'utilisateur courant (`/api/nextcloud/files/status` renvoie `linked: false`), aucun bouton ni icône n'apparaît — comportement strictement progressif.

#### Mode d'affichage du corps des mails (natif / étiré)

- **Nouvelle préférence globale `mail.displayMode`** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : deux valeurs `native` (défaut, largeur de lecture ~820 px centrée à la style messagerie professionnelle) ou `stretched` (occupe toute la largeur disponible du volet de lecture). Événement `mail-display-mode-changed` pour synchroniser ruban, page Mail et vue message en temps réel.
- **Bouton *Affichage mail* dans le ruban → onglet *Afficher*** ([client/src/components/mail/Ribbon.tsx](client/src/components/mail/Ribbon.tsx)) : présent en ruban classique et simplifié, l'icône bascule entre `Minimize2` (natif) et `Maximize2` (étiré). Menu déroulant avec les deux options et libellés explicites *Natif (largeur de lecture)* / *Étiré (toute la largeur)*.
- **Override par message dans la vue message** ([client/src/components/mail/MessageView.tsx](client/src/components/mail/MessageView.tsx)) : état local `localDisplayMode` (réinitialisé à chaque changement de message) qui prime sur la préférence globale, permettant d'inverser ponctuellement l'affichage d'un mail particulier.
- **Classe CSS `.email-body-native`** ([client/src/index.css](client/src/index.css)) : applique `max-width: 820px` + `margin: auto` pour reproduire le rendu style messagerie professionnelle desktop centré.

### Corrigé

#### Bouton retour matériel/navigateur sur mobile (parité app native)

- **Le bouton retour OS reste désormais dans l'application** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : auparavant, sur mobile (Android/iOS) ou dans un navigateur, le geste / bouton retour quittait directement la page Courrier et renvoyait vers le bureau ou l'application précédente. La page intercepte désormais l'événement `popstate` (uniquement sous le breakpoint `md`, `max-width: 767px`) et le mappe sur la pile de navigation interne :
  - vue d'un message → retour à la **liste des mails** (`setMobileView('list')` + `selectMessage(null)`),
  - liste des mails → ouverture du **panneau des boîtes/dossiers** (`setMobileView('folders')` + `setShowFolderPane(true)`),
  - panneau des boîtes (sommet de la pile interne) → comportement par défaut conservé, l'utilisateur peut quitter l'app/page normalement.
- **Implémentation** : une entrée d'historique sentinelle (`history.state.__mailMobileBack = true`) est poussée au montage et re-poussée après chaque retour consommé, garantissant que les appuis successifs continuent d'être capturés. Une `mobileViewRef` synchronisée évite les fermetures obsolètes dans le handler `popstate`. Au démontage, la sentinelle est consommée si elle est encore en haut de la pile, pour ne pas exiger un appui retour supplémentaire en quittant la page Courrier. Sur tablette/desktop (`md+`), tous les panneaux étant visibles simultanément, l'interception n'est pas activée — le retour OS conserve son comportement par défaut.

#### Affichage des mails sur mobile (parité style messagerie professionnelle)

- **Plus aucun débordement horizontal sur mobile** ([client/src/index.css](client/src/index.css), [client/src/components/mail/MessageView.tsx](client/src/components/mail/MessageView.tsx)) : les newsletters HTML (typiquement `<table width="600">`) sortaient du viewport et imposaient un défilement horizontal. Deux corrections combinées :
  - **CSS `@media (max-width: 767px)`** : toutes les `table / tbody / tr / td / th` du `.email-body` passent en `display: block !important; width: 100% !important;` — les colonnes des newsletters s'empilent verticalement, exactement comme dans l'app mobile style messagerie professionnelle / des webmails courants. `min-width: 0 !important` + `max-width: 100% !important` + `box-sizing: border-box` sur **tous** les descendants neutralisent les `width:600` / `min-width:600` inline. `word-break: break-word` + `overflow-wrap: anywhere` cassent les longues URL de tracking.
  - **Conteneurs flex shrinkables** : ajout de `min-w-0` sur le wrapper racine `motion.div` et sur les deux conteneurs scrollables du corps (mode thread + mode message simple). Sans cela, la valeur par défaut `min-width: auto` des flex items refusait de réduire les tableaux de largeur fixe sous leur taille de contenu intrinsèque.
- **Barre d'objet masquée sur mobile en vue message simple** ([client/src/components/mail/MessageView.tsx](client/src/components/mail/MessageView.tsx)) : doublon avec l'objet déjà visible à droite du bouton retour. Conditionnée par `${isThreadMode ? '' : 'hidden md:block'}` — gain de hauteur appréciable sur petit écran. Reste visible en mode conversation (où plusieurs messages partagent la barre).
- **Informations de l'expéditeur repliables sur mobile** ([client/src/components/mail/MessageView.tsx](client/src/components/mail/MessageView.tsx)) : nouvel état `mobileSenderExpanded` (défaut `false`, réinitialisé à chaque changement de message). Un bouton mobile affiche le nom + chevron (`ChevronRight` / `ChevronDown`) ; replié, seul le nom apparaît, déplié on retrouve l'email entre `< >`, les destinataires (`À :` / `Cc :`) et la date. Sur desktop (`md+`) la disposition originale reste affichée intégralement.
- **Centrage du corps de mail sur desktop** ([client/src/index.css](client/src/index.css)) : auparavant collé à gauche, le corps est désormais centré (`margin-left: auto; margin-right: auto`) avec une largeur de lecture confortable de 820 px en mode natif, parité avec style messagerie professionnelle desktop. Les tables centrées des newsletters (`<center><table>`) restent correctement centrées (la règle `width: auto` qui collapsait les tables 600 px à leur contenu a été retirée).

#### Répondeur d'absence (vacation auto-responder)

- **Configuration utilisateur par boîte mail** ([client/src/components/mail/AutoResponderForm.tsx](client/src/components/mail/AutoResponderForm.tsx), [client/src/components/mail/AutoResponderModal.tsx](client/src/components/mail/AutoResponderModal.tsx)) : nouveau formulaire dédié pour activer / désactiver une réponse automatique par compte, choisir l'objet, le corps en HTML (éditeur riche réutilisé), une plage de dates `start_at` / `end_at` optionnelle, et limiter à *une seule réponse par expéditeur sur N jours* pour éviter le spam de retour.
- **Bouton « Répondeur » dans l'onglet *Afficher* du ruban** ([client/src/components/mail/Ribbon.tsx](client/src/components/mail/Ribbon.tsx), [client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : présent en ruban classique et simplifié, l'icône `Coffee` s'illumine quand un répondeur est actif sur le compte sélectionné. Ouvre la modale de configuration directement depuis la page Messagerie.
- **Onglet « Répondeur » dans Paramètres** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : section autonome listant tous les comptes, avec édition du formulaire en bloc.
- **Détection IMAP en arrière-plan** ([server/src/services/newMailPoller.ts](server/src/services/newMailPoller.ts), [server/src/services/autoResponderService.ts](server/src/services/autoResponderService.ts)) : le poller gère désormais deux populations distinctes — les comptes ayant un abonnement push **et** les comptes ayant un répondeur actif (jointure via `mail_accounts.user_id` **ou** `mailbox_assignments.user_id` pour les boîtes partagées). Première passe baseline : enregistre le `MAX(uid)` actuel et rattrape les nouveaux UID arrivés depuis `MAX(updated_at, start_at)` (cap 7 jours / 20 messages) pour ne jamais manquer un message reçu pendant la fenêtre de configuration.
- **Garde-fous anti-boucle** : aucune réponse n'est envoyée pour les en-têtes `Auto-Submitted`, `List-Unsubscribe`, `Precedence: bulk/list/junk`, ou les expéditeurs `MAILER-DAEMON` / `noreply@` / `no-reply@`. Le déduplicateur SQL `auto_replies_sent` garantit qu'un même expéditeur ne reçoit pas deux fois la même réponse pendant la fenêtre configurée.
- **Fréquence de vérification par utilisateur** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : préférence `mail.newMailPollMinutes` (valeurs `0`, `1`, `5`, `15`, `30`, `60`, `0` = jamais), réglable dans **Paramètres → Messagerie → Synchronisation**.
- **Page d'administration *Répondeurs automatiques*** ([client/src/components/admin/AdminAutoResponders.tsx](client/src/components/admin/AdminAutoResponders.tsx), [server/src/routes/admin.ts](server/src/routes/admin.ts)) : liste tous les répondeurs configurés sur la plateforme avec filtre texte, bascule *afficher uniquement les actifs*, dates, sujet, propriétaire, état. L'admin peut **éditer** ou **désactiver** n'importe quel répondeur, et **en créer un nouveau** pour n'importe quel utilisateur — bouton *Nouveau répondeur* qui ouvre une modale d'autocomplétion sur l'ensemble des comptes (`mail_accounts.user_id` **ou** `mailbox_assignments.user_id`, idéal pour les comptes partagés).
- **Toggle global et durée par défaut configurables par l'administrateur** ([client/src/components/admin/AdminAutoResponders.tsx](client/src/components/admin/AdminAutoResponders.tsx), [server/src/routes/admin.ts](server/src/routes/admin.ts), [server/src/routes/autoResponder.ts](server/src/routes/autoResponder.ts)) : nouveau bouton **Paramètres** (icône engrenage) à côté de *Nouveau répondeur*. Ouvre une modale avec :
  - une **bascule activé/désactivé** : quand la fonction est désactivée, le bouton « Répondeur » du ruban et l'onglet « Répondeur » des paramètres utilisateur sont masqués, le poller cesse de surveiller les boîtes uniquement éligibles via le répondeur, l'envoi automatique est court-circuité, et toute requête `PUT /api/auto-responder/account/:id` est refusée en `403`.
  - un **sélecteur de durée par défaut entre vérifications** (`1 / 5 / 15 / 30 / 60 min`, défaut `5 min`). Appliqué à tous les utilisateurs qui n'ont pas explicitement réglé `mail.newMailPollMinutes` dans leurs paramètres.
### Corrigé

#### Répondeur d'absence

- **Rattrapage des mails reçus avant le démarrage du poller** ([server/src/services/newMailPoller.ts](server/src/services/newMailPoller.ts)) : auparavant, le rattrapage des messages ne s'exécutait qu'à la **toute première observation** d'un compte par le poller. Si l'utilisateur (ou l'administrateur) créait/modifiait un répondeur **après** que le baseline UID était déjà enregistré, aucune réponse automatique n'était envoyée aux mails reçus. Une nouvelle map `lastCatchUpAt` (par compte) déclenche désormais un rattrapage à chaque tick dès que `auto_responders.updated_at` est plus récent que la dernière passe — couvre la création depuis l'admin, la modification du sujet/corps, la modification des dates, etc. Le déduplicateur de cooldown reste le filet anti-double-envoi.
- **Boîtes mail partagées (`mailbox_assignments`) prises en compte par le poller** ([server/src/services/newMailPoller.ts](server/src/services/newMailPoller.ts)) : la requête `SELECT * FROM mail_accounts WHERE user_id = ANY(...)` ratait les comptes provisionnés/partagés où `mail_accounts.user_id IS NULL`. Remplacée par `LEFT JOIN mailbox_assignments` + `WHERE ma.user_id = ANY(...) OR mba.user_id = ANY(...)`, avec `COALESCE(ma.user_id, mba.user_id)` comme `user_id` effectif passé à `maybeSendAutoReply`.
- **Objet de la réponse automatique respecte la configuration** ([server/src/services/autoResponderService.ts](server/src/services/autoResponderService.ts)) : auparavant, la réponse était envoyée avec `Re: <objet du message reçu>` (préfixe automatique inspiré de la rédaction classique), ce qui faisait apparaître l'ancien objet dans la boîte du destinataire au lieu du libellé configuré (ex. *« Réponse automatique - Absence »*). La logique utilise désormais **directement** `responder.subject` (ou *« Réponse automatique »* en repli si vide). Les en-têtes `In-Reply-To` / `References` sont conservés pour préserver le chaînage côté client mail du destinataire.

#### Délai entre deux réponses au même expéditeur configurable par l'administrateur

- **Nouveau réglage côté admin** ([client/src/components/admin/AdminAutoResponders.tsx](client/src/components/admin/AdminAutoResponders.tsx), [server/src/routes/admin.ts](server/src/routes/admin.ts), [server/src/services/autoResponderService.ts](server/src/services/autoResponderService.ts)) : la modale **Paramètres du Répondeur** propose désormais un sélecteur *« Délai entre deux réponses au même expéditeur »* avec les valeurs `Toujours répondre / 1 / 2 / 3 / 4 jours` (défaut `4 jours`, cohérent avec RFC 3834). Auparavant, ce délai était une constante codée en dur (`REPLY_COOLDOWN_MS = 4 * 24h`).
- **Comportement précis** :
  - **X jours** (1 à 4) : après une première réponse à un expéditeur, les mails suivants reçus de lui dans la fenêtre de X jours sont **ignorés** (aucune réponse). Le compteur n'est relancé qu'à la **réception d'un nouveau message après expiration du délai** — les mails arrivés pendant la période d'attente ne déclenchent jamais d'envoi rétroactif (anti-rafale).
  - **Toujours répondre** : envoie une réponse à **chaque mail** reçu, sans aucune fenêtre de cooldown. À utiliser avec prudence (risque de boucle si le destinataire est lui-même un répondeur — les garde-fous d'en-têtes `Auto-Submitted` / `List-Unsubscribe` / `Precedence` restent actifs).
- **Stockage** : `admin_settings.auto_responder_cooldown_days` (`0` = toujours, `1`-`4` = jours), valeur lue à chaque tentative d'envoi par `getCooldownDays()` dans `autoResponderService.ts` — modification immédiate sans redémarrage.

#### Réinitialisation des compteurs de cooldown (admin)

- **Bouton global dans la modale Paramètres du Répondeur** ([client/src/components/admin/AdminAutoResponders.tsx](client/src/components/admin/AdminAutoResponders.tsx)) : nouveau bouton *« Réinitialiser tous les compteurs »* en bas de la modale, avec confirmation. Vide `replied_log` (la table d'historique des expéditeurs déjà notifiés) sur **tous les répondeurs** en une opération. Au prochain mail reçu, une nouvelle réponse sera envoyée même pour les expéditeurs qui étaient encore dans la fenêtre de cooldown.
- **Bouton par ligne dans la liste des répondeurs** ([client/src/components/admin/AdminAutoResponders.tsx](client/src/components/admin/AdminAutoResponders.tsx)) : icône `RotateCcw` à côté de *Modifier* / *Désactiver* — réinitialise le compteur **d'un seul compte** ciblé.
- **Endpoint serveur** ([server/src/routes/admin.ts](server/src/routes/admin.ts)) : `POST /api/admin/auto-responders/reset-counters` accepte un body optionnel `{ accountId }` (sinon réinitialisation globale), met `replied_log = '{}'::jsonb` + `updated_at = NOW()`, journalisé via `addLog('auto_responder.reset_counters', …)`.

### Ajouté

#### Taille du texte du volet « Dossiers » personnalisable

- **Nouvelle préférence `ui.folderPaneFontSize`** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : 4 paliers (`sm` 13 px, `md` 15 px, `lg` 17 px, `xl` 19 px) avec libellés FR (*Petit*, *Normal*, *Grand*, *Très grand*) et événement `folder-pane-font-size-changed` qui met à jour en temps réel toutes les vues ouvertes sans rechargement.
- **Le volet *Dossiers* écoute la préférence** ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)) : le conteneur scrollable applique `style={{ fontSize: ... }}` ; les boutons enfants (compte, dossier, favori, dossier virtuel, catégorie favorite) utilisent `text-[length:inherit]` afin d'hériter automatiquement de la taille choisie. Les hauteurs minimales `min-h-[40px]/[44px]` restent garanties pour préserver l'accessibilité tactile.
- **Réglage utilisateur dans Paramètres → Apparence** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : nouveau composant `FolderPaneFontSizePicker` — quatre boutons radio « Aa » qui prévisualisent la taille à appliquer, avec toast de confirmation. Visible sur tous les terminaux mais surtout pensé pour mobile / tablette.
- **Réglage rapide dans le ruban Mail → Afficher** ([client/src/components/mail/Ribbon.tsx](client/src/components/mail/Ribbon.tsx)) : nouveau bouton *Texte volet* (icône `Type`) à côté de *Densité*, présent à la fois en ruban classique (col + chevron) et en ruban simplifié (inline). Le menu déroulant prévisualise chaque palier à sa taille réelle et affiche la valeur en pixels. Synchronisé via le même événement global, donc les changements faits côté Paramètres apparaissent immédiatement dans le ruban et inversement.
- **Synchronisée entre appareils** : la clé est ajoutée à `BACKUP_KEYS` ([client/src/utils/backup.ts](client/src/utils/backup.ts)) — la taille préférée est sauvegardée localement et synchronisée vers `user_preferences` côté serveur (limite de 64 Ko largement respectée).

### Modifié

#### Bouton « Nouveau message » du volet *Dossiers* masqué sur mobile / tablette

- **Doublon supprimé** ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)) : le bouton bleu *Nouveau message* en haut du volet passe en `hidden md:block` — sur mobile et tablette, le **bouton flottant (FAB)** déjà présent en bas (préférence `ui.fabPosition`) assure exactement la même fonction. La place récupérée bénéficie à la liste des comptes / dossiers / favoris (premier élément immédiatement visible). Sur desktop (`md+`) le bouton historique reste affiché en haut du volet.

#### Liste des boîtes mail tactile sur mobile / tablette

- **Zones tactiles agrandies** ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)) : tous les éléments cliquables du volet *Dossiers* (en-tête de compte, chevron déplier/replier, en-tête *Favoris*, dossiers virtuels *Boîte de réception / Éléments envoyés unifiés*, favoris, dossiers IMAP, catégories favorites, bouton *Nouveau message*) passent en `min-h-[40px]` à `min-h-[44px]` et `py-2.5` (vs `py-1` historique) en `< md` — ce qui correspond aux recommandations Apple HIG / Material (44 px) pour un usage au doigt sans rater la cible. En `md+` la densité visuelle d'origine est conservée (`min-h-0`, `py-1`).
- **Texte légèrement agrandi** : libellés des dossiers / comptes / favoris en `text-[15px]` sur mobile (vs `text-sm` = 14 px), plus lisible sur petit écran sans casser l'alignement vertical.
- **Icônes plus grandes au doigt** : icônes des dossiers et favoris bumpées de 14 → 16 px sur mobile (chevrons : 12 → 16 px ; pastilles couleur : 8 → 10 px), avec override `md:w-3.5 md:h-3.5` pour rester denses sur desktop.
- **Chevron déplier/replier des comptes plus tolérant** : `p-1.5 -m-1` en mobile (vs `p-0.5`) — la zone cliquable atteint ~28 px sans déplacer le rendu visuel grâce au `negative margin`, ce qui évite d'ouvrir le compte par erreur quand on voulait juste le déplier (et inversement).
- **Espacement vertical entre comptes** : `mb-2 md:mb-1` pour aérer la liste sur mobile.
- **`GripVertical` (poignée de glisser-déposer) masqué en `< md`** : invisible et inutile au tactile, il libère un peu d'espace horizontal.
- **Bouton *Nouveau message* renforcé** : `py-3` + `min-h-[44px]` + icône 18 px sur mobile pour rester la cible la plus évidente du volet.

### Ajouté

#### Sélecteur de vue calendrier et recherche unifiée sur mobile / tablette

- **Sélecteur de vue style messagerie professionnelle** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : sur mobile et tablette (`< lg`, 1024 px), un bouton dédié situé en haut à droite du panneau calendrier (à côté de l'icône loupe) permet de basculer librement entre les vues **Jour**, **Semaine de travail**, **Semaine**, **Mois** et **Agenda**. L'icône reflète la vue active (`Calendar`, `CalendarRange`, `CalendarDays`, `List`) et un menu déroulant met en surbrillance la vue courante avec une coche. Le verrouillage automatique en vue *Jour* sur petits écrans a été supprimé : seul `dayCount` reste forcé à 1 pour préserver la lisibilité. Sur desktop (`lg+`), le ruban classique reste l'unique point d'accès aux vues.
- **Boîte de dialogue de recherche unifiée** ([client/src/components/calendar/UnifiedSearchDialog.tsx](client/src/components/calendar/UnifiedSearchDialog.tsx)) : nouvelle icône loupe en haut à droite de la page calendrier (mobile/tablette uniquement) qui ouvre une recherche **transverse à tous les agendas et toutes les boîtes mail** de l'utilisateur, en s'appuyant sur l'endpoint serveur existant `GET /api/search`. Champ de saisie avec debounce de 250 ms, indicateur de chargement, fermeture par `ESC` ou clic en dehors. Résultats regroupés en deux sections : **Événements** (pastille couleur du calendrier, date/heure formatées en français, lieu, calendrier d'origine) et **E-mails** (objet, expéditeur, snippet, date). Cliquer un événement bascule la page calendrier en vue *Jour* à la date de l'événement ; cliquer un e-mail navigue vers `/mail?search=…`.

### Modifié

#### Pages Paramètres et Administration : navigation maître/détail sur mobile / tablette

- **Liste plein écran à l'ouverture, détail plein écran après sélection** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx), [client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : sur mobile et tablette (`< md`, 768 px), la barre d'onglets horizontale défilable est remplacée par la même logique que les pages Messagerie et Calendrier — à l'arrivée, la **liste verticale** des sections occupe tout l'écran ; cliquer une option masque la liste et affiche le détail en plein écran. Un bouton **hamburger (icône `Menu`) en haut à gauche** de la zone de contenu, accompagné de l'icône + libellé de la section active, permet de revenir à la liste pour choisir une autre option. Le comportement desktop (`md+`) reste inchangé : sidebar verticale 224 px à gauche, contenu à droite, les deux visibles simultanément.

### Corrigé

#### Affichage de la liste des boîtes mail sur mobile / tablette

- **Bouton « Afficher la liste des dossiers » masqué sur petits écrans** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx)) : l'icône `PanelLeftOpen` / `PanelLeftClose` du header de la liste de messages passe en `hidden md:inline-flex`. Sur mobile/tablette c'est désormais le **hamburger global** (header de [client/src/components/Layout.tsx](client/src/components/Layout.tsx)) qui pilote l'ouverture/fermeture du volet *Dossiers*, en cohérence avec les pages Calendrier, Paramètres et Administration. Le bouton reste affiché en `md+` où il sert à plier le panneau côté desktop.
- **Titre cohérent quand un favori unifié est ouvert** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : la barre supérieure de la vue liste mobile affichait le nom du dernier compte cliqué (ex. *« Fréd Perso »*) alors que l'utilisateur consultait *Favoris > Boîte de réception unifiée*. Le libellé prend désormais en compte `virtualFolder` et affiche **« Boîte de réception (Favoris) »** ou **« Éléments envoyés (Favoris) »** quand un favori unifié est actif, et bascule sur le nom du compte uniquement quand un dossier réel est sélectionné.
- **Plus de double sélection dans l'arbre des dossiers** ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)) : ouvrir un favori unifié laissait la précédente paire `(selectedAccount, selectedFolder)` du store côté Zustand, ce qui provoquait une **double surbrillance** (le favori actif **et** un dossier classique comme *Brouillons* dans le compte précédemment ouvert) et générait des erreurs d'affichage de la liste de mails. `AccountFolders` lit désormais `virtualFolder` depuis `useMailStore` et la règle `isSelected` du `renderFolder` exige `!virtualFolder` — un seul élément est en surbrillance à la fois (`FavoritesSection` appliquait déjà cette règle, le bug ne touchait que l'arbre par compte).

#### Déplacement de message vers la corbeille (erreur 500)

- **Pré-création du dossier de destination** ([server/src/services/mail.ts](server/src/services/mail.ts)) : `MailService.moveMessage()` appelle désormais `client.mailboxCreate(toFolder)` avant `messageMove`, en ignorant silencieusement l'erreur `ALREADYEXISTS`. Ceci corrige l'erreur `500 Internal Server Error` rencontrée sur `POST /api/mail/accounts/:id/messages/:uid/move` quand le dossier *Trash* / *Corbeille* / *Deleted Items* n'existait pas encore sur le compte IMAP (cas typique sur Dovecot/o2switch). La détection d'un `messageMove` no-op (UID introuvable) lève une erreur explicite *« Le message UID … est introuvable dans … »* au lieu de prétendre avoir déplacé un message inexistant.
- **Logs serveur détaillés** ([server/src/routes/mail.ts](server/src/routes/mail.ts)) : la route `POST /messages/:uid/move` journalise désormais `accountId`, `uid`, `fromFolder`, `toFolder`, message d'erreur, code IMAP et réponse serveur en cas d'échec, et renvoie un message d'erreur jamais `undefined` au client. Les paramètres manquants (`fromFolder`/`toFolder`) sont rejetés en `400` plutôt qu'en `500`.

#### Lecture et suppression des e-mails sur mobile / tablette

- **Mise en page de l'en-tête de message non chevauchée** ([client/src/components/mail/MessageView.tsx](client/src/components/mail/MessageView.tsx)) : le nom de l'expéditeur et son adresse `<email>` sont désormais dans un conteneur `flex-wrap` avec `gap-x-1` (et `truncate max-w-full` sur chaque segment) — l'adresse passe à la ligne sur mobile au lieu de se superposer au nom. La colonne d'actions à droite est masquée en `< md` et remplacée par une **barre d'actions sur sa propre ligne** sous l'en-tête, scindée en deux groupes : *Répondre / Répondre à tous / Transférer* à gauche, *Indicateur (étoile) / Corbeille / Plus* à droite. Plus aucun chevauchement entre l'identité de l'expéditeur et les boutons corbeille/favori. La date passe sous les destinataires sur mobile et reste à droite sur desktop.
- **Corps du message responsive** ([client/src/index.css](client/src/index.css), [client/src/components/mail/MessageView.tsx](client/src/components/mail/MessageView.tsx)) : neutralisation des `<table width="600">` typiques des newsletters HTML (`max-width: 100% !important`, `width: auto !important`, `table-layout: auto !important`), `word-break` + `overflow-wrap: anywhere` sur `td/th/pre/code/a` pour empêcher les longues URL ou cellules de pousser la mise en page au-delà du viewport, et `max-width: 100%` + `overflow-x: auto` sur `.email-body` (le scroll horizontal est contenu à l'intérieur du message si nécessaire). Le padding latéral passe à `px-3 sm:px-6` (vue simple) et `px-3 sm:px-5` (vue conversation) pour récupérer ~24 px de largeur utile sur petit écran.
- **Retour automatique à la liste après suppression** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : sur mobile/tablette, supprimer le message en cours de lecture provoquait l'affichage du placeholder *« Sélectionnez un message pour le lire »* au lieu de revenir à la liste. `deleteMutation.onMutate` détecte désormais si le message ouvert est celui qui vient d'être supprimé et bascule automatiquement `mobileView` sur `'list'`. Aucun changement de comportement sur desktop (le mode `mobileView` n'a aucun effet en `md+`).

#### Synchronisation des signatures avec images embarquées

- **Limite de taille par préférence augmentée pour les clés contenant du contenu riche** ([server/src/routes/settings.ts](server/src/routes/settings.ts)) : la limite globale de 64 Ko empêchait la synchronisation des signatures contenant des images base64 (erreur `413 Content Too Large` sur `mail.signatures.v1`). Une nouvelle fonction `maxBytesForKey(key)` étend la limite à **4 Mo** pour les clés préfixées `mail.signatures.` et `mail.templates.`, tout en conservant le plafond historique de 64 Ko pour les autres préférences (couleurs, layout, swipe, etc.). Le message d'erreur 413 indique désormais la limite réelle qui s'applique à la clé concernée.

### Ajouté (suite)

#### Notifications push pour les rappels d'événements calendrier

- **Nouveau service serveur `calendarReminderPoller`** ([server/src/services/calendarReminderPoller.ts](server/src/services/calendarReminderPoller.ts)) : tourne toutes les 60 s (configurable via `CALENDAR_REMINDER_POLL_INTERVAL_MS`) et envoie une notification Web Push + WebSocket à l'utilisateur dès que `start_date - reminder_minutes ≤ NOW()` pour un événement à venir. Le payload contient le titre (préfixé ⏰), la date formatée en français, une indication relative (« dans 15 min »), et le lieu s'il est renseigné. Cliquer la notification ouvre `/calendar?event=<id>`.
- **Migration BD** ([server/src/database/connection.ts](server/src/database/connection.ts)) : ajout de la colonne `reminder_sent_at TIMESTAMPTZ` sur `calendar_events`, d'un index partiel `idx_events_reminder_pending` pour des scans efficaces, et d'un trigger `trg_reset_reminder_sent_at` qui remet `reminder_sent_at` à `NULL` quand l'utilisateur modifie `start_date` ou `reminder_minutes` — ainsi un rappel reprogrammé refire correctement.
- **Anti-doublon** : `reminder_sent_at = NOW()` après envoi réussi ; fenêtre de grâce de 1 h (configurable via `CALENDAR_REMINDER_GRACE_MS`) pour éviter de spammer au démarrage du serveur sur des événements anciens.
- **Câblage** : `startCalendarReminderPoller()` lancé au démarrage du serveur ([server/src/index.ts](server/src/index.ts)), à côté de `startNewMailPoller()`.
- **Limitations** : un seul VALARM par événement (schéma `reminder_minutes` unique) ; les événements récurrents (`recurrence_rule IS NOT NULL`) sont ignorés en v1 — un suivi par occurrence (table `calendar_reminder_deliveries`) sera nécessaire pour les gérer.

#### Pages Contacts, Paramètres et Administration responsives (mobile / tablette)

- **Pages *Paramètres* et *Administration* adaptées aux petits écrans** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx), [client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : la barre latérale verticale `w-56` (qui amputait l'espace de contenu sur mobile/tablette) est remplacée en `< md` (768 px) par une **barre d'onglets horizontale défilable** (`overflow-x-auto`) collée en haut. Chaque onglet conserve son icône et son libellé et bascule sur la pastille bleue style messagerie professionnelle lorsqu'il est actif. En `md+`, la disposition historique (sidebar verticale + contenu à droite) est préservée. Le padding du conteneur passe à `p-3 sm:p-4 md:p-6` pour récupérer de la place sur petit écran.
- **Page *Contacts* en vue maître/détail responsive** ([client/src/pages/ContactsPage.tsx](client/src/pages/ContactsPage.tsx)) : sur mobile/tablette (`< md`), la liste des contacts occupe toute la largeur tant qu'aucun contact n'est sélectionné ; en cliquant sur un contact, la fiche détaillée prend le relais en plein écran avec un bouton **« Retour »** (icône `ChevronLeft`) en barre supérieure pour revenir à la liste. La poignée de redimensionnement de la barre latérale est masquée (`hidden md:block`) sur petits écrans. La largeur fixe (`sidebarWidth`) n'est appliquée qu'à partir de 768 px ; en dessous, la liste utilise `w-full`. Le comportement côte-à-côte historique est conservé sur desktop (`md+`).

#### Vue Agenda dans le calendrier

- **Nouvelle vue « Agenda »** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx), [client/src/components/calendar/CalendarRibbon.tsx](client/src/components/calendar/CalendarRibbon.tsx)) : liste plate de tous les événements groupés par jour, à la manière d'style messagerie professionnelle Mobile. Chaque jour affiche un en-tête (`mardi 25 avril`) — coloré en bleu si c'est aujourd'hui — suivi de ses événements triés (les *Toute la journée* en premier, puis chronologiquement). Pastille colorée du calendrier, heure de début, titre et lieu. Accessible depuis tous les rubans (simplifié + classique, onglets *Accueil* et *Afficher*) et le menu *Vues enregistrées*.
- **Plage de chargement adaptée** : la vue Agenda charge automatiquement `currentDate − 1 mois` à `+ 2 mois` afin de couvrir le passé récent et les prochaines semaines en une seule requête. La navigation `<` `>` se fait par mois.
- **Disponible aussi sur mobile** : contrairement aux autres vues qui sont forcées en *Jour* sur petits écrans, la vue Agenda reste utilisable telle quelle (idéale pour un usage tablette / téléphone).
- État vide explicite avec bouton *Créer un nouvel événement*.

#### Bouton flottant (FAB) sur mobile et tablette

- **Nouveau composant réutilisable** [client/src/components/ui/FloatingActionButton.tsx](client/src/components/ui/FloatingActionButton.tsx) : bouton circulaire `bg-style messagerie professionnelle-blue` (icône + label accessible), rendu uniquement en `md:hidden` (mobile/tablette) et masqué automatiquement sur desktop où le ruban suffit.
- **Branché sur la page Messagerie** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : ouvre la fenêtre de composition (`openCompose()`). Masqué pendant qu'un brouillon est ouvert pour éviter le chevauchement.
- **Branché sur la page Calendrier** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : ouvre le formulaire *Nouvel événement* pré-rempli sur la date courante.

#### Préférence « Position du bouton flottant » (9 emplacements)

- **Nouvelle clé `ui.fabPosition`** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : 9 positions possibles (haut/milieu/bas × gauche/centre/droite) avec validation et événement `fab-position-changed` pour la mise à jour en temps réel sur toutes les pages ouvertes. Valeur par défaut : `bottom-right`.
- **Sélecteur visuel dans Paramètres → Apparence** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : grille radio 3×3 montrant l'emplacement actuel d'un coup d'œil ; clic = sauvegarde immédiate avec toast de confirmation et libellé en clair (« Bas droite », « Milieu centre »…).
- **Synchronisée entre appareils** : la clé est ajoutée à `BACKUP_KEYS` ([client/src/utils/backup.ts](client/src/utils/backup.ts)) — elle est sauvegardée localement et synchronisée vers `user_preferences` côté serveur, ce qui permet à un utilisateur droitier de retrouver son FAB en bas à droite sur tous ses terminaux.

#### Personnalisation de la couleur des comptes (boîtes mail)

- **Nouvelle clé `mail.accountColors`** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : surcharge utilisateur de la couleur d'un compte ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)). Helpers `getAccountColor`, `setAccountColorOverride` (avec validation hex `#RRGGBB`), surcharge non-destructive de la couleur fournie par le serveur (`account.color`).
- **Menu contextuel sur le compte** : nouveau sous-menu *Couleur de la boîte mail* avec les 24 couleurs style messagerie professionnelle standard (`CATEGORY_COLORS`) plus *Réinitialiser la couleur*, identique à ce qui existe déjà pour les dossiers.
- Toutes les pastilles de couleur du compte (en-tête, dossier dépliable, bouton compact) lisent désormais via `getAccountColor(account)` pour refléter immédiatement la surcharge.
- **Synchronisée entre appareils** via `BACKUP_KEYS`.

### Corrigé

#### Affichage mobile / tablette — boîtes mails et calendrier

- **Liste des comptes / dossiers à nouveau accessible sur mobile et tablette** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : sur écran < 1280 px, la sélection d'un dossier replie automatiquement le panneau (`showFolderPane = false`). Le bouton hamburger et la flèche retour de la liste des messages ne le rétablissaient plus, rendant la liste des boîtes mails inaccessible. Le toggle force désormais `showFolderPane = true` en plus de basculer la vue mobile.
- **Page Calendrier lisible en mobile / tablette** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : la `CalendarSidebar` (256 px) s'affichait en flux normal et écrasait la grille du calendrier en dessous de `lg`. Elle est désormais affichée en *overlay* (`absolute inset-y-0 left-0 z-30 max-w-[85%]`) avec un fond semi-transparent en mobile/tablette ; en `lg+` le comportement précédent (sidebar en flux à côté du calendrier) est préservé. Choisir une date ou tapoter le fond ferme l'overlay.
- **Bouton « Nouvel événement » dédoublé masqué sur petits écrans** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : le bouton de l'en-tête (`hidden lg:flex`) ne s'affiche plus en mobile/tablette puisque le FAB couvre déjà cet usage, ce qui libère de l'espace pour le titre de période.
- **FAB Messagerie : ouvre toujours la modale de composition** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : taper sur le FAB depuis la liste passait `isComposing = true` mais le panneau de composition n'était rendu que pour `mobileView === 'message'`, ce qui faisait disparaître le bouton sans afficher la fenêtre. Le FAB bascule désormais d'abord sur la vue *message* avant d'ouvrir la composition.
- **FAB Messagerie : réapparaît après fermeture d'un brouillon** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : le drapeau local `composeExpanded` n'était pas remis à zéro quand la composition se fermait via la croix de l'onglet, ce qui maintenait le FAB caché. Un effet le réinitialise dès que `isComposing` redevient `false`. Le bouton est en outre visible dès que la vue mobile est sur la liste (même si un brouillon reste ouvert en arrière-plan), et un appui ramène alors au brouillon en cours plutôt que de le perdre.
- **Onglet *Pièces jointes* atteignable dans la modale d'événement sur mobile** ([client/src/components/calendar/EventModal.tsx](client/src/components/calendar/EventModal.tsx)) : la barre d'onglets (`Résumé / Récurrence / Participants / Pièces jointes`) débordait silencieusement sur petit écran et masquait le dernier onglet. Elle est désormais défilable horizontalement (`overflow-x-auto whitespace-nowrap`) avec un padding réduit (`px-2 sm:px-4`) sur chaque onglet.

#### Mise en cache non-bloquante à l'ouverture des dossiers

- **L'ouverture d'un dossier ne bloque plus l'affichage le temps de remplir le cache** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : `offlineDB.cacheEmails(...)` était appelé avec `await` dans la `queryFn` et dans `handleLoadMore`, ce qui faisait attendre l'écriture IndexedDB (potentiellement plusieurs centaines de messages déjà connus à chaque ouverture) avant de rendre la liste. La mise en cache est désormais *fire-and-forget* (`void offlineDB.cacheEmails(...).catch(() => {})`) — la liste s'affiche dès que les données réseau sont là, et l'écriture du cache se fait en arrière-plan sans impacter le temps perçu d'ouverture.

#### Liste des messages — sélection multiple et dossiers d'envoi

- **Sélection multiple en vue unifiée** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx)) : la sélection était indexée par `uid` seul, or un même UID peut exister dans plusieurs comptes/dossiers à la fois (vues *Boîte de réception unifiée* et *Éléments envoyés unifiés*). Cocher une ligne cochait toutes les lignes ayant le même `uid`, ce qui ressemblait à des doublons. La sélection utilise désormais une clé composite `accountId:folder:uid` (`Set<string>`) — chaque ligne est indépendante.
- **Affichage du destinataire dans les Éléments envoyés** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx)) : pour un mail envoyé, le champ `from` correspond à l'utilisateur lui-même, ce qui affichait *Inconnu / ?* dans la liste. Un helper `isSentLikeFolder` détecte les dossiers de type Sent (multilingue : `Sent`, `Sent Items`, `Éléments envoyés`, `Gesendet`, `Enviado`, `Inviata`, `Verzonden`, `Skickat`) et la liste affiche alors le **destinataire** (`to[0]`) — nom, initiales et couleur d'avatar — comme style messagerie professionnelle. S'applique aussi au dossier unifié `Sent`.

#### Vues unifiées — chargement bloqué avec « Tout charger »

- **Boîte de réception unifiée qui « tourne en boucle »** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : avec la préférence globale *autoLoadAll* activée, la `queryFn` unifiée bouclait jusqu'à 500 pages × N comptes **avant** de rendre quoi que ce soit. React Query ne pouvait restituer aucun résultat tant que la promesse n'était pas résolue, d'où le squelette permanent ; passer dans un autre dossier laissait la tâche se terminer en arrière-plan, faisant croire que le retour « réparait » la liste.
  - La queryFn unifiée ne récupère désormais **que la 1re page par compte** (résolution rapide, l'utilisateur voit ses messages dans la seconde).
  - Un nouvel effet *progressif* charge ensuite les pages 2..N en arrière-plan et les fusionne dans le cache via `queryClient.setQueryData(['virtual-messages', …], …)` avec déduplication par `accountId:folder:uid` et tri par date conservé. La liste s'allonge au fil du temps sans bloquer le rendu.
  - `loadAllActive` retiré de la queryKey unifiée → plus de refetch complet quand on bascule l'option, et le cache reste valide d'un mode à l'autre.
  - Annotation `_virtualTotal` portée sur chaque message pour détecter quand un compte a fini de tout charger et arrêter la boucle proprement.

#### Mobile / tablette — navigation panneau de dossiers ↔ liste

- **Le panneau des dossiers se referme automatiquement au clic sur un dossier** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : sur mobile (< 768 px) la vue bascule sur la liste comme avant, et sur tablette (< 1280 px) le panneau latéral se replie pour donner toute la largeur à la liste de messages. Plus besoin de cliquer manuellement sur l'icône *Masquer le panneau*. Un nouvel effet réagit aux changements de `selectedFolder`, `virtualFolder` et `selectedAccount` pour couvrir aussi les favoris (FAVORIS → Boîte de réception) et les boîtes unifiées qui appellent `selectVirtualFolder` directement dans le store. Le comportement desktop (≥ 1280 px) reste inchangé.

### Ajouté

#### Préférence « Charger automatiquement tous les messages »

- **Nouvelle option `mail.autoLoadAll`** ([client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts), [client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : case à cocher dans **Paramètres → Messagerie** qui, lorsqu'elle est activée, force chaque dossier (et chaque vue unifiée) à enchaîner la pagination automatique dès son ouverture jusqu'à atteindre le dernier message — plafond technique de 500 pages (25 000 messages) par dossier. Désactivée par défaut, le comportement reste celui de la pagination manuelle via les boutons *Charger plus* / *Tout charger* au bas de la liste.
- **Recherche locale étendue à toute la boîte mail** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : `loadAllActive` est désormais initialisé à partir de la préférence et n'est **plus remis à `false`** lors d'un changement de compte/dossier/vue tant que l'option globale est active. Le composant écoute l'événement `mail-auto-load-all-changed` (déclenché par `setAutoLoadAllEnabled`) ainsi que l'événement `storage` pour propager le réglage entre les onglets en temps réel.
- **Synchronisée entre appareils** : la clé est ajoutée à `BACKUP_KEYS` ([client/src/utils/backup.ts](client/src/utils/backup.ts)), donc elle est exportée par le système de sauvegarde locale **et** poussée par la synchronisation cloud des préférences vers la table `user_preferences`. Activer l'option sur un PC l'active automatiquement sur le téléphone et la tablette.

#### Synchronisation cloud des préférences entre appareils

- **Nouvelle table `user_preferences`** ([server/src/database/connection.ts](server/src/database/connection.ts)) : un magasin clé/valeur par utilisateur (`UUID user_id`, `VARCHAR(255) key`, `TEXT value`, `TIMESTAMPTZ updated_at`) avec clé primaire composite et index sur `user_id`. Stocke les personnalisations d'interface synchronisables.
- **Endpoints `/api/settings/preferences`** ([server/src/routes/settings.ts](server/src/routes/settings.ts)) :
  - `GET` retourne la map complète `{ items: { [key]: { value, updatedAt } } }` du compte courant.
  - `PUT` accepte un batch `{ items: { [key]: { value, updatedAt } } }` et fait un *upsert* `ON CONFLICT (user_id, key) DO UPDATE … WHERE user_preferences.updated_at < EXCLUDED.updated_at` — garantie **last-write-wins** stricte au niveau base de données. Toute la requête est dans une transaction (`BEGIN/COMMIT/ROLLBACK`). Validation : clés filtrées par `^[a-zA-Z0-9_.\-:]{1,255}$`, max 64 KiB par valeur, max 500 entrées par requête. La réponse renvoie uniquement les clés dont la mise à jour a effectivement été acceptée, ce qui permet au client de détecter les conflits.
  - `DELETE /:key` supprime une préférence individuelle.
- **Service client `prefsSync`** ([client/src/services/prefsSync.ts](client/src/services/prefsSync.ts)) : 
  - démarré automatiquement après connexion ([client/src/App.tsx](client/src/App.tsx)) ;
  - liste blanche partagée avec le système de sauvegarde locale (`BACKUP_KEYS` / `BACKUP_PREFIXES` exportés depuis [client/src/utils/backup.ts](client/src/utils/backup.ts)) — synchronise notamment : noms personnalisés des comptes (`mail.accountDisplayNames`), ordre des comptes et des dossiers (`mail.accountOrder`, `mail.folderOrder`), comptes/dossiers déplié·e·s et favoris (`mail.expandedAccounts`, `mail.favoriteFolders`), regroupements de boîtes unifiées (`mail.unifiedAccounts`), thème (`theme.mode`), signatures (`mail.signatures.v1`), catégories et couleurs (`mail.categories`), préférences de balayage et confirmations (`mail.swipePrefs`, `mail.deleteConfirmEnabled`), préférences calendrier et de mise en page ;
  - traque deux maps d'horodatages locaux (`prefsSync.local`, `prefsSync.remote`) pour ne pousser que les clés modifiées et n'appliquer un changement distant que s'il est strictement plus récent que la copie locale ;
  - boucle complète **pull → push → pull** au démarrage et à chaque modification (debounce 1,5 s), plus un *poll* toutes les 5 minutes pour les changements faits sur d'autres appareils pendant que l'app reste ouverte ;
  - écoute l'événement existant `local-settings-changed` (déjà émis par le watcher `localStorage` de `backup.ts`) et l'événement `storage` pour la synchronisation entre onglets ;
  - tente un dernier *push* sur `beforeunload`.
- **Section UI dans Paramètres → Sauvegarde** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : nouvelle sous-section *« Synchronisation cloud des préférences »* avec interrupteur d'activation, bouton **Synchroniser maintenant**, indicateur d'état (récupération / envoi / erreur) et horodatage de la dernière synchronisation réussie.

#### Pagination de la liste des messages — accès aux anciens e-mails

- **Bouton « Charger plus de messages »** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx), [client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : la liste des e-mails ne se limitait plus à la première page renvoyée par le serveur (50 messages les plus récents). Un bouton apparaît au bas de la liste tant que `messages.length < totalMessages` et déclenche `api.getMessages(accountId, folder, page + 1)`. Les nouveaux messages sont fusionnés sans doublon (par triplet `_accountId:_folder:uid`) puis re-triés par date dans le store via la nouvelle action `appendMessages` ([client/src/stores/mailStore.ts](client/src/stores/mailStore.ts)). Les messages chargés sont aussi indexés en IndexedDB pour la recherche hors-ligne.
- **Bouton « Tout charger »** : à côté de *Charger plus*, un toggle déclenche une boucle de pagination automatique qui enchaîne les pages jusqu'à ce que tous les messages du dossier soient récupérés. Cela permet de **rechercher dans l'intégralité de la boîte mail** (2026, 2025, archives anciennes…) au lieu de la seule première page. Le bouton repasse en *Arrêter le chargement* tant que la boucle tourne. Plafond de sécurité à 500 pages (= 25 000 messages) par dossier pour éviter une boucle infinie sur des serveurs IMAP qui mentent sur le total. Le mode est automatiquement désactivé lors d'un changement de compte/dossier/vue afin d'éviter de relancer une opération coûteuse par accident.
- **Vues unifiées (Boîte de réception / Envoyés unifiés)** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : la `queryFn` de la vue virtuelle reçoit aussi le mode *Tout charger*. Quand il est actif, chaque compte agrégé est paginé jusqu'au bout avant que les résultats soient triés par date et fusionnés. La clé de cache React Query inclut `'all'` vs `'first'` afin que les deux modes coexistent.

#### Performance perçue — affichage instantané depuis le cache

- **Hydratation immédiate de la liste depuis IndexedDB** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : lors d'un changement de dossier (ou au rechargement de la page), un `useEffect` lit `offlineDB.getEmails(accountId, folder)` et peuple le store avant même que la requête réseau ait commencé — l'utilisateur voit donc instantanément les messages connus. La requête React Query rafraîchit la liste en arrière-plan ; l'hydratation n'écrase rien si une donnée fraîche existe déjà dans le cache de React Query.
- **`placeholderData: keepPreviousData`** sur la requête `messages` : la liste précédente reste affichée pendant la récupération du nouveau dossier au lieu de clignoter en état vide. Combiné à un `staleTime: 2 min`, naviguer entre dossiers récemment consultés ne déclenche plus aucun appel réseau.
- **Identifiants IndexedDB normalisés** : les e-mails étaient stockés sous deux schémas concurrents (`{accountId}-{uid}` côté `MailPage`, `{accountId}-{folder}-{uid}` côté `cacheService`), ce qui provoquait des collisions quand le même UID existait dans plusieurs dossiers — un message du dossier *Brouillons* écrasait l'entrée *Boîte de réception* portant le même UID. Toutes les écritures utilisent désormais la forme composite `{accountId}-{folder}-{uid}`.

#### Gestes de balayage sur mobile et tablette (swipe-to-action)

- **Balayage horizontal d'un e-mail dans la liste** ([client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx)) : sur un appareil tactile (`matchMedia('(max-width: 1024px) and (pointer: coarse)')`), chaque ligne devient *draggable* horizontalement via `drag="x"` de Framer Motion. Seuil de validation de 90 px ou *flick* rapide (> 500 px/s). Fond coloré révélé pendant le geste avec icône et libellé de l'action, animation de sortie latérale avant exécution. Le drag-and-drop HTML5 vers le volet des dossiers reste actif sur desktop (les deux modes s'excluent mutuellement selon le média).
- **Actions configurables par direction** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx), [client/src/utils/mailPreferences.ts](client/src/utils/mailPreferences.ts)) : nouvelle section **Paramètres → Messagerie → Balayage**. Par défaut, *gauche = Archiver* et *droite = Corbeille*. Chaque direction peut être réglée indépendamment sur : *Aucune, Archiver, Corbeille, Déplacer, Copier, Drapeau/Favori, Marquer lu/non lu*. Un interrupteur global permet de désactiver complètement la fonctionnalité.
- **Confirmation de mise en corbeille optionnelle** : la case « Demander confirmation avant de mettre à la corbeille » (clé `mail.deleteConfirmEnabled`, partagée avec le ruban) est désormais exposée dans cette même section. Décochée, elle permet de nettoyer sa boîte de réception très rapidement d'une seule main.
- **Dossier de destination par défaut par compte** pour les actions *Déplacer* et *Copier* ([client/src/components/mail/FolderPickerDialog.tsx](client/src/components/mail/FolderPickerDialog.tsx)) : nouveau sélecteur modal réutilisable, avec recherche et bouton **« Créer un dossier »** (utile pour créer un dossier type *À trier* / *À traiter* directement depuis le picker). Si un dossier par défaut est configuré pour le compte, le balayage l'exécute sans interruption ; sinon le sélecteur s'ouvre et le premier choix est automatiquement mémorisé comme défaut (événement `mail-swipe-prefs-changed` diffusé pour rafraîchir l'UI). Les préférences sont stockées en `localStorage` sous la clé `mail.swipePrefs` et incluses dans l'export/import de sauvegarde ([client/src/utils/backup.ts](client/src/utils/backup.ts)).

#### Cache local des dossiers et messages

- **Pré-chargement complet en IndexedDB** ([client/src/services/cacheService.ts](client/src/services/cacheService.ts), [client/src/pwa/offlineDB.ts](client/src/pwa/offlineDB.ts)) : au démarrage (4 s après l'ouverture de session, si en ligne), le client parcourt chaque compte → chaque dossier (hors `\All` / `\Junk`) et met en cache l'arborescence complète et la première page des messages (sujet, expéditeur, date, snippet, métadonnées pièces jointes) dans IndexedDB pour accélérer l'affichage et la consultation hors-ligne. Les corps complets et octets des pièces jointes restent téléchargés à la demande.
- **Synchronisation incrémentale** ([client/src/services/cacheService.ts](client/src/services/cacheService.ts)) : chaque dossier possède sa propre entrée dans la store `meta` (clé `folder:<accountId>:<path>`) avec `syncedAt` + **empreinte** (liste triée `uid:seen:flagged`). Au rechargement de la page :
  - les dossiers synchronisés il y a moins de 10 min (`FOLDER_FRESHNESS_MS`) sont **sautés** sans appel réseau ;
  - les autres sont rafraîchis, mais si l'empreinte côté serveur correspond à celle stockée, **aucune écriture IndexedDB** n'est faite — seule l'horodatage est mis à jour ;
  - 4 dossiers sont traités en parallèle (`FOLDER_CONCURRENCY`) ;
  - le message de fin résume l'activité : *« Cache mis à jour — N dossier(s) actualisé(s), M inchangé(s) »* ou *« Cache déjà à jour »*.
  - les boutons manuels **Mettre à jour** et **Réinitialiser & reconstruire** passent `{ force: true }` pour outrepasser toutes les fraîcheurs et retélécharger chaque dossier.
- **Indicateur de progression dans la barre supérieure** ([client/src/components/CacheIndicator.tsx](client/src/components/CacheIndicator.tsx), [client/src/components/Layout.tsx](client/src/components/Layout.tsx)) : anneau SVG circulaire placé à gauche de l'avatar, indiquant en direct le pourcentage de mise en cache et l'état (`repos` / `en cours` / `terminé` / `erreur`). Un clic ouvre un popover listant l'action courante (« Dossier *Evelyne Berthy* — *fred@pro.com* »), la progression `X / Y dossiers traités`, l'horodatage de la dernière synchro et un bouton **Mettre à jour**.
- **Onglet « Cache local » dans Paramètres** ([client/src/components/CacheSettings.tsx](client/src/components/CacheSettings.tsx), [client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) :
  - 6 tuiles de statistiques : nombre d'e-mails, de pièces jointes, de dossiers, poids total du cache, poids des pièces jointes, date de dernière synchronisation.
  - Barre d'utilisation du **quota navigateur** (via `navigator.storage.estimate()`) affichant `usage / quota`.
  - Tableau détaillé par compte × dossier avec le nombre de messages mis en cache.
  - Boutons **Mettre à jour**, **Réinitialiser & reconstruire** (purge puis resync) et **Purger le cache** (confirmation en deux clics).
- **Store Zustand dédié** ([client/src/stores/cacheStore.ts](client/src/stores/cacheStore.ts)) : expose `isRunning`, `phase`, `progress`, `currentLabel`, `processedItems / totalItems`, `lastSyncAt`, `lastError`, `stats` à tous les composants observateurs.
- **Nouvelles stores IndexedDB** : `folders` (arborescence par compte) et `meta` (horodatage `lastSync`). `DB_VERSION` passe de 1 à 2 — migration automatique transparente.

### Corrigé

- **Suppression / sélection multiple involontaire dans la vue unifiée** ([client/src/stores/mailStore.ts](client/src/stores/mailStore.ts), [client/src/components/mail/MessageList.tsx](client/src/components/mail/MessageList.tsx), [client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : dans la boîte de réception unifiée, plusieurs comptes peuvent retourner le même UID IMAP. Le code comparait uniquement par `uid`, ce qui faisait que (1) `isSelected` mettait en surbrillance toutes les lignes ayant ce même UID (effet visuel « 3 messages sélectionnés alors que je n'en clique qu'un »), (2) `removeMessage(uid)` supprimait du store toutes les copies — peu importe le compte d'origine — et (3) la résolution du compte/dossier avant l'appel IMAP pouvait pointer vers le mauvais message. Désormais : `removeMessage(uid, accountId?, folder?)` filtre par UID **et** par tags d'origine `_accountId` / `_folder` ; `isSelected` compare le triplet `(uid, _accountId, _folder)` ; les callbacks `onDelete` / `onMove` / `onCopy` / `onArchive` / `onMarkRead` / `onToggleFlag` / `onSwipe` du composant `MessageList` transportent l'origine de la ligne réelle ; un nouveau helper `resolveOrigin(uid, accountId?, folder?)` privilégie ces tags et ne tombe sur la résolution par UID qu'en secours.
- **Lenteur (plusieurs secondes) lors de la suppression / archivage / déplacement par balayage ou ruban** ([client/src/pages/MailPage.tsx](client/src/pages/MailPage.tsx)) : les mutations attendaient la réponse IMAP avant de retirer la ligne et d'afficher la notification. Mise à jour optimiste : `deleteMutation`, `moveMutation` et `archiveMutation` retirent immédiatement le message du store via `onMutate` (avec snapshot dans le contexte `react-query`), puis `onError` restaure l'état précédent en cas d'échec. Le swipe est désormais instantané ; le toast et l'opération IMAP suivent en arrière-plan.
- **Liste des dossiers mail non scrollable** ([client/src/components/mail/FolderPane.tsx](client/src/components/mail/FolderPane.tsx)) : la racine du `FolderPane` n'avait pas de hauteur explicite (`flex-shrink-0` sans `h-full`), donc la zone interne `flex-1 overflow-y-auto` ne se contraignait jamais et la barre de défilement n'apparaissait pas — les comptes avec beaucoup de dossiers (style messagerie professionnelle complet : Boîte de réception, sous-dossiers, Brouillons, Courrier indésirable, Archives, Calendrier, Contacts, Notes, Tâches, etc.) étaient tronqués. Ajout de `h-full min-h-0` sur le conteneur racine pour activer le scroll vertical.
- **Callback OAuth Microsoft renvoyait `Non authentifié`** ([server/src/routes/admin.ts](server/src/routes/admin.ts), [server/src/index.ts](server/src/index.ts)) : la redirection top-level depuis `login.microsoftonline.com` n'envoie que le cookie de session, pas le Bearer token du SPA — la callback bloquait donc sur `authMiddleware`. La callback est désormais exposée via un `oauthCallbackRouter` public monté avant `authMiddleware` ; l'identité admin est persistée dans `req.session.oauthUserId/oauthIsAdmin` lors du `POST /start` (avec `session.save()` attendu pour éviter une race avec l'ouverture du popup) et relue dans la callback.

### Ajouté

#### Administration — Authentification OAuth2 pour Microsoft 365 / style messagerie professionnelle

- **Configuration hybride (env + UI Admin)** ([server/src/services/oauth.ts](server/src/services/oauth.ts), [client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : les identifiants Azure AD peuvent être définis soit via les variables d'environnement `MICROSOFT_OAUTH_*` (recommandé en prod via Portainer / docker-compose), soit via **Administration → Comptes mail → Configuration OAuth Microsoft** (panneau dépliable, stockage chiffré dans `admin_settings`). **Les variables d'environnement sont prioritaires champ par champ** : un `CLIENT_ID` fixé par env écrase celui en base, un secret en base est utilisé si le secret env est vide, etc. Endpoints : `GET/PUT /api/admin/oauth-settings/microsoft`.
- **Connexion OAuth2 moderne** pour les comptes Microsoft 365, style messagerie professionnelle.com, Hotmail, Live protégés par Microsoft Authenticator ou MFA ([server/src/services/oauth.ts](server/src/services/oauth.ts), [server/src/routes/admin.ts](server/src/routes/admin.ts)) : Microsoft ayant désactivé l'authentification basique IMAP/SMTP en septembre 2022, ces comptes ne pouvaient plus se connecter. Ils passent désormais par le flow OAuth2 v2.0 avec scopes `IMAP.AccessAsUser.All` + `SMTP.Send` + `offline_access`.
- **Bouton « Se connecter avec Microsoft »** dans le formulaire du fournisseur style messagerie professionnelle ([client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : ouvre une popup `login.microsoftonline.com`, l'admin s'authentifie (mot de passe + Microsoft Authenticator), la popup renvoie un identifiant éphémère via `postMessage` et le formulaire pré-remplit automatiquement l'adresse e-mail et le nom détectés depuis l'`id_token`. Plus aucun champ mot de passe n'est demandé.
- **Endpoints OAuth admin** ([server/src/routes/admin.ts](server/src/routes/admin.ts)) :
  - `POST /api/admin/mail-accounts/oauth/microsoft/start` — génère un `state` anti-CSRF (stocké en session), retourne l'URL d'autorisation Microsoft.
  - `GET /api/admin/mail-accounts/oauth/microsoft/callback` — vérifie le `state`, échange le `code` contre `access_token` + `refresh_token`, décode l'`id_token` pour extraire l'e-mail, stocke les jetons dans un cache en mémoire (TTL 10 min) et ferme la popup avec un `postMessage` vers la fenêtre parente.
- **Rafraîchissement automatique du token** ([server/src/services/oauth.ts](server/src/services/oauth.ts) `ensureFreshAccessToken`) : avant chaque opération IMAP/SMTP ([server/src/routes/mail.ts](server/src/routes/mail.ts), [server/src/services/newMailPoller.ts](server/src/services/newMailPoller.ts), tests admin/utilisateur), le serveur vérifie l'expiration et renouvelle le jeton via `grant_type=refresh_token` si nécessaire (marge 2 min). Le nouveau `access_token` + `refresh_token` (si rotation) sont ré-chiffrés AES-256-GCM et persistés.
- **XOAUTH2 sur ImapFlow et nodemailer** ([server/src/services/mail.ts](server/src/services/mail.ts)) : `MailService` accepte désormais un champ `access_token` ; quand il est présent, `ImapFlow` utilise `auth.accessToken` et `nodemailer.createTransport` utilise `type: 'OAuth2'` au lieu de `LOGIN`/`PLAIN`.
- **Migration BDD** ([server/src/database/connection.ts](server/src/database/connection.ts), [server/src/database/schema.ts](server/src/database/schema.ts)) : nouvelles colonnes `oauth_provider`, `oauth_refresh_token_encrypted`, `oauth_access_token_encrypted`, `oauth_token_expires_at`, `oauth_scope` sur `mail_accounts`, et `password_encrypted` rendu NULLABLE (les comptes OAuth n'en ont pas besoin).
- **Nouvelles variables d'environnement** ([docs/CONFIGURATION.md](docs/CONFIGURATION.md)) : `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_TENANT` (défaut `common`), `MICROSOFT_OAUTH_REDIRECT_URI` (optionnel, déduit de `PUBLIC_URL`), `PUBLIC_URL`. Documentation complète de la configuration de l'App Registration Azure AD (redirect URI + API permissions IMAP.AccessAsUser.All / SMTP.Send).
- **Reconnexion d'un compte OAuth** : quand un compte utilise déjà OAuth (refresh token révoqué côté Microsoft après changement de mot de passe par exemple), un bouton **Reconnecter** réouvre le flow popup et remplace les jetons sans ré-saisir les autres champs.

#### Administration — Assistant de création de compte mail par fournisseur

- **Sélecteur de fournisseur avant le formulaire** ([client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : au clic sur **+ Nouveau compte** dans *Administration → Comptes mail*, l'admin choisit d'abord le type de boîte (**style messagerie professionnelle / Microsoft 365**, **des webmails courants**, **Yahoo Mail**, **iCloud Mail**, **O2Switch**, ou **IMAP / SMTP (autre)**) avec logo et description, puis le formulaire s'adapte automatiquement :
  - **Hôtes et ports pré-remplis et verrouillés** pour les fournisseurs publics (style messagerie professionnelle `style messagerie professionnelle.office365.com:993` + `smtp.office365.com:587`, des webmails courants `imap.des webmails courants.com:993` + `smtp.des webmails courants.com:465`, Yahoo `imap.mail.yahoo.com:993` + `smtp.mail.yahoo.com:465`, iCloud `imap.mail.me.com:993` + `smtp.mail.me.com:587`) — champs serveur/port masqués, résumé affiché en lecture seule.
  - **Identifiant automatique = adresse e-mail** pour les fournisseurs publics, champ `Identifiant` séparé uniquement pour le mode IMAP générique.
  - **Bandeau d'avertissement contextuel** rappelant qu'un mot de passe d'application est nécessaire quand le MFA/2FA est actif (Google, Apple, Yahoo, Microsoft 365).
  - **Couleur de compte pré-remplie** avec la couleur de marque du fournisseur (éditable ensuite).
  - **Case « Synchronisation O2Switch (CalDAV + CardDAV) »** affichée uniquement pour le fournisseur O2Switch ; les autres fournisseurs n'envoient pas `o2switchAutoSync` au serveur.
  - **Mode IMAP générique** = formulaire manuel complet identique à l'ancienne version pour tout autre hébergeur.
  - **Édition d'un compte existant** : le fournisseur est détecté automatiquement depuis `imap_host`, le sélecteur est sauté et le formulaire s'ouvre directement sur les bons champs (un bouton retour ← permet néanmoins de changer de preset).
- Aucune modification côté serveur — l'endpoint `POST /api/admin/mail-accounts` reçoit exactement les mêmes champs, seule la saisie est guidée.

#### Administration — Gestion globale des appareils connectés

- **Nouvel onglet admin *Appareils*** ([client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) qui liste toutes les sessions actives de l'instance groupées par utilisateur dans des cartes repliables (collapsed par défaut pour rester lisible avec beaucoup d'utilisateurs).
  - **Champ de recherche avec autocomplétion** sur le nom ou l'email — suggestions cliquables qui filtrent la liste et déplient automatiquement la carte correspondante.
  - **Boutons globaux** « Tout déplier » / « Tout replier » pour un audit rapide.
  - **Actions par utilisateur** : bouton « Tout déconnecter » qui révoque toutes les sessions d'un compte en un clic (utile en cas de départ ou de compromission).
  - **Actions par appareil** : bouton « Déconnecter » individuel pour chaque session (navigateur + OS + IP + dernière utilisation).
- **Nouveaux endpoints admin** ([server/src/routes/admin.ts](server/src/routes/admin.ts), [server/src/services/deviceSessions.ts](server/src/services/deviceSessions.ts)) :
  - `GET /api/admin/devices` — retourne un tableau déjà groupé `[{ userId, email, displayName, isAdmin, devices:[…] }]`.
  - `DELETE /api/admin/devices/:id` — révoque une session spécifique.
  - `DELETE /api/admin/users/:userId/devices` — révoque toutes les sessions d'un utilisateur.
  - Chaque action est journalisée (`device.revoke`, `device.revoke_all`) dans `admin_logs`.
- **Page *Mes appareils* — message vide enrichi** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : explique désormais qu'une session créée avant le déploiement de ce module n'apparaît qu'après une reconnexion.

#### Authentification — Passkey passwordless + personnalisation de la page de connexion

- **Connexion sans mot de passe avec un passkey** ([server/src/routes/auth.ts](server/src/routes/auth.ts), [server/src/services/webauthn.ts](server/src/services/webauthn.ts)) : deux nouveaux endpoints publics `POST /api/auth/webauthn/passkey/options` et `/verify` basés sur les **credentials découvrables** (resident keys). L'utilisateur clique sur « Se connecter avec une clé d'accès » depuis la page principale ([client/src/pages/LoginPage.tsx](client/src/pages/LoginPage.tsx)), le navigateur affiche le sélecteur de comptes iCloud / Google Password Manager / Windows Hello, et la session est émise sans email ni mot de passe.
- **Enrôlement passkey mis à jour** ([server/src/services/webauthn.ts](server/src/services/webauthn.ts)) : `residentKey: 'required'` (au lieu de `preferred`) pour garantir que toutes les clés nouvellement enregistrées sont découvrables et utilisables pour la connexion passwordless.
- **Nouvel onglet *Apparence connexion*** dans l'admin ([client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) avec prévisualisation en direct :
  - fond d'écran personnalisé (PNG/JPEG/WEBP/GIF, 10 Mo max) avec **flou réglable** de 0 à 30 px et calque d'opacité (`rgba(...)`) pour améliorer la lisibilité,
  - couleur de fond alternative (hex / `linear-gradient(…)`) si pas d'image,
  - couleur et texte de la modale (`cardBgColor` / `cardTextColor`), couleur d'accent (boutons et liens),
  - titre et sous-titre personnalisables,
  - toggles pour masquer le bouton « clé d'accès » ou le lien « créer un compte ».
- **Endpoints admin correspondants** ([server/src/routes/branding.ts](server/src/routes/branding.ts)) : `POST /api/admin/branding/login-background/upload`, `DELETE /api/admin/branding/login-background`. Les autres réglages (couleurs, textes, toggles) passent par l'endpoint générique `PUT /api/admin/settings` sous les clés `login_title`, `login_subtitle`, `login_background_color`, `login_background_blur`, `login_background_overlay`, `login_card_bg_color`, `login_card_text_color`, `login_accent_color`, `login_show_register`, `login_show_passkey_button`.
- **Endpoint public `/api/branding`** étendu avec le bloc `login_appearance` pour que la page de connexion charge son thème sans authentification.

#### Authentification — Rester connecté + biométrie

- **Refresh token rotation par appareil** ([server/src/services/deviceSessions.ts](server/src/services/deviceSessions.ts)) : table `device_sessions` avec refresh tokens 256 bits hashés SHA-256, cookie `wm_refresh` `httpOnly` + `SameSite=Strict` + `Secure` en prod, scope `/api/auth`, TTL glissant 90 jours. Chaque rotation lie l'ancien au nouveau via `replaced_by` ; rejouer un token déjà révoqué révoque toute la chaîne (détection de vol).
- **Access tokens courts** (15 min) signés avec `JWT_SECRET` (fallback `SESSION_SECRET`) et rafraîchis silencieusement côté client ([client/src/api/index.ts](client/src/api/index.ts)) : intercepteur 401 → `POST /api/auth/refresh` → retry unique. Résultat : plus de ressaisie d'identifiants au quotidien, jusqu'à 90 j d'inactivité par appareil.
- **Page *Mes appareils*** ([client/src/pages/SettingsPage.tsx](client/src/pages/SettingsPage.tsx)) : liste les sessions (navigateur, IP, dernière utilisation) et permet la **déconnexion à distance** via `DELETE /api/auth/devices/:id` (effet immédiat grâce à la vérification `isSessionActive` à chaque requête).
- **WebAuthn / Passkeys** ([server/src/services/webauthn.ts](server/src/services/webauthn.ts)) : Touch ID, Face ID, Windows Hello. Deux usages :
  - **2FA au login** — si l'utilisateur a enregistré ≥ 1 passkey, le mot de passe seul ne suffit plus ; le serveur émet un `pendingToken` JWT 5 min et exige une preuve biométrique avant d'émettre la session.
  - **Déverrouillage local de la PWA** ([client/src/components/BiometricLock.tsx](client/src/components/BiometricLock.tsx)) — après 7 j d'inactivité, overlay plein écran qui demande une vérification biométrique sans retaper le mot de passe.
- **Onglet *Sécurité*** dans les paramètres : enrôlement nominatif des clés, visualisation des passkeys synchronisées (iCloud / Google) vs liées à l'appareil (Windows Hello local), suppression.
- **Nouvelles variables d'environnement** ([.env.example](.env.example)) : `JWT_SECRET`, `WEBAUTHN_RP_ID`, `WEBAUTHN_RP_NAME`, `WEBAUTHN_ORIGIN`. Toutes sont maintenant transmises au conteneur via [docker-compose.yml](docker-compose.yml) (les valeurs définies dans Portainer prennent la priorité sur le fichier `.env`).
- **`app.set('trust proxy', 1)`** ajouté dans [server/src/index.ts](server/src/index.ts) pour que le cookie `wm_refresh` soit correctement posé avec le flag `Secure` derrière Nginx Proxy Manager / Traefik.

#### Partage de calendrier — Dialogue à onglets (style messagerie professionnelle)

- **Nouvelle interface de partage à 3 onglets** ([client/src/components/calendar/ShareCalendarDialog.tsx](client/src/components/calendar/ShareCalendarDialog.tsx)) :
  - **Au sein de votre organisation** — annuaire interne (utilisateurs de l'app + liens NextCloud) via nouveau endpoint [server/src/routes/contacts.ts](server/src/routes/contacts.ts) `GET /api/contacts/directory/users`. Recherche live, avatar/initiales, ajout en 1 clic.
  - **Invitations par email** — autocomplétion sur **tous** les contacts (locaux + NextCloud) via `api.searchContacts`. Si l'adresse saisie n'est pas dans les contacts, elle est **automatiquement ajoutée** comme contact local en plus d'être invitée.
  - **Lien public** — voir ci-dessous.
- **Permissions granulaires** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : 4 niveaux persistés dans `shared_calendar_access.permission` / `external_calendar_shares.permission` : `busy` (disponibilités), `titles` (titres et lieux), `read` (tous les détails), `write` (édition). Pour NextCloud, les 3 premiers sont propagés comme `read`, `write` comme `read-write`.

#### Partage de calendrier — Lien public autonome (HTML + ICS)

- **Nouveau routeur public non authentifié** ([server/src/routes/calendarPublic.ts](server/src/routes/calendarPublic.ts)) monté sur `/api/public/calendar` :
  - `GET /:token` → page HTML autonome responsive (clair/sombre), avec boutons *Télécharger .ics*, *S'abonner* (`webcal://`) et *Copier le lien*.
  - `GET /:token.ics` → flux iCalendar RFC 5545 (`Content-Type: text/calendar`) compatible style messagerie professionnelle, la plupart des calendriers.
  - `GET /:token.json` → flux JSON (intégrations custom).
- **Filtrage par permission appliqué côté serveur** :
  - `busy` → titre remplacé par « Occupé(e) », aucune autre donnée (ni lieu, ni description, ni invités, ni pièces jointes).
  - `titles` → titre et lieu uniquement.
  - `read` → toutes les propriétés.
- **`POST /api/calendar/:id/publish`** accepte désormais `{ permission }` et retourne `htmlUrl`, `icsUrl`, `token` et `permission`. Upsert par index unique partiel garantissant un seul lien public par calendrier ([server/src/database/connection.ts](server/src/database/connection.ts)).
- **`PATCH /api/calendar/:id/publish`** — nouvelle route pour modifier la permission d'un lien déjà publié sans régénérer le token.
- **Nouveau panneau client** ([client/src/components/calendar/ShareCalendarDialog.tsx](client/src/components/calendar/ShareCalendarDialog.tsx)) avec sélecteur de permission, champ **PAGE WEB (HTML)** et champ **ABONNEMENT ICS (.ics)** séparés, boutons copier/ouvrir/webcal.

#### Agenda — Largeur des colonnes adaptative

- **Nouveau réglage *Colonnes : Fixe / Automatique*** ([client/src/components/calendar/CalendarRibbon.tsx](client/src/components/calendar/CalendarRibbon.tsx)) : ajouté dans l'onglet *Afficher* du ruban (mode classique et simplifié), à droite de l'échelle de temps. Persistant dans `localStorage` (`calendar.columnSizing`) via [client/src/utils/calendarPreferences.ts](client/src/utils/calendarPreferences.ts).
- **Mode *Automatique*** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx) — `TimeGridView`) : le `gridTemplateColumns` est calculé à partir d'un poids par jour. Le poids est dérivé du nombre maximal de voies de chevauchement utilisées par `layoutDay()` ce jour-là, avec une croissance logarithmique douce (`1 + min(1.4, log2(1+lanes) * 0.7)`). Un jour vide reçoit le poids minimal `0.5`. Résultat : les jours chargés s'élargissent pour rester lisibles, les jours libres se réduisent, sans jamais qu'une colonne ne devienne incliquable.
- **Mode *Fixe*** : comportement historique conservé (toutes les colonnes ont `1fr`). Reste la valeur par défaut.

#### Agenda — Disposition style messagerie professionnelle des événements qui se chevauchent

- **Colonnes parallèles pour les chevauchements** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : les vues *Jour*, *Semaine* et *Semaine de travail* utilisent un algorithme de layout style messagerie professionnelle. Les événements qui se chevauchent sont groupés en « clusters » (composantes connexes d'overlap), puis distribués dans des « voies » verticales parallèles. Chaque événement occupe `1/cols` de la colonne-jour, avec une légère superposition (4 px) pour le rendu en cascade caractéristique d'style messagerie professionnelle et un z-index croissant (hover = au-dessus).
- **Expansion latérale automatique** : un événement qui n'a pas de voisin dans les voies à sa droite (pour la plage temporelle qu'il occupe) s'étend pour occuper toute la largeur libre restante — un événement isolé dans sa propre demi-heure reste pleine largeur même si d'autres événements coexistent ailleurs dans la journée.

### Corrigé

#### Partage de calendrier — Lien public pointait vers WebDAV NextCloud

- **URL publique désormais servie par l'application** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts), [server/src/routes/calendarPublic.ts](server/src/routes/calendarPublic.ts)) : auparavant le `publishCalendar()` de NextCloud retournait une URL qui renvoyait vers l'interface WebDAV (*« This is the WebDAV interface. It can only be accessed by WebDAV clients… »*), inutilisable dans un navigateur. Le lien retourné par l'API pointe maintenant systématiquement sur le viewer HTML de l'application (`/api/public/calendar/:token`). La publication NextCloud reste tentée en best-effort mais n'est plus exposée à l'utilisateur.
- **Publication possible aussi pour les calendriers locaux** : la contrainte `nc_managed === true` sur `POST /publish` est levée. Seule la compatibilité d'affichage HTML + flux .ics est désormais requise, et elle est fournie par le serveur.

#### Agenda — Modale d'édition respecte le fuseau utilisateur

- **Saisie et affichage en TZ utilisateur** ([client/src/components/calendar/EventModal.tsx](client/src/components/calendar/EventModal.tsx)) : les champs `Début`/`Fin` sont initialisés via `formatInTimeZone(..., userTz, ...)` et le submit convertit la chaîne locale en instant absolu via `fromZonedTime(..., userTz).toISOString()`. Sans cette conversion, un utilisateur en `Europe/Paris` saisissant 08:30 voyait l'événement enregistré comme 10:30 (les deux étaient interprétés en UTC de part et d'autre).
- **Affichage des métadonnées** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : le popover de l'événement sélectionné et les libellés `HH:mm` de la vue *Mois* utilisent désormais `formatInTimeZone(..., userTz, ...)`.

#### NextCloud — Synchronisation bidirectionnelle

- **Calendriers synchronisés correctement marqués `nc_managed=true`** ([server/src/services/nextcloud.ts](server/src/services/nextcloud.ts)) : `syncCalendars` positionne désormais `nc_managed = TRUE`, `nc_principal_url` et `last_sync_at` dans l'upsert `INSERT … ON CONFLICT`. Sans ce flag, `pushEventToCalDAV()` ne reconnaissait pas les calendriers tirés depuis NextCloud comme push-targets, et les modifications côté WebMail ne remontaient pas.
- **`nc_uri` / `nc_etag` stockés sur les événements pullés** : `parseEvents()` extrait maintenant `<d:href>` et `<d:getetag>` au niveau de chaque `<d:response>` (au lieu d'un regex global sur `<cal:calendar-data>`). Ces champs sont persistés par l'upsert pour que les `PUT` ultérieurs envoient un `If-Match` correct et évitent les écritures concurrentes perdues.

#### Agenda — Glisser-déposer d'événements

- **Déplacement d'événement par drag & drop** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : dans les vues *Jour*, *Semaine* et *Semaine de travail*, les événements peuvent être glissés vers n'importe quel créneau pour changer leur date/heure de début. La durée est préservée. Le créneau cible est mis en surbrillance pendant le drag.
  - **Calcul de position** : les handlers `dragover`/`drop` sont posés sur la colonne-jour entière (pas sur chaque slot) pour ne pas être bloqués par les événements existants ou les overlays. La position Y de la souris (moins l'offset de saisie mémorisé au `dragstart`) est divisée par `slotHeight` pour obtenir l'index exact du créneau.
  - **Drop = surbrillance** : la dernière cible calculée pendant le `dragover` est mémorisée dans un `ref`, et le `drop` utilise cette valeur — garantit que l'événement atterrit exactement où l'utilisateur voit la surbrillance.
  - **Mise à jour optimiste** : TanStack Query applique immédiatement la nouvelle position dans le cache (`onMutate`), avec rollback automatique en cas d'erreur serveur. Au retour du `PUT`, le cache est patché avec la réponse du serveur au lieu d'invalider la query (évite qu'un `GET` servi depuis le cache du Service Worker n'écrase la mise à jour).
- **Synchronisation NextCloud automatique au déplacement** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : `PUT /events/:id` déclenche `pushEventToCalDAV()` qui, pour un agenda `nc_managed`, utilise `getUserClient(userId).putEvent(caldav_url, ical_uid, ics, nc_etag)` — la modification est immédiatement propagée sur NextCloud (avec envoi iMIP pour les invités), et `nc_etag`/`nc_uri` sont mis à jour en base.

#### Agenda — Migration de calendriers Local ↔ NextCloud

- **Nouveau endpoint `POST /calendar/:id/migrate`** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) corps `{ target: 'nextcloud' | 'local', deleteRemote?: boolean }` :
  - `target=nextcloud` : crée le calendrier sur NC (`nc.createCalendar`), pousse tous les événements existants via `nc.putEvent()` (réutilise `ical_data` ou reconstruit l'ICS), bascule `source='nextcloud'` et `nc_managed=true`.
  - `target=local` : détache le calendrier de NC et optionnellement supprime le calendrier côté NextCloud.
- **UI de migration** ([client/src/components/calendar/CalendarSidebar.tsx](client/src/components/calendar/CalendarSidebar.tsx), [client/src/components/calendar/MigrateCalendarDialog.tsx](client/src/components/calendar/MigrateCalendarDialog.tsx)) : nouvelle entrée *Migrer vers NextCloud* / *Migrer en local* dans le menu contextuel de la sidebar calendrier, avec une modale listant les gains et pertes de la migration et une case à cocher optionnelle *Supprimer sur NextCloud* pour la migration inverse.

#### Bouton « Synchroniser » — synchronisation NextCloud incluse

- **Extension de `POST /calendar/sync`** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : après la boucle CalDAV par compte mail, le endpoint appelle désormais `nc.syncCalendars(userId)` puis `nc.syncContacts(userId)` pour tirer les changements NextCloud. `last_sync_at` / `last_sync_error` de `nextcloud_users` sont mis à jour. Réponse enrichie : `{ synced, results, nextcloud: { ok, error? } }`.

### Corrigé

#### Fuseau horaire — décalage de 3 h des événements après `PUT`

- **Colonnes migrées en TIMESTAMPTZ** ([server/src/database/connection.ts](server/src/database/connection.ts)) : `calendar_events.start_date` et `end_date` passent de `TIMESTAMP` (sans fuseau) à `TIMESTAMPTZ` via un `DO $mig$ ... ALTER COLUMN ... TYPE TIMESTAMPTZ USING col AT TIME ZONE 'UTC'` idempotent. Les ISO strings envoyées par le client sont désormais stockées et relues **sans réinterprétation** par la timezone du serveur.
- **Session PostgreSQL forcée à UTC** : le pool `pg` installe un handler `connect` qui exécute `SET TIME ZONE 'UTC'` sur chaque connexion (nouvelle ou réutilisée).
- **Préférence `user.timezone` utilisée côté client** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : l'agenda utilise `date-fns-tz` (`formatInTimeZone`, `toZonedTime`, `fromZonedTime`) et récupère la timezone de l'utilisateur connecté depuis `useAuthStore` (fallback : timezone du navigateur puis `Europe/Paris`). Concerne :
  - Positionnement vertical des événements (calcul `startMinutes` en TZ utilisateur)
  - Libellés d'heures `HH:mm` affichés sur chaque événement
  - Regroupement par jour (`getEventsForDay` interprète `start_date` en TZ utilisateur)
  - Drag & drop : un drop sur le créneau « 11:00 » crée une ISO correspondant à 11:00 **dans la TZ de l'utilisateur**, peu importe la TZ du navigateur (utilisation de `fromZonedTime`).
- **Client** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : `updateEventMutation.onSuccess` patche à nouveau le cache avec la réponse serveur (stable maintenant grâce aux points ci-dessus).

#### Service Worker — réponses périmées après mutation d'événement

- **Exclusion du cache pour `/api/calendar/events*`** ([client/src/sw.ts](client/src/sw.ts)) : la route reste en `NetworkFirst` mais avec un plugin `cacheWillUpdate: () => null` qui empêche le stockage. Sinon, après un `PUT` d'événement, un refetch déclenché par TanStack Query pouvait renvoyer l'ancienne réponse depuis le cache Workbox et écraser la mise à jour optimiste.

#### Synchronisation NextCloud — création d'un doublon « autres » lors du premier sync

- **`POST /calendar` avec création NC** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : quand NC auto-créait le calendrier, l'INSERT en base ne positionnait ni `source='nextcloud'` ni `external_id=ncUrl`. Au sync suivant, `NextCloudService.syncCalendars()` ne trouvait donc pas de correspondance et créait une seconde ligne. Corrigé : l'INSERT local stocke directement les métadonnées NC.

#### Base de données — échec d'initialisation sur base vierge

- **Ordre des migrations** ([server/src/database/connection.ts](server/src/database/connection.ts)) : les `ALTER TABLE calendars/calendar_events/contacts ADD COLUMN ...` et les `CREATE INDEX` associés s'exécutaient avant les `CREATE TABLE` correspondants → erreur `42P01 relation "calendars" does not exist`. Réordonné : colonnes et index sont maintenant ajoutés après la création des tables.

#### Déploiement — paramétrage DB ignoré

- **`docker-compose.yml`** : `DATABASE_URL` n'était plus paramétrable (hardcodé), ce qui faisait échouer l'authentification (`28P01`) quand on modifiait `DB_PASSWORD` via l'interface Coolify/Dokploy. Passée en variable avec fallback : `${DATABASE_URL:-postgresql://webmail:${DB_PASSWORD:-webmail_secure_pwd}@db:5432/webmail}`. Ajout également de `NODE_ENV`, `PORT`, `DEFAULT_IMAP_PORT`, `DEFAULT_SMTP_PORT`.

#### Modale « Nouveau calendrier » — choix automatique Local / Nextcloud

- **Choix Local / Boîte mail supprimé** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : la modale ne demande plus où créer le calendrier. Un bandeau *Emplacement* affiche la destination réelle :
  - **Nextcloud** si l'utilisateur connecté est lié à un compte NC (`nextcloud_users`) **et** que `autoCreateCalendars` est actif côté admin → création MKCALENDAR automatique sur NC, synchronisation gérée par le poller.
  - **Local** sinon — plus aucune tentative de MKCALENDAR sur le CalDAV de la boîte mail (utile pour les serveurs comme cPanel/o2switch qui n'acceptent qu'un seul calendrier).
- **Nouveau endpoint `GET /calendar/nextcloud-status`** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : renvoie `{ enabled, linked, ncUsername, ncEmail, autoCreateCalendars }` pour l'utilisateur courant. Consommé par le front via `api.getUserNextcloudStatus()`.

### Corrigé

#### Synchronisation NextCloud — « there is no unique or exclusion constraint matching the ON CONFLICT specification »

- **Index partiels manquants** ([server/src/database/connection.ts](server/src/database/connection.ts)) : les requêtes `ON CONFLICT (user_id, email) WHERE source='nextcloud'` (contacts) et `ON CONFLICT (user_id, external_id) WHERE source='nextcloud'` (calendriers et contacts) nécessitent des index uniques partiels dont le prédicat correspond **exactement** au `WHERE` de la clause `ON CONFLICT`. Trois index ajoutés :
  - `idx_contacts_nc_email_unique` sur `contacts(user_id, email) WHERE source='nextcloud'`
  - `idx_contacts_nc_external_unique` sur `contacts(user_id, external_id) WHERE source='nextcloud'`
  - `idx_calendars_nc_external_unique` sur `calendars(user_id, external_id) WHERE source='nextcloud'`
- **Migration idempotente forcée** : les index sont `DROP INDEX IF EXISTS` puis recréés à chaque démarrage, afin d'écraser une version antérieure qui aurait un prédicat plus strict (ex : `AND external_id IS NOT NULL`) — ce prédicat stricte n'était pas inférable par PostgreSQL pour l'inférence de `ON CONFLICT` et produisait l'erreur `42P10` observée dans les logs du poller NC.

#### Intégration NextCloud V2 — provisioning, partage, iMIP, sync bidirectionnelle

Refonte complète de l'intégration NextCloud avec provisioning automatique des utilisateurs,
création native des calendriers/contacts côté NextCloud, et gestion du partage de A à Z.

- **Configuration centralisée en base** ([server/src/services/nextcloudHelper.ts](server/src/services/nextcloudHelper.ts), [server/src/routes/admin.ts](server/src/routes/admin.ts)) : plus de dépendance aux variables d'environnement (`NEXTCLOUD_URL`, `NEXTCLOUD_USERNAME`, `NEXTCLOUD_PASSWORD`). Toute la configuration (URL, admin username, **admin password chiffré**, `autoProvision`, `autoCreateCalendars`, `syncIntervalMinutes`) est stockée dans la table `admin_settings` et administrable via l'UI. Le mot de passe est chiffré au repos avec `ENCRYPTION_KEY` (AES-256-GCM) et n'est jamais renvoyé au navigateur.
- **Provisioning automatique des utilisateurs** ([server/src/services/nextcloud.ts](server/src/services/nextcloud.ts), [server/src/services/nextcloudHelper.ts](server/src/services/nextcloudHelper.ts)) : nouvelle classe `NextCloudAdminService` qui utilise l'API OCS Provisioning (`/ocs/v2.php/cloud/users`) pour créer / activer / supprimer des comptes. Quand `autoProvision` est actif, chaque `POST /admin/users` déclenche la création d'un compte NC avec mot de passe aléatoire généré (`crypto.randomBytes(24).base64url`), stocké chiffré dans la nouvelle table `nextcloud_users`.
- **Gestion des comptes NC par utilisateur** ([client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx)) : nouvel onglet *Utilisateurs provisionnés* dans Admin → NextCloud permettant de **provisionner**, **lier** un compte NC existant (via App Password), **synchroniser** à la demande, ou **délier**. Les erreurs de sync sont affichées par utilisateur.
- **Auto-création de calendriers sur NextCloud** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : `POST /calendar` (sans `mailAccountId`) effectue un `MKCALENDAR` sur `/remote.php/dav/calendars/<ncUsername>/<slug>/` quand l'option `autoCreateCalendars` est active. Le calendrier est marqué `nc_managed=true` en base, et tous les push d'événements sont routés via NC.
- **Partage de calendrier interne & externe** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts), [client/src/components/calendar/ShareCalendarDialog.tsx](client/src/components/calendar/ShareCalendarDialog.tsx)) : nouvelle modale *Partager* avec trois modes :
  - **Partage interne** avec un utilisateur WebMail → propagé côté NC via `POST` `<CS:share>` entre principals quand les deux utilisateurs sont provisionnés
  - **Invitation par email** → utilise l'extension `calendarserver-sharing` (NC envoie automatiquement l'invitation). Permissions `read` / `write`
  - **Lien public lecture seule** via `<CS:publish-calendar>` + PROPFIND `<CS:publish-url>` → URL publique copiable
  - Endpoints : `POST/DELETE /calendar/:id/share`, `GET /calendar/:id/shares`, `POST/DELETE /calendar/:id/publish`
- **Invitations iMIP automatiques** : les événements d'un calendrier `nc_managed` contenant des `ATTENDEE` déclenchent automatiquement les invitations iMIP envoyées par NextCloud (serveur SMTP NC requis). Aucune configuration côté WebMail nécessaire.
- **Contacts NextCloud bidirectionnels** ([server/src/routes/contacts.ts](server/src/routes/contacts.ts), [client/src/pages/ContactsPage.tsx](client/src/pages/ContactsPage.tsx)) : quand un utilisateur est provisionné sans CardDAV attaché à une boîte mail, les nouveaux contacts vont directement dans le carnet d'adresses NC par défaut (`nc_managed=true`). La vue *NextCloud* dans la page Contacts filtre sur `nc_managed = true` (query param `source=nextcloud`).
- **Synchronisation périodique** ([server/src/services/nextcloudSyncPoller.ts](server/src/services/nextcloudSyncPoller.ts)) : nouveau service démarré au boot du serveur, parcourt `nextcloud_users` actifs et lance `syncCalendars` + `syncContacts` pour chaque utilisateur. Intervalle configurable (min. 5 min, défaut 15 min). Dernière exécution et erreurs stockées par utilisateur.
- **Schéma DB étendu** : nouvelles tables `nextcloud_users`, `external_calendar_shares` ; nouvelles colonnes `nc_managed`, `nc_principal_url`, `last_sync_at` sur `calendars` ; `nc_managed`, `nc_addressbook_url`, `nc_etag`, `nc_uri` sur `contacts` ; `nc_etag`, `nc_uri` sur `calendar_events` ; `nextcloud_share_id`, `created_at` sur `shared_calendar_access`.
- **Documentation** : [docs/NEXTCLOUD.md](docs/NEXTCLOUD.md) entièrement réécrit pour refléter le nouveau modèle (configuration UI, provisioning, partage, iMIP, sync, sécurité, dépannage).

#### Menu contextuel sur les événements + durée par défaut liée à l'échelle

- **Clic droit sur un événement** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : nouveau menu contextuel propagé via `onEventContextMenu` aux vues *Mois*, *Semaine*, *Semaine de travail* et *Jour*. Six actions : **Ouvrir**, **Modifier**, **Répéter** (ou *Modifier la récurrence* si l'événement en a déjà une — ouvre la modale directement sur l'onglet *Récurrence*), **Participants** (ouvre l'onglet *Participants*), **Dupliquer l'événement** (recrée une copie avec tous les champs, y compris RRULE et pièces jointes), **Supprimer**.
- **Modale ciblée sur un onglet** ([client/src/components/calendar/EventModal.tsx](client/src/components/calendar/EventModal.tsx)) : nouvelle prop `initialTab: 'summary' | 'recurrence' | 'attendees' | 'attachments'` pour amener l'utilisateur directement sur l'onglet pertinent depuis le menu contextuel.
- **L'échelle du ruban pilote la durée par défaut** : `defaultDurationMinutes` (nouvelle prop d'`EventModal`, défaut `60`) est alimentée par `timeScale` du `CalendarRibbon`. Si l'utilisateur choisit une échelle de 15 min, les nouveaux événements durent 15 min ; à 30 min ils durent 30 min, etc. Le comportement pour les événements existants (édition) reste inchangé — seul le *seed* d'un nouvel événement est affecté.

#### Création CalDAV robuste — fallback MKCOL+PROPPATCH pour o2switch / cPanel

- **Cascade de méthodes dans `createRemoteCalendar`** ([server/src/services/caldav.ts](server/src/services/caldav.ts)) : le serveur DAV d'o2switch (cPanel Horde-based) ne supporte pas `MKCALENDAR` (retourne HTTP 500 avec *« Le serveur CalDAV/CardDAV ne prend pas en charge la méthode MKCALENDAR »*). La méthode tente désormais trois approches dans l'ordre :
  1. **MKCALENDAR** (RFC 4791, standard Apple/SOGo/SabreDAV/Radicale).
  2. **MKCOL étendu** (RFC 5689) avec `resourcetype = collection + calendar` et les propriétés dans le même appel.
  3. **MKCOL simple + PROPPATCH** pour définir `resourcetype`, `displayname`, `calendar-color` et `supported-calendar-component-set` dans un second temps — méthode acceptée par le DAV d'o2switch.
- **Détection multilingue des échecs `method not supported`** : le heuristique `looksUnsupported` couvre maintenant HTTP 405/501 **et** les messages anglais (`not supported`, `unknown method`, `method not allowed`, `unsupported`) **et français** (`ne prend pas en charge`, `non supporté`). Le code HTTP 500 non-standard renvoyé par o2switch pour *Method Not Supported* est donc correctement reconnu, et la cascade bascule automatiquement en MKCOL.
- **Méthode utilisée journalisée** : le retour de `createRemoteCalendar` inclut un champ `method` (`MKCALENDAR` | `MKCOL-extended` | `MKCOL+PROPPATCH`) pour faciliter le diagnostic côté logs.

#### Modale événement refondue — parité RoundCube / CalDAV

- **Nouvel éditeur d'événement** ([client/src/components/calendar/EventModal.tsx](client/src/components/calendar/EventModal.tsx)) remplace la modale minimaliste historique par une modale moderne à **4 onglets** calquée sur l'éditeur RoundCube (o2switch) :
  - *Résumé* — titre, lieu, description, début/fin avec bascule *toute la journée*, rappel (aucun · à l'heure · 5 / 10 / 15 / 30 min · 1 / 2 h · 1 / 2 j · 1 sem.), calendrier cible, catégories (tags libres), statut (Confirmé / Provisoire / Annulé), *Montrez-moi en tant que* (Occupé / Disponible = `TRANSP`), priorité (Basse / Normale / Haute = `PRIORITY`), URL.
  - *Récurrence* — générateur RRULE complet : aucune / quotidienne / hebdomadaire (`BYDAY`) / mensuelle en mode *chaque X* (`BYMONTHDAY`) ou *le premier/deuxième/…/dernier [jour]* (`BYDAY=1MO`, etc.) / annuelle (`BYMONTH`) / *à certaines dates* (`RDATE`). Fin : toujours, `COUNT`, `UNTIL`.
  - *Participants* — liste d'invités avec rôle (`REQ-PARTICIPANT` / `OPT-PARTICIPANT` / `CHAIR` / `NON-PARTICIPANT`), statut de réponse (`PARTSTAT`), organisateur pré-rempli depuis la session, zone de commentaire d'invitation.
  - *Pièces jointes* — drag-drop / file picker multi-fichiers jusqu'à 250 Mo, encodés en base64 et poussés inline (`ATTACH;VALUE=BINARY;ENCODING=BASE64`) ou par URL.
- **Sérialisation iCalendar RFC 5545 étendue** ([server/src/utils/ical.ts](server/src/utils/ical.ts)) : `buildIcs` émet désormais `SUMMARY`, `DESCRIPTION`, `LOCATION`, `STATUS`, `RRULE`, `RDATE[;VALUE=DATE]`, `TRANSP`, `PRIORITY`, `CATEGORIES`, `URL`, `ORGANIZER[;CN=…]:mailto:…`, `ATTENDEE[;ROLE=…;PARTSTAT=…;RSVP=TRUE;CN=…]:mailto:…`, `ATTACH` (URL ou inline base64), et un bloc `VALARM` (`ACTION:DISPLAY`, `TRIGGER:-PT<n>M`) lorsqu'un rappel est défini.
- **Schéma et routes événements étendus** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : `POST /api/calendar/events` et `PUT /api/calendar/events/:id` acceptent désormais `rdates`, `reminderMinutes`, `attendees[{role, rsvp, comment, …}]`, `organizer`, `priority (0-9)`, `url`, `categories[]`, `transparency ('OPAQUE'|'TRANSPARENT')`, `attachments[]`. Le `PUT` force `ical_data = NULL` pour que l'ICS soit reconstruit à partir de la base de données au prochain `pushEventToCalDAV`.
- **Colonnes DB ajoutées** ([server/src/database/connection.ts](server/src/database/connection.ts)) : `calendar_events.priority INT`, `url TEXT`, `categories JSONB`, `transparency VARCHAR(20)`, `attachments JSONB`, `rdates JSONB` — ajoutées de manière idempotente (`ALTER TABLE IF EXISTS … ADD COLUMN IF NOT EXISTS`).
- **Autosynchronisation CalDAV** : tous les nouveaux champs sont poussés automatiquement vers le serveur CalDAV (o2switch / SabreDAV / SOGo) dès qu'un événement est créé ou modifié sur un calendrier de source `caldav`, sans action manuelle — l'événement apparaît instantanément dans RoundCube avec rappels, récurrence, invités, catégories et pièces jointes.

#### Création de calendrier par boîte mail + CalDAV (MKCALENDAR)

- **Modale « Nouveau calendrier » réécrite** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : l'utilisateur choisit désormais entre :
  - *Local* — simple calendrier local (comportement historique).
  - *Boîte mail* — sélection d'une boîte mail (via `GET /calendar/accounts`) ; si la boîte a une URL CalDAV active, une case **« Créer et synchroniser via CalDAV »** (cochée par défaut) permet de provisionner le calendrier directement sur le serveur distant.
- **MKCALENDAR côté serveur** ([server/src/services/caldav.ts](server/src/services/caldav.ts)) : nouvelle méthode `CalDAVService.createRemoteCalendar(displayName, color?, slug?)` qui envoie une requête `MKCALENDAR` conforme RFC 4791 au serveur CalDAV avec `D:displayname`, `A:calendar-color` et `C:supported-calendar-component-set` limité à `VEVENT`. Le slug est dérivé du nom (normalisation NFD, ASCII, longueur ≤ 48).
- **`POST /calendar` étendu** ([server/src/routes/calendar.ts](server/src/routes/calendar.ts)) : accepte désormais `mailAccountId` et `createOnCaldav`. Lorsque `createOnCaldav = true`, le serveur :
  1. vérifie l'accès à la boîte mail (propriété directe ou assignation via `mailbox_assignments`),
  2. déchiffre le mot de passe IMAP pour construire un `CalDAVService`,
  3. appelle `MKCALENDAR` distant,
  4. insère la ligne locale avec `source = 'caldav'`, `caldav_url = external_id = <href créé>`, liée à `mail_account_id`.
  Toute erreur MKCALENDAR (`4xx/5xx`) remonte en `502` avec le message du serveur, aucune ligne locale n'est créée pour éviter les calendriers « fantômes ».

#### Menu contextuel — corrections

- **Le sous-menu *Couleur* ne ferme plus le menu pendant le défilement** ([client/src/components/ui/ContextMenu.tsx](client/src/components/ui/ContextMenu.tsx)) : le `scroll` listener global filtre désormais les événements dont la cible est à l'intérieur du menu. On peut faire défiler la liste des couleurs (`max-h-[300px] overflow-y-auto`) sans refermer le clic droit.
- **Stabilité du menu** : suppression de la dépendance `motion/react` pour l'animation d'ouverture (remplacée par les animations Tailwind `animate-in fade-in zoom-in-95`). Supprime la boucle de re-rendu constatée sur certains clics droits (trace `scheduleUpdateOnFiber` → `reconcileChildren` récursive visible dans les anciens logs).

#### Synchronisation CalDAV & CardDAV liées à la boîte mail (o2switch / SabreDAV / SOGo)

- **Administration — Ajout d'un calendrier via URL CalDAV** ([server/src/routes/admin.ts](server/src/routes/admin.ts), [client/src/components/admin/AdminCalendarManagement.tsx](client/src/components/admin/AdminCalendarManagement.tsx)) : nouveau bouton *« Ajouter via CalDAV »* dans *Gestion des calendriers*, ouvrant une modale qui demande l'URL, le propriétaire (utilisateur cible) et la couleur par défaut. Le backend (`POST /admin/calendars/import-caldav`) tente d'abord une connexion sans identifiants ; si le serveur répond `401/403`, la réponse est renvoyée en **HTTP 200** avec `{ ok: false, needsAuth: true }` pour éviter la déconnexion automatique de la session admin, et les champs *Identifiant* + *Mot de passe* s'affichent dans la modale. La dédup se fait sur `(user_id, external_id, mail_account_id IS NULL)`.
- **Formulaire admin de création de boîte mail — case « Synchronisation O2Switch (CalDAV + CardDAV) »** ([client/src/pages/AdminPage.tsx](client/src/pages/AdminPage.tsx), [server/src/routes/admin.ts](server/src/routes/admin.ts)) : cochée par défaut, elle pré-remplit automatiquement les URLs CalDAV et CardDAV au format O2Switch. Lors de l'attribution ultérieure de la boîte à un utilisateur (`POST /admin/mail-accounts/:id/assignments`), une première synchronisation CalDAV est lancée en arrière-plan pour cet utilisateur.
- **Auto-configuration o2switch** à la création ou à la liaison d'une boîte mail :
  - Nouveau flag `o2switchAutoSync` sur `POST /api/accounts` — quand il est coché (ou quand le champ `imapHost` se termine par `.o2switch.net`), le serveur pré-remplit automatiquement :
    - CalDAV : `https://colorant.o2switch.net:2080/calendars/{email}/calendar`
    - CardDAV : `https://colorant.o2switch.net:2080/addressbooks/{email}/addressbook`
    - les deux activés (`caldav_sync_enabled = true`, `carddav_sync_enabled = true`) avec le même mot de passe que IMAP/SMTP.
  - Nouveau flag `autoSyncDav` (par défaut `true`) sur `POST /api/admin/o2switch/accounts/:id/link` qui applique la même configuration à une boîte cPanel liée à un compte local.
  - Une **synchronisation CalDAV initiale** est lancée en arrière-plan juste après la création pour chaque utilisateur assigné, afin que les calendriers distants apparaissent immédiatement sans intervention manuelle.
- **Bouton « Ajouter un calendrier (CalDAV) »** dans la barre latérale du calendrier ([CalendarSidebar.tsx](client/src/components/calendar/CalendarSidebar.tsx)) : une icône `CloudDownload` placée à gauche du bouton *Nouveau calendrier* ouvre la modale de synchronisation pour relier une boîte mail à un serveur CalDAV.
- **Fusion du calendrier local par défaut avec le calendrier distant par défaut** ([caldav.ts](server/src/services/caldav.ts) → `syncForMailAccount`) : lors de la première synchro, le calendrier local marqué `is_default = true` est **promu** (au lieu d'être dupliqué) et rattaché au calendrier distant nommé *calendar / default / agenda* (ou le premier renvoyé par le serveur) — `mail_account_id`, `caldav_url`, `external_id` et `source = 'caldav'` sont mis à jour en place. Les événements existants restent visibles et les nouveaux événements sont désormais poussés vers l'URL CalDAV.
- **Push automatique des événements vers le serveur CalDAV** ([calendar.ts](server/src/routes/calendar.ts)) : après chaque `POST /events`, `PUT /events/:id` et `DELETE /events/:id` sur un calendrier lié, l'événement est sérialisé en iCal (`buildIcs`) puis envoyé via `PUT {caldavUrl}/{uid}.ics` ou `DELETE`. Les appels sont en *fire-and-forget* : une erreur réseau côté CalDAV n'empêche jamais la réponse HTTP locale, mais est journalisée. Un `ical_uid` est désormais généré à la création pour garantir la correspondance distante.
- **Push automatique des contacts vers le serveur CardDAV** ([contacts.ts](server/src/routes/contacts.ts)) :
  - nouveau sérialiseur [server/src/utils/vcard.ts](server/src/utils/vcard.ts) — vCard 4.0 avec `UID`, `FN`, `N`, `EMAIL`, `TEL (WORK/CELL)`, `ORG`, `TITLE`, `NOTE`, `REV`, encodage RFC 6350 (escape `\`, `,`, `;`, `\n`) et fold à 75 octets.
  - nouveau client [server/src/services/carddav.ts](server/src/services/carddav.ts) (`testConnection`, `putContact`, `deleteContact`) exposant `PUT {collection}/{uid}.vcf` avec `If-Match` sur l'ETag et `DELETE`.
  - `POST /api/contacts` génère un UID stable, rattache le contact à la première boîte mail CardDAV disponible (`findCardDAVAccount`) puis pousse la vCard en arrière-plan ; `carddav_href` et `carddav_etag` sont stockés pour les mises à jour ultérieures.
  - `PUT /api/contacts/:id` repousse la vCard avec l'ETag connu.
  - `DELETE /api/contacts/:id` capture les infos CardDAV avant suppression locale puis envoie le `DELETE` distant.
- **Heuristique `suggestCaldavUrl()`** améliorée dans la modale de synchro ([SyncCalendarsDialog.tsx](client/src/components/calendar/SyncCalendarsDialog.tsx)) : détection prioritaire d'o2switch (hôte contenant `o2switch`) et génération directe du chemin SabreDAV officiel `https://{cpanel}:2080/calendars/{email}/calendar`. Fallback NextCloud / SOGo générique conservé.
- **Nouvelles colonnes BDD** ([server/src/database/connection.ts](server/src/database/connection.ts)) :
  - `mail_accounts` : `carddav_url`, `carddav_username`, `carddav_sync_enabled`, `carddav_last_sync`.
  - `contacts` : `mail_account_id` (FK → `mail_accounts`), `carddav_url`, `carddav_href`, `carddav_etag`.
  - Nouveaux index : `idx_contacts_mail_account`, `idx_events_caldav_unique` (index partiel unique `(calendar_id, ical_uid) WHERE external_id IS NOT NULL` — requis par le `ON CONFLICT` de la synchro, son absence provoquait un 500 « *there is no unique or exclusion constraint matching the ON CONFLICT specification* »).

### Ajouté (autres)

#### Page Contacts — refonte majeure

- **Import / Export multi-formats** : nouvel utilitaire `client/src/utils/contactImportExport.ts` avec parsers et générateurs compatibles avec les principaux logiciels :
  - **vCard 3.0 / 4.0** (`.vcf`) — Apple Contacts, iOS, macOS, Android, Thunderbird
  - **CSV Google Contacts** — des webmails courants / Google Contacts
  - **CSV style messagerie professionnelle / Microsoft 365**
  - **CSV générique** compatible tableur
  - Détection automatique du format à l'import, gestion du BOM UTF-8, décodage des photos embarquées (`PHOTO;ENCODING=b`).
- **Route d'import en masse** `POST /api/contacts/import` avec 3 modes de gestion des doublons :
  - `merge` : compléter les champs existants
  - `skip` : ignorer si l'e-mail existe déjà
  - `replace` : écraser les champs des contacts existants
  - Déduplication par e-mail, promotion automatique des expéditeurs non enregistrés lors d'un import.
- **Modale d'import** avec drag & drop, détection du format, aperçu des 50 premiers contacts avant validation et choix du mode de fusion.
- **Menu d'export** (vCard, CSV Google, CSV style messagerie professionnelle, CSV générique) accessible depuis la barre latérale de la page Contacts.
- **Nouveaux filtres** dans la barre latérale :
  - **Favoris** (étoile, ambre) — contacts marqués comme favoris
  - **Enregistrés** (vert) — contacts permanents (`source = 'local'`)
  - **Expéditeurs non enregistrés** (orange) — source `sender`
  - **NextCloud** (bleu, `Cloud` icon) — affiché uniquement si au moins un contact provient de NextCloud (filtre `source = 'nextcloud'`)
- **Avatars colorés** avec dégradés déterministes par e-mail (10 couleurs) ; upload de photo de contact redimensionnée côté navigateur (256 px max, JPEG 85 %, 2 Mo max).
- **Bannière personnalisable** sur la fiche contact : 15 couleurs/dégradés prédéfinis (Auto, Bleu, Vert, Violet, Rose, Ambre, Cyan, Corail, Indigo, Turquoise, Orange, Ardoise, Coucher de soleil, Océan, Forêt) ou image custom (JPG/PNG, 3 Mo max, redimensionnée à 1200 px de large).
- **Recadrage et ajustement de l'image de bannière** dans l'onglet *Apparence* :
  - **3 modes d'ajustement** : *Remplir* (`cover`, recadrage automatique), *Étirer* (`fill`, déformation pour couvrir toute la surface), *Adapter* (`contain`, image entière avec bandes).
  - **Glisser-déposer** directement sur l'aperçu pour repositionner le recadrage en mode *Remplir*.
  - **Sliders X / Y** (0–100 %) pour un positionnement au pixel près.
  - Boutons dédiés sur l'aperçu pour **remplacer** ou **supprimer** l'image.
  - Préférences persistées dans `contacts.metadata.bannerFit`, `bannerPosX`, `bannerPosY`.
- **Champs étendus** stockés dans `contacts.metadata` (jsonb) : `website`, `birthday`, `address`, `bannerColor`, `bannerImage`, `bannerFit`, `bannerPosX`, `bannerPosY`.
- **Fiche contact enrichie** : bannière en tête, avatar XL à cheval sur la bannière, sections **Coordonnées**, **Professionnel**, **Informations** (anniversaire, adresse), **Notes** ; chaque section affiche ses champs en grille 2 colonnes. Boutons d'action rapide (e-mail, téléphone) et action « Enregistrer » pour promouvoir un expéditeur.
- **Modale d'édition à onglets** : *Général* (identité, e-mail, téléphones) — *Professionnel* (entreprise, fonction, service, site web) — *Plus* (anniversaire, adresse, notes) — *Apparence* (couleur/image de la bannière avec aperçu en direct sur l'en-tête de la modale). Bouton favori en pilule, avatar avec boutons de prise de vue et de suppression.
- **Groupement alphabétique** de la liste avec en-têtes collants (A, B, C…) et choix du tri : Nom / Récent / Entreprise.
- **Barre latérale redimensionnable** : poignée verticale entre la liste et la fiche (240–600 px), persistée dans `localStorage` (`contacts-sidebar-width`), double-clic pour réinitialiser à 320 px.
- **Couleurs adaptées au thème sombre** : utilisation de `bg-style messagerie professionnelle-bg-selected`, `bg-style messagerie professionnelle-bg-primary` et `bg-style messagerie professionnelle-bg-tertiary` (variables CSS du thème) pour que le contact sélectionné, les en-têtes alphabétiques et les cartes restent lisibles en mode sombre.
- **Champs étendus** stockés dans `contacts.metadata` (jsonb) : `website`, `birthday`, `address`, `bannerColor`, `bannerImage`, `bannerFit`, `bannerPosX`, `bannerPosY`.

### Corrigé

- **Persistance de la personnalisation du contact** : la route `PUT /api/contacts/:id` ignorait totalement la colonne `metadata`. Les champs personnalisation (bannière, site web, anniversaire, adresse) étaient donc perdus après enregistrement. Ajout d'une fusion jsonb `metadata = COALESCE(metadata, '{}'::jsonb) || $::jsonb` et envoi de `null` explicite côté client pour les valeurs effacées (sinon la clé absente laissait l'ancienne valeur).
- **Rafraîchissement immédiat de la fiche contact après enregistrement** : la page Contacts stockait un snapshot (`selectedContact`) au lieu d'un identifiant. Après invalidation de React Query, la liste se mettait à jour mais la fiche affichée restait figée sur l'ancien objet jusqu'au rechargement. Remplacé par `selectedContactId` + `useMemo` pour toujours dériver le contact depuis la liste fraîche.
- **Étoiles favori en doublon** retirées :
  - dans la ligne de liste à gauche (seule l'étoile cliquable à droite reste)
  - dans la fiche détaillée à côté du nom (seule l'étoile du bandeau supérieur droit reste)

#### Édition interactive des images insérées — compose et signatures
- **Nouvel utilitaire partagé** `client/src/utils/imageEditing.ts` exposant `attachImageEditing(editor)` : attaché à un éditeur `contenteditable`, il rend toutes les `<img>` interactives et renvoie un disposer qui nettoie les listeners, l'overlay et les styles injectés.
- **Sélection visuelle** : un clic sur une image dans l'éditeur la sélectionne (contour bleu `outline: 2px solid #2563eb`). Un clic en dehors, la touche `Échap` ou la perte de focus la désélectionne. `Suppr` / `Retour arrière` supprime l'image sélectionnée.
- **Barre flottante** (portée dans `document.body`, positionnée au-dessus de l'image et reclampée dans le viewport, repositionnée sur `scroll` / `resize` et via un `MutationObserver`) avec :
  - alignements **gauche / centre / droite** (via `float` + marges pour gauche/droite, `display:block; margin:auto` pour le centre ; le bouton actif est mis en évidence) ;
  - préréglages de largeur **25 % / 50 % / 75 % / 100 %** de la largeur naturelle de l'image, bridés à la largeur de l'éditeur ;
  - **↺ Taille d'origine** (supprime `width`/`height` et recadre à la largeur de l'éditeur si nécessaire) ;
  - **🗑 Supprimer** l'image.
- **Poignée de redimensionnement** (coin bas-droit) : glisser pour redimensionner en conservant le ratio (`width` en `px`, `height: auto`), bridé à la largeur de l'éditeur ; émet un `input` event à la fin du drag pour que React sauvegarde le HTML.
- **Persistance** : tous les styles (`float`, marges, `width`) sont écrits directement sur l'élément `<img>`, donc conservés à l'envoi du mail et à la sauvegarde de la signature.
- **Intégration** : activé via un `useEffect` dans `ComposeModal.tsx` (sur l'éditeur interne *ou* externe passé par le ruban) et dans `SignatureEditorModal` (`SignatureModals.tsx`).

#### Signature par compte de messagerie
- **Signature par défaut distincte par boîte mail** : chaque compte peut désormais surcharger les signatures par défaut « nouveaux messages » et « réponses/transferts », indépendamment des défauts globaux.
- **Module `signatures.ts`** enrichi :
  - deux nouvelles maps `localStorage` : `mail.signatures.accountDefaultNew.v1` et `mail.signatures.accountDefaultReply.v1` (`Record<accountId, signatureId | null>`) — `undefined` (clé absente) = suit la valeur globale, `null` = « aucune signature » pour ce compte, `string` = id de signature ;
  - helpers `getAccountDefaultNewId(accountId)` / `getAccountDefaultReplyId(accountId)`, `setAccountDefaultNewId(accountId, id)` / `setAccountDefaultReplyId(accountId, id)` (avec `id === undefined` pour retirer l'override) ;
  - résolveurs `resolveDefaultNewId(accountId)` / `resolveDefaultReplyId(accountId)` qui retournent l'override du compte si présent, sinon la valeur globale ;
  - `deleteSignature()` purge automatiquement les overrides par compte qui pointaient sur l'ID supprimé.
- **UI `SignaturesManagerModal`** (`client/src/components/mail/SignatureModals.tsx`) : nouvelle section **« Signature par compte de messagerie »** entre les défauts globaux et la liste des signatures. Un bloc par compte avec :
  - pastille colorée (`acc.color`) + nom et adresse du compte,
  - deux `<select>` (*Nouveaux messages* / *Réponses et transferts*) proposant `(Valeur par défaut globale)`, `(Aucune signature)`, puis la liste des signatures ;
  - re-render via un compteur `acctVersion` bumpé à chaque `mail.signatures.changed`.
- **Propagation** : `Ribbon.tsx` passe désormais sa prop `accounts` au `SignaturesManagerModal` (`accounts?: MailAccount[]`).
- **Intégration compose** (`ComposeModal.tsx`) : à l'initialisation de `bodyHtml`, la signature est choisie via `resolveDefault{New,Reply}Id(activeAccountId)` — l'override du compte l'emporte, sinon on retombe sur la valeur globale. Comportement inchangé si aucun override n'est défini.

#### Sauvegarde & restauration de la configuration locale
- **Nouvel onglet *Paramètres → Sauvegarde*** (`client/src/pages/SettingsPage.tsx` → `BackupSettings`, icône `HardDrive`) pour exporter, importer et automatiser la sauvegarde de toute la configuration **locale** à l'appareil : signatures (images embarquées incluses en data URI), catégories (+ assignations), renommage et ordre des boîtes mail/dossiers, favoris, vues unifiées, thème, préférences d'affichage (reading pane, densité, conversations, ribbon, splits, largeurs, onglets), préférences de notifications, clé API GIPHY personnelle, emojis récents. Les mails eux-mêmes restent sur le serveur IMAP ; les contacts, calendriers et listes de distribution sont serveur/NextCloud ; les clés privées PGP/S/MIME disposent de leur propre export depuis la page **Sécurité** — tous volontairement exclus du `.json` de sauvegarde.
- **Module dédié** `client/src/utils/backup.ts` avec :
  - `collectBackup()` / `applyBackup()` / `parseBackupFile()` basés sur une **whitelist** de clés `localStorage` (format versionné `{app, version, createdAt, userAgent, data}`, `app="web-mail-client"`, `version=1`).
  - `downloadBackup()` — export manuel en `.json` avec horodatage.
  - **Sauvegarde automatique** via **File System Access API** (`showDirectoryPicker` avec `startIn: 'documents'`) : l'utilisateur choisit un dossier sur son PC, le `FileSystemDirectoryHandle` est persisté en **IndexedDB** (store `web-mail-client-backup/handles`) pour survivre aux rechargements. Un seul et même fichier est réécrit à chaque modification.
  - **Nom de fichier personnalisable** (`backup.auto.filename`) avec `sanitizeFilename()` (filtrage des caractères interdits Windows/Linux et forçage de l'extension `.json`) — permet de donner un nom explicite type `Web-Mail-Client-NE-PAS-SUPPRIMER.json` pour éviter les suppressions accidentelles.
  - **Watcher non-invasif** (`startAutoBackupWatcher()`, démarré dans `client/src/main.tsx`) : monkey-patch de `Storage.prototype.setItem/removeItem` qui émet un événement `local-settings-changed` uniquement pour les clés de la whitelist, puis **débounce 4 s** avant de relancer l'écriture. Écoute aussi `mail.signatures.changed`, `mail-categories-changed`, `storage` (changements cross-onglets) et `beforeunload`.
  - Vérification des permissions avant chaque écriture (`queryPermission({ mode: 'readwrite' })`) ; en mode non-interactif, les pertes de permission sont consignées dans `backup.auto.lastError` sans déranger l'utilisateur.
- **Clés sauvegardées** (whitelist `BACKUP_KEYS`) : `theme.mode`, `mail.signatures.v1` / `defaultNew` / `defaultReply`, `mail.categories`, `mail.messageCategories`, `mail.accountDisplayNames`, `mail.accountOrder`, `mail.folderOrder`, `mail.expandedAccounts`, `mail.favoriteFolders`, `mail.favoritesExpanded`, `mail.unifiedAccounts`, `mail.unifiedInboxEnabled`, `mail.unifiedSentEnabled`, `mail.deleteConfirmEnabled`, `readingPaneMode`, `listDensity`, `listDisplayMode`, `conversationView`, `conversationGrouping`, `conversationShowAllInReadingPane`, `listHeight`, `splitRatio`, `splitKeepFolderPane`, `splitKeepMessageList`, `splitComposeReply`, `ribbonCollapsed`, `ribbonMode`, `mailListWidth`, `folderPaneWidth`, `tabMode`, `maxTabs`, `notifications.sound`, `notifications.calendar`, `giphyApiKey`, `emoji-panel-recent`.
- **Intégration UI** : sélecteur de dossier avec libellé persistant, toggle *Activer la sauvegarde automatique*, bouton *Sauvegarder maintenant*, bouton *Restaurer depuis un fichier…* avec confirmation + rechargement auto. Bandeau d'avertissement sur Firefox/Safari (fallback automatique sur téléchargement). Affichage de la date et de l'erreur de la dernière sauvegarde.
- **Clés `localStorage` ajoutées** (scope `backup.*`, jamais incluses dans l'export lui-même) : `backup.auto.enabled`, `backup.auto.filename`, `backup.auto.lastAt`, `backup.auto.lastError`, `backup.auto.dirLabel`.
- Nouveau fichier [docs/BACKUP.md](docs/BACKUP.md) documentant le format, les clés sauvegardées, les navigateurs compatibles, ce qui est **exclu** (contacts serveur, clés privées, e-mails IMAP) et l'intégration avec Duplicati.

#### Branding personnalisable — favicon et icônes PWA
- **Upload d'icônes depuis l'admin** (`client/src/pages/AdminPage.tsx` → `BrandingSettings`, sous l'onglet **Système**) : un administrateur peut désormais téléverser le favicon (`favicon.ico`), les icônes PWA 192×192 et 512×512 ainsi que l'Apple Touch Icon (180×180) directement via l'interface, sans rebuild ni accès serveur. Aperçu en miniature, bouton **Réinitialiser** pour revenir à l'asset bundle par défaut, badge *Image personnalisée active* si un upload a été fait.
- **Nouveau routeur serveur** `server/src/routes/branding.ts` avec :
  - `GET /api/branding` (public, non authentifié) → renvoie `app_name` + URLs des icônes (avec cache-busting basé sur `mtime`) + flags `custom.*` indiquant si chaque icône est personnalisée ;
  - `POST /api/admin/branding/:type` (admin, `multer` mémoire, limite 5 Mo, filtre MIME sur `image/*`) → écrit le fichier dans `server/uploads/branding/` avec un nom canonique ;
  - `DELETE /api/admin/branding/:type` (admin) → supprime l'upload pour revenir au bundle.
- **Interception transparente** (`server/src/index.ts`) : un middleware Express intercepte `/favicon.ico`, `/icon-192.png`, `/icon-512.png` et `/apple-touch-icon.png` avant `express.static` — si un fichier personnalisé existe dans `uploads/branding/`, il est servi avec `Cache-Control: no-cache`, sinon la requête retombe sur le bundle statique du client.
- **API cliente** (`client/src/api/index.ts`) : nouvelles méthodes `api.getBranding()`, `api.uploadBrandingIcon(type, file)` (multipart `FormData`) et `api.resetBrandingIcon(type)`.
- **Application dynamique dans l'UI** (`client/src/App.tsx`) : au chargement, l'app récupère `/api/branding` et met à jour le `<link rel="icon">` ainsi que `document.title` en temps réel — les modifications faites dans l'admin sont visibles au prochain rafraîchissement sans toucher au code ni au build.

#### Titre d'onglet dynamique — style messagerie professionnelle
- **Titre contextuel dans l'onglet du navigateur** (`client/src/pages/MailPage.tsx`, `client/src/App.tsx`) : l'onglet du navigateur affiche désormais `<Nom du dossier> — <Nom de l'application>` (par exemple *Boîte de réception — WebMail*, *Éléments supprimés — WebMail*), comme style messagerie professionnelle Web. Hors de la section mail, seul le nom de l'application est affiché.
- **Résolution intelligente des noms de dossier** : la fonction `resolveFolderDisplayName` (`client/src/components/mail/MessageList.tsx`) est désormais exportée pour être réutilisée par `MailPage`. Elle mappe les chemins IMAP techniques (`INBOX`, `Sent`, `Trash`, `INBOX.Archives`…) vers leurs libellés francisés (*Boîte de réception*, *Éléments envoyés*, *Éléments supprimés*…) et gère les dossiers imbriqués en n'affichant que le segment feuille.
- **Prise en charge des vues unifiées** : la boîte de réception unifiée et les éléments envoyés unifiés affichent `Boîte de réception (unifiée) — <App>` / `Éléments envoyés (unifiés) — <App>`.

#### Insertion d'images locales — compose et signatures
- **Sélecteur de fichier natif** au lieu d'un `prompt()` pour la saisie d'URL : dans le ruban de rédaction (`client/src/components/mail/Ribbon.tsx`, onglet **Insérer → Image**), dans la barre d'outils inline du compose (`client/src/components/mail/ComposeModal.tsx`) et dans l'éditeur de signature (`client/src/components/mail/SignatureModals.tsx`), un clic sur le bouton **Image** ouvre désormais l'explorateur de fichiers OS.
- **Intégration inline en data URI** : l'image choisie est lue via `FileReader.readAsDataURL()` et insérée directement dans le corps du message / de la signature via `document.execCommand('insertImage', dataUrl)`. Aucune URL externe n'est requise, l'image est embarquée dans le HTML du message.
- **Garde-fous** : vérification du type MIME (`file.type.startsWith('image/')`), limite de taille à **5 Mo** pour les mails et **2 Mo** pour les signatures, toasts d'erreur explicites sinon. `accept="image/*"` sur les inputs pour filtrer la boîte de dialogue OS.

### Modifié

- Le panneau **Système** de l'administration expose maintenant une nouvelle section *Branding & icônes* en-dessous des paramètres système existants (inscription, tailles de pièces jointes, pattern d'archive).

### Corrigé

#### Build Docker — compilation TypeScript client & serveur
- **Client** (`client/src/components/mail/Ribbon.tsx`) : `editorRef.current?.focus()` dans la nouvelle fonction `handleImageFile` faisait échouer `tsc -b` avec `TS18048: 'editorRef' is possibly 'undefined'`. La prop `editorRef` du ruban est typée optionnelle (`React.RefObject<HTMLDivElement> | undefined`), il manquait donc le chaînage optionnel sur `editorRef` lui-même. Corrigé en `editorRef?.current?.focus()`.
- **Serveur** (`server/src/routes/branding.ts`) : le callback `fileFilter` de `multer` attend la signature stricte `cb(null, boolean)` ou `cb(error)`. L'appel `cb(ok ? null : new Error(...), ok)` produisait `TS2345: Argument of type 'Error | null' is not assignable to parameter of type 'null'`. Corrigé en branchant explicitement selon le résultat du test MIME (`cb(null, true)` si ok, `cb(new Error(...) as any, false)` sinon).

---

### Ajouté (précédemment)

#### Signatures multiples — gestion complète style messagerie professionnelle

- **Signatures multiples par utilisateur** : création, édition, suppression et nommage de plusieurs signatures HTML depuis l'onglet **Insérer → Signature** du ruban de rédaction (`client/src/components/mail/Ribbon.tsx`). Un menu déroulant liste toutes les signatures enregistrées pour les insérer d'un clic dans le corps du message, et un lien **Signatures…** ouvre la gestion complète.
- **Modale de gestion** (`client/src/components/mail/SignatureModals.tsx` → `SignaturesManagerModal`) : liste des signatures existantes avec actions *Modifier*, *Supprimer* et menu **…** pour définir rapidement la signature par défaut ; deux sélecteurs pour la **valeur par défaut des nouveaux messages** et pour la **valeur par défaut des réponses et transferts** ; bouton **+ Ajouter une signature**.
- **Éditeur WYSIWYG dédié** (`SignatureEditorModal`) avec deux onglets *Mettre le texte en forme* / *Insérer* : gras, italique, souligné, barré, palette de couleurs, listes à puces et numérotées, alignements, insertion de liens et d'images. Cases à cocher *Définir les valeurs par défaut des nouveaux messages* et *Définir la valeur par défaut des réponses et des transferts* pour basculer les défauts directement depuis l'édition.
- **Insertion automatique dans le compose** (`client/src/components/mail/ComposeModal.tsx`) : à l'ouverture d'un nouveau message, la signature « nouveaux messages » est insérée sous le corps vide ; pour une réponse ou un transfert, la signature « réponses/transferts » est insérée **avant** la citation d'origine, comme style messagerie professionnelle Web.
- **Persistance locale** (`client/src/utils/signatures.ts`) : stockage dans `localStorage` (`mail.signatures.v1`, `mail.signatures.defaultNew`, `mail.signatures.defaultReply`) avec événement `mail.signatures.changed` pour synchroniser toutes les vues (ruban, modales) en temps réel. Les signatures et leurs valeurs par défaut restent 100 % côté client et ne transitent jamais par le serveur.
- **Bloc signature isolé** : chaque signature insérée est enveloppée dans un `<div class="style messagerie professionnelle-signature" data-signature="true">` précédé d'un saut de ligne, pour faciliter un repérage / remplacement futur et préserver le formatage d'origine.

### Corrigé

#### Build Docker — compilation TypeScript du client
- **Échec de `npm run build` dans le Dockerfile** (`compose build operation failed … exit code: 1`) : le type du paramètre de `upsertSignature` (`client/src/utils/signatures.ts`) combinait `Omit<MailSignature, 'updatedAt'>` avec `& { id?: string }`, mais une intersection TypeScript **ne rend pas une propriété déjà requise optionnelle** — `id` restait donc obligatoire et `SignatureEditorModal.save()` échouait avec `TS2322: Type 'string | undefined' is not assignable to type 'string'` lors de la création d'une nouvelle signature (`signature?.id` vaut `undefined`). Le type a été remplacé par un littéral explicite `{ id?: string; name: string; html: string }`, ce qui débloque le build Docker et la compilation locale.

### Amélioré

#### Mode sombre — lisibilité du corps des e-mails HTML
- **Rendu des e-mails sur surface claire en mode sombre** : beaucoup d'e-mails HTML embarquent des couleurs codées en dur via des styles inline (texte noir sur fond blanc, citations grises, signatures colorées…) qui restaient superposées au fond sombre de l'application et devenaient illisibles — certains blocs apparaissaient en noir sur gris foncé, d'autres en blanc sur blanc selon la façon dont l'expéditeur avait mis en forme le message. Le conteneur `.email-body` est désormais rendu sur un fond blanc dédié avec un padding et un `border-radius`, et `color-scheme: light` est forcé sur l'arbre HTML du message afin que les contrôles de formulaire et les citations restent cohérents (`client/src/index.css`). Cette approche est celle utilisée par des webmails courants et style messagerie professionnelle Web : le reste de l'interface (en-tête, barre de conversation, boutons *Répondre / Transférer*) conserve le thème sombre, seul le corps HTML est isolé sur sa propre surface pour préserver les couleurs d'origine conçues par l'expéditeur.
- La couleur d'accent `#0078D4` est réappliquée explicitement aux liens à l'intérieur du corps pour rester lisible sur le fond blanc même si l'e-mail n'impose pas de couleur de lien.

### Ajouté

#### Sécurité suppression — corbeille et confirmation
- **Suppression non destructive par défaut** : la suppression d'un message depuis le ruban, la liste, le contexte, la vue d'un message, la vue partagée (split) ou un brouillon compagnon déplace maintenant l'e-mail vers le dossier **Corbeille / Éléments supprimés** de son compte au lieu de l'effacer définitivement du serveur. Si le message est déjà dans la corbeille — ou si aucun dossier corbeille ne peut être localisé — la suppression devient définitive (comportement IMAP EXPUNGE historique).
- **Détection robuste du dossier Corbeille** : nouveau helper `findTrashFolderPath` / `isTrashFolderPath` (`client/src/utils/mailPreferences.ts`) qui privilégie l'attribut IMAP `SPECIAL-USE \Trash`, puis reconnaît par nom/chemin les variantes courantes (*Trash*, *Corbeille*, *Deleted Items*, *Éléments supprimés*, `INBOX.Trash`, etc.).
- **Dialogue de confirmation** : nouveau composant `ConfirmDialog` (`client/src/components/ui/ConfirmDialog.tsx`) affiché avant chaque suppression, avec :
  - libellé et couleur adaptés (bleu *Déplacer dans la corbeille* vs rouge *Supprimer définitivement*) ;
  - raccourcis clavier **Entrée** pour confirmer et **Échap** pour annuler ;
  - focus automatique sur le bouton principal et fermeture par clic extérieur.
- **Réglage par utilisateur dans le ruban → Afficher** : nouveau groupe **Sécurité** avec un bouton *Confirmer suppr.* / *Suppr. directe* (icônes `ShieldAlert` / `ShieldOff`). La préférence est persistée par utilisateur dans `localStorage` (`mail.deleteConfirmEnabled`, défaut `true`) et appliquée instantanément à toutes les entrées de suppression (ruban, liste, menu contextuel, vue message, split view).
- **Feedback utilisateur** : le toast indique désormais *Message envoyé dans la corbeille* ou *Message supprimé* selon l'issue, et la liste des dossiers est invalidée pour refléter immédiatement le nouveau compteur de la corbeille.

### Amélioré

#### Liste des messages — cohérence de l'étoile (favori)
- L'étoile de la carte d'aperçu (mode narrow) n'est plus affichée en permanence en bas à droite : elle a été **déplacée en haut à droite**, à côté du drapeau, dans le même groupe d'actions de survol que *Marquer lu/non lu*, *Drapeau* et *Supprimer* (`client/src/components/mail/MessageList.tsx`). L'icône n'apparaît donc qu'au survol d'une ligne, pour une hiérarchie visuelle plus claire.

#### Notifications push — comportement Windows 11 / Chromium
- **Notifications plus visibles et persistantes** : ajout de `requireInteraction: true` par défaut dans le Service Worker (`client/src/sw.ts`) — les notifications restent affichées jusqu'à interaction de l'utilisateur au lieu de disparaître après ~5 s (comportement par défaut trop rapide sur Windows 11).
- **Boutons d'action natifs** : chaque notification expose désormais deux actions (`Ouvrir` / `Ignorer`, ou `Lire` / `Ignorer` pour les nouveaux mails). Windows 11 affiche alors une **bannière plus large** avec les boutons au lieu de la mini-bannière compacte.
- **Son systématique** : `silent: false` explicite + `renotify: true` lorsqu'un `tag` est présent → chaque nouveau message déclenche son et bannière, même si une notification précédente est encore affichée.
- **Champs enrichis** : support des propriétés `image` (grande vignette), `vibrate` (mobile), `timestamp` et `actions` dans le payload serveur (`PushPayload` étendu dans `server/src/services/push.ts`).
- **Poller de nouveaux mails** (`server/src/services/newMailPoller.ts`) : émet désormais les notifications avec `requireInteraction`, `renotify`, `vibrate` et actions `Lire` / `Ignorer`.
- **Route de test** (`POST /api/push/test`) : envoie une notification avec les mêmes options enrichies que les notifications réelles pour que le test reflète fidèlement le rendu final.
- **Gestion du clic `Ignorer`** : le Service Worker distingue l'action `dismiss` (ferme la notification sans focaliser l'onglet) des actions `open` / clic principal (focalise l'application et navigue vers l'URL cible).
- **Astuce paramètres enrichie** : l'onglet *Paramètres → Notifications* détaille maintenant comment activer les notifications système natives sur **Vivaldi** (`vivaldi://flags/#enable-system-notifications`), Chrome et Edge, et rappelle d'installer la PWA pour qu'elles s'affichent sous le nom **WebMail** (et non sous celui du navigateur hôte) avec leur propre icône, son et réglages dans *Paramètres Windows → Notifications*.

### Corrigé

- **Ruban simplifié — menus non fonctionnels** : en mode simplifié, les boutons *Catégoriser*, *Volet de lecture*, *Liste mail*, *Densité*, *Conversations* et *Boîtes favoris* mettaient bien à jour leur état d'ouverture mais n'affichaient aucun popup. Les menus (`createPortal`) étaient rendus exclusivement dans le JSX du ruban classique, qui n'est jamais évalué quand le mode simplifié fait un `return` anticipé. Les 6 menus ont été extraits dans un fragment `sharedPopups` commun rendu dans les deux modes (`client/src/components/mail/Ribbon.tsx`).
- **Crash de la vue conversation — `TypeError: Me.trim is not a function`** : lorsqu'un serveur IMAP renvoyait plusieurs Message-IDs dans `References` / `In-Reply-To`, `mailparser` transmettait un `string[]` au lieu d'une `string`. Le `useMemo` calculant le `threadKey` appelait alors `.trim()` directement sur le tableau et faisait planter l'arbre React au premier rendu de `MessageList`. Correctif double :
  - Côté serveur, normalisation en `string` (`Array.isArray ? arr.join(' ') : ...`) avant envoi au client (`server/src/services/mail.ts`).
  - Côté client, `threadKeyOf` devient défensif et gère `string | string[] | undefined` pour protéger également les messages déjà en cache IndexedDB (`client/src/components/mail/MessageList.tsx`).

### Ajouté

#### Chiffrement et signature — OpenPGP & S/MIME
- **Nouvelle page « Sécurité »** (icône clé dans la barre latérale) permettant de gérer un trousseau local de clés **OpenPGP** et de certificats **S/MIME** :
  - **OpenPGP** : génération de clé (Curve25519, nom / email / date d'expiration), import de clé privée ou publique ASCII-armored, exportation, détermination d'une clé par défaut, empreinte affichée.
  - **S/MIME** : import d'un certificat au format **PKCS#12 (.p12 / .pfx)** avec la passphrase d'origine, reconnaissance automatique du CN et de l'adresse e-mail (champ emailAddress ou SubjectAltName rfc822Name), empreinte affichée.
  - Système de **déverrouillage** par clé : la clé privée est chiffrée avec une passphrase locale (AES-GCM 256 bits via WebCrypto, dérivée par PBKDF2-SHA-256 310 000 itérations, sel unique). La clé déverrouillée est conservée **en mémoire uniquement** (jamais sur le disque) et se reverrouille à la fermeture de l'onglet.
  - Stockage des clés dans **IndexedDB** côté client ; la clé privée en clair ne quitte jamais le navigateur et n'est jamais envoyée au serveur.
- **Composition sécurisée** : un sélecteur « Sécurité » (icône bouclier) dans la barre d'outils de **Rédiger** permet de choisir parmi 7 modes :
  - `Aucun` · `PGP · Signer (cleartext)` · `PGP · Chiffrer` · `PGP · Signer + Chiffrer`
  - `S/MIME · Signer` · `S/MIME · Chiffrer` · `S/MIME · Signer + Chiffrer`
  - La signature **OpenPGP cleartext** et le chiffrement PGP **inline ASCII-armored** transitent par la route d'envoi habituelle (le payload est placé dans le corps `text/plain` + `<pre>` HTML).
  - Le **S/MIME** construit entièrement la MIME RFC 5751 côté client (`multipart/signed; protocol="application/pkcs7-signature"` ou `application/pkcs7-mime; smime-type=enveloped-data`) et l'envoi passe par la nouvelle route serveur `POST /api/mail/send-raw` qui relaie le RFC 822 sans le modifier (envelope SMTP + append IMAP dans **Sent**).
  - Chiffrement **également vers soi-même** : le message envoyé reste lisible depuis son propre dossier *Envoyés*.
  - Détection des destinataires dont la clé publique / certificat manque, avec message d'erreur clair avant l'envoi.
- **Réception sécurisée** : la vue d'un message détecte automatiquement la présence d'un bloc OpenPGP (`-----BEGIN PGP MESSAGE-----` ou `-----BEGIN PGP SIGNED MESSAGE-----`) dans le corps et :
  - **Vérifie** la signature cleartext avec toutes les clés publiques du trousseau.
  - **Déchiffre** avec chaque clé privée déverrouillée jusqu'à réussir, et indique si une signature imbriquée est valide.
  - Affiche une **bannière de statut** en tête du message (icône et couleur adaptées) : signature vérifiée / invalide, message déchiffré, clé verrouillée requise, échec de déchiffrement.
  - Remplace l'affichage du corps par le texte en clair une fois le déchiffrement réussi.
- **Nouveau module crypto côté client** (`client/src/crypto/`) reposant sur **openpgp v6**, **pkijs** et **asn1js** — aucune opération cryptographique n'est faite côté serveur, qui n'agit que comme relai SMTP/IMAP.

#### Regroupement des conversations (style messagerie professionnelle)
- Nouveau menu **Conversations** dans l'onglet **Afficher** du ruban (icône bulle de dialogue, modes classique et simplifié), avec deux sections calquées sur style messagerie professionnelle :
  - **Liste de messages** : `Regrouper les messages par conversation` · `Regrouper les messages par branches dans les conversations` · `Ne pas regrouper les messages`.
  - **Volet de lecture → Organisation des messages** : `Afficher tous les messages de la conversation sélectionnée` · `Afficher uniquement le message sélectionné`.
- **Regroupement en arborescence dans la liste** : lorsqu'un mode « Regrouper » est actif, chaque conversation est condensée en une seule ligne « racine » portant l'objet + un compteur de messages. Un **chevron** à gauche permet de déplier la conversation pour afficher les messages descendants indentés sous le parent.
- **Badge de dossier d'origine** : en vue unifiée (multi-boîtes), chaque message enfant d'une conversation porte un petit badge indiquant son dossier (ex. `Éléments envoyés`), pour distinguer les mails reçus et ceux envoyés au sein du même fil.
- **Volet de lecture thread-aware** : en mode « Afficher tous les messages de la conversation », le volet de lecture restitue l'empilement complet du fil (messages empilés, seul le plus récent déplié, en-têtes cliquables). En mode « Afficher uniquement le message sélectionné », il revient à l'affichage d'un seul message.
- **Persistance** : `conversationGrouping` (`none` / `conversation` / `branches`) et `conversationShowAllInReadingPane` sont mémorisés dans `localStorage` et restaurés au prochain chargement.

### Ajouté (hors sécurité)

#### Catégories de messages (style messagerie professionnelle)
- Nouveau bouton **Catégoriser** dans l'onglet **Accueil** du ruban (modes classique et simplifié) ainsi qu'une entrée **Catégoriser** dans le menu contextuel de la liste de mails.
- Sélecteur (popup) avec champ de recherche, cases à cocher, et raccourcis « Nouvelle catégorie », « Effacer les catégories » et « Gérer les catégories ».
- **Modal de création** d'une catégorie : nom, étoile favori, palette de 24 couleurs.
- **Modal de modification** quasi-identique à celle de création (mêmes contrôles, valeurs pré-remplies).
- **Modal de gestion** : liste de toutes les catégories avec actions favori (étoile), modifier (crayon) et supprimer (corbeille). Suppression d'une catégorie nettoie automatiquement toutes les assignations.
- **Affichage dans la liste de mails** :
  - Badges « pill » (nom + couleur) à côté de l'objet (modes wide & compact).
  - **Teinte de fond** de la ligne basée sur la couleur de la première catégorie assignée.
- **Catégorisation = épinglage automatique** : un mail catégorisé est aussi `flagged`, donc rangé dans le groupe **Épinglé** en tête de liste.
- **Catégories favorites** affichées dans la section **Favoris** du volet dossiers, sous les vues unifiées. Un clic active un **filtre unifié multi‑boîtes** (agrège l'inbox de tous les comptes inclus puis filtre par catégorie). Re-clic désactive le filtre.
- **Stockage unifié** : catégories et assignations persistées dans `localStorage` (clés `mail.categories` et `mail.messageCategories`), partagées entre toutes les boîtes mail. Les assignations utilisent `messageId` (RFC 822) en clé primaire pour suivre le mail entre déplacements et resynchronisations.
- 6 catégories par défaut (Orange / Blue / Green / Purple / Red / Yellow) seedées au premier lancement.

#### Archivage hiérarchique par date
- Le bouton **Archiver** (ruban, menu contextuel de la liste, menu « Plus » de la vue mail) déplace désormais le message dans une arborescence basée sur sa **date de réception**, en créant automatiquement les dossiers manquants : par défaut `Archives/{année}/{mois avec nom français}` (ex. `Archives/2026/04 - Avril`).
- Nouvelle route serveur `POST /api/mail/accounts/:accountId/messages/:uid/archive` et méthode `MailService.archiveMessage()` : détecte le délimiteur IMAP du serveur, lit `internalDate`/`envelope.date`, crée chaque segment de dossier de manière idempotente (et s'y abonne) avant le `MESSAGE MOVE`.
- Nouveaux paramètres administrateur dans **Administration → Système → Archivage des mails** :
  - **Dossier racine d'archive** (par défaut : `Archives`).
  - **Motif des sous-dossiers** (par défaut : `{YYYY}/{MM} - {MMMM}`), avec jetons `{YYYY}`, `{YY}`, `{MM}` (01-12), `{M}` (1-12), `{MMMM}` (Janvier…Décembre), `{MMM}` (abrégé). Le séparateur `/` délimite les segments.
- Clés `admin_settings` ajoutées : `archive_root_folder`, `archive_subfolder_pattern`.
- Notification côté client indiquant le dossier de destination effectif, et invalidation du cache des dossiers pour refléter immédiatement les nouveaux dossiers créés.

#### Disposition de la vue mail
- Nouveau groupe **Disposition** dans l'onglet **Afficher** du ruban (classique et simplifié) regroupant trois menus :
  - **Volet de lecture** : *Afficher à droite* (défaut), *Afficher en bas* ou *Plein écran*. Le choix est persisté (`readingPaneMode`). En mode *Afficher en bas*, la liste des messages est au-dessus et la lecture en dessous, avec une poignée de **redimensionnement vertical** (hauteur persistée dans `listHeight`). En mode *Plein écran*, la liste occupe toute la largeur ; à la sélection d'un mail, celui-ci remplace la liste en pleine largeur avec un bouton **×** pour revenir à la liste.
  - **Liste mail** : *Automatique (selon la largeur)*, *Une seule ligne (colonnes)* ou *Aperçu multi-lignes*. Permet de forcer l'affichage compact ou large de la liste indépendamment de sa largeur réelle. Préférence persistée (`listDisplayMode`). En disposition *Afficher en bas* et mode *Automatique*, la liste bascule automatiquement en aperçu multi-lignes.
  - **Densité** : *Spacieux*, *Confortable* (défaut) ou *Compacte*. Ajuste la hauteur des lignes de la liste. Préférence persistée (`listDensity`).
- Nouveau bouton **Conversation** dans le groupe *Disposition* de l'onglet **Afficher** (modes classique et simplifié). Lorsqu'il est activé, la **vue du mail** affiche **tout le fil de discussion sous forme d'une pile de cartes dépliables** (reçus + répondus, triés du plus ancien au plus récent). Seul le message le plus récent est **déplié par défaut** ; un clic sur l'entête d'une carte (expéditeur + date) replie/déplie son contenu avec son propre bloc de pièces jointes. Le regroupement utilise les en-têtes RFC 822 (`References`, `In-Reply-To`, `Message-ID`) avec, en dernier recours, le sujet normalisé (préfixes `Re:`/`Fwd:`/`Tr:`/`Rép:` retirés). **La liste des mails n'est pas regroupée** (tri par date conservé) ; un petit icône de conversation apparaît simplement sur les lignes appartenant à un fil contenant plusieurs messages. **Désactivé par défaut** ; préférence persistée (`conversationView`).
- **Indicateurs « répondu » et « conversation » dans la liste des mails** :
  - Icône **Répondre** (flèche retour) affichée pour chaque mail dont le flag IMAP `\Answered` est positionné — placée juste avant la date (mode *Une seule ligne*) ou à gauche des autres icônes d'état (mode *Multi-lignes*).
  - Icône **Conversation** (bulle de dialogue) affichée quand la *Vue conversation* est active et que le mail appartient à un fil contenant au moins deux messages dans la liste courante.

#### Notifications push natives (Web Push / VAPID)
- **Notifications système natives** sur Windows, macOS, Android et iOS (PWA installée via Safari, iOS 16.4+), même application fermée.
- Nouveau service Web Push côté serveur (`services/push.ts`) : génération et persistance automatique d'une paire de clés **VAPID** (dans `admin_settings`), envoi multi-appareils, purge automatique des abonnements expirés (HTTP 404/410).
- Nouveau routeur `/api/push` : `GET /public-key`, `POST /subscribe`, `POST /unsubscribe`, `POST /test`, `GET /subscriptions`.
- Nouvelle table `push_subscriptions` (endpoint unique, clés p256dh/auth, user-agent, plateforme détectée, `enabled`, horodatages).
- Nouveau Service Worker **TypeScript personnalisé** (`client/src/sw.ts`) géré par `vite-plugin-pwa` en stratégie **injectManifest** : gestion des événements `push`, `notificationclick` (focus de l'onglet + navigation via `postMessage`) et `pushsubscriptionchange` (ré-inscription transparente).
- Module client `client/src/pwa/push.ts` : détection du support, demande de permission, inscription/désinscription, test, écoute des clics de notification, détection de plateforme (Windows/macOS/Android/iOS).
- Onglet **Notifications** des paramètres utilisateur refondu : bouton Activer/Désactiver, bouton « Envoyer une notification de test », messages d'aide contextuels (support navigateur, permission refusée, instructions PWA iOS/Android/Desktop).
- Helper `notifyWithPush(userId, event, data, pushPayload, mode)` : diffuse en temps réel via WebSocket **et** en push natif aux appareils en arrière-plan (mode `auto`, `both` ou `push-only`).

#### Détection de nouveaux messages
- Nouveau **sondeur IMAP périodique** côté serveur (`services/newMailPoller.ts`) : toutes les 60 s (configurable via `NEW_MAIL_POLL_INTERVAL_MS`), il interroge l'INBOX des comptes appartenant aux utilisateurs **ayant au moins un abonnement push actif** (pour ne pas solliciter IMAP inutilement).
- Détection incrémentale par UID maximal vu (cache mémoire, baseline au premier passage — pas de notifications rétroactives).
- Notification envoyée via `notifyWithPush` en mode `both` : l'onglet ouvert reçoit un événement `new-mail` et les autres appareils reçoivent une notification système avec objet, expéditeur et aperçu (160 caractères max).
- Protection anti-flood : maximum 5 notifications par compte et par cycle.

### Paramètres d'environnement
- Nouvelles variables optionnelles : `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT` (par défaut `mailto:admin@example.com`), `NEW_MAIL_POLL_INTERVAL_MS`. Si les clés VAPID ne sont pas fournies, elles sont générées automatiquement au premier démarrage et persistées en base.

### Corrigé
- **Indicateur « répondu » jamais affiché** : le serveur ne posait pas le flag IMAP `\Answered` sur le message d'origine après un envoi de réponse. La route `POST /api/mail/send` accepte désormais `inReplyToUid` / `inReplyToFolder` (propagés par le client via `handleReply`) et appelle `MailService.setFlags({ answered: true })` après un envoi réussi. Le client applique aussi un **update optimiste** du flag local (`updateMessageFlags`) et invalide les caches `messages` / `virtual-messages` pour que l'icône *Répondre* apparaisse immédiatement dans la liste.
- **Catégories favorites** : passer d'une catégorie favorite à une autre vidait la liste des messages (la clé React Query `virtual-messages` ne changeant pas, aucun refetch n'était déclenché). `setCategoryFilter` conserve maintenant les messages déjà chargés quand la vue unifiée est déjà active et n'échange que le filtre côté client.
- Liste des messages : stabilisation de la hauteur des lignes en mode étroit pour supprimer la légère variation de taille lors du survol ou de la sélection (réservation de la hauteur des boutons d'action).
- Volet Dossiers : correction d'un crash (React #300 « Rendered fewer hooks than expected ») déclenché par le bouton « Masquer les dossiers » — le hook `useMailStore` était appelé conditionnellement dans le JSX.

### Ajouté

#### Thème sombre
- **Thème sombre complet** appliqué à toute l'interface (volets, ruban, vue message, rédaction, dialogues, menus contextuels, listes, barres de scroll, éditeur Quill).
- Par défaut, l'application suit **automatiquement le thème du système** (PC, tablette, smartphone) via `prefers-color-scheme` et réagit en temps réel aux changements système.
- **Commutateur dans l'en-tête** (en haut à droite, à côté du nom d'utilisateur) :
  - Clic simple = bascule immédiate Clair ↔ Sombre.
  - Chevron / clic droit = menu pour choisir explicitement **Système / Clair / Sombre**.
- Préférence persistée dans `localStorage` (`theme.mode`). L'attribut `color-scheme` est également synchronisé pour que les contrôles natifs (scrollbars, inputs) adoptent la bonne palette.
- Palette style messagerie professionnelle entièrement basée sur des variables CSS (`--style messagerie professionnelle-*` au format RGB) permettant les opacités Tailwind (`/30`, `/50`, etc.) dans les deux modes.

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
- Nouvel onglet **Message** dans le ruban (style messagerie professionnelle) visible uniquement pendant la rédaction, regroupant les outils de mise en forme : polices, tailles, styles (Titre 1/2/3, citation, code), gras/italique/souligné/barré, indice/exposant, couleurs de texte et de surlignage, listes, retraits, alignements.
- Nouvel onglet **Insérer** avec les groupes Inclure (joindre un fichier, lien, image), Tableaux (grille 8×10), Symboles (emojis, ligne horizontale, date/heure) et boutons Emoji / GIF.
- Les onglets restent visibles en mode ruban simplifié.
- Hauteur du ruban constante sur tous les onglets.
- Les menus déroulants (police, taille, styles, couleurs, lien, tableau) utilisent désormais des portails React pour éviter le clipping.

#### Panneau Emojis
- Panneau latéral droit dédié (320 px), style messagerie professionnelle, ouvert depuis l'onglet Insérer.
- Champ de recherche, catégories (Smileys, Gestes, Nature, Nourriture, Voyages, Activités, Objets, Symboles) et section **Récents** persistée localement.
- Insertion à la position du curseur, sélection préservée entre plusieurs insertions.

#### Panneau GIF (GIPHY)
- Panneau latéral droit dédié, alimenté par l'API GIPHY.
- Modes **Tendances** et **Stickers**, recherche avec debounce et affichage en deux colonnes façon masonry.
- Clé API GIPHY configurable via la variable d'environnement `VITE_GIPHY_API_KEY` (build) ou saisissable directement dans le panneau (stockage local `giphyApiKey`).
- Insertion du GIF sous forme d'`<img>` à la position du curseur.

### Corrigé

#### Build Docker cassé — `CalendarPage.tsx` corrompu
- **Fusion ratée dans [client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)** faisant échouer `npm run build` (et donc `docker compose build` : `exit code: 1` sur l'étape `cd client && npm run build`). Trois zones étaient endommagées :
  1. Déclaration de `WeekView` dupliquée trois fois avec deux lignes tronquées.
  2. Signature de `TimeGridView` mélangée (`onEventContextM` / `onSlotClick: (d: Date) => void;ev: Calendaenu: …`) rendant le type de props invalide.
  3. Bouton d'événement de `renderEvent` avec un `onContextMenu` dupliqué fusionné dans l'attribut `className`, guillemet orphelin cassant tout le JSX suivant (≈ 28 erreurs TS1005/TS1109/TS2657/TS1128).
- **Correctif** : restauration de la version saine de ces trois blocs tout en conservant l'intention du commit `feat(calendar): ajouter la gestion des événements contextuels dans TimeGridView` — le bouton d'événement conserve `onClick` **et** `onContextMenu={(clickEvt) => onEventContextMenu(clickEvt, ev)}` pour propager le clic droit au menu contextuel.

## [1.0.0] - 2026-04-20

### Ajouté

#### Messagerie
- Interface trois panneaux style messagerie professionnelle (dossiers, liste, lecture)
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

#### Interface Block Layout (style messagerie professionnelle)
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
- **Éditeur de texte riche style messagerie professionnelle** :
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
- Import/export de contacts (vCard, CSV)
- Règles de filtrage automatique des emails
- Support S/MIME et PGP
- Vue conversation (groupement par thread)
- Recherche avancée avec filtres
- Support multi-langue complet (i18n)
- Sauvegarde et restauration de la configuration
