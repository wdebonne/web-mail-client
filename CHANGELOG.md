# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versioning Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

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

#### Titre d'onglet dynamique — style Outlook
- **Titre contextuel dans l'onglet du navigateur** (`client/src/pages/MailPage.tsx`, `client/src/App.tsx`) : l'onglet du navigateur affiche désormais `<Nom du dossier> — <Nom de l'application>` (par exemple *Boîte de réception — WebMail*, *Éléments supprimés — WebMail*), comme Outlook Web. Hors de la section mail, seul le nom de l'application est affiché.
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

#### Signatures multiples — gestion complète style Outlook Web

- **Signatures multiples par utilisateur** : création, édition, suppression et nommage de plusieurs signatures HTML depuis l'onglet **Insérer → Signature** du ruban de rédaction (`client/src/components/mail/Ribbon.tsx`). Un menu déroulant liste toutes les signatures enregistrées pour les insérer d'un clic dans le corps du message, et un lien **Signatures…** ouvre la gestion complète.
- **Modale de gestion** (`client/src/components/mail/SignatureModals.tsx` → `SignaturesManagerModal`) : liste des signatures existantes avec actions *Modifier*, *Supprimer* et menu **…** pour définir rapidement la signature par défaut ; deux sélecteurs pour la **valeur par défaut des nouveaux messages** et pour la **valeur par défaut des réponses et transferts** ; bouton **+ Ajouter une signature**.
- **Éditeur WYSIWYG dédié** (`SignatureEditorModal`) avec deux onglets *Mettre le texte en forme* / *Insérer* : gras, italique, souligné, barré, palette de couleurs, listes à puces et numérotées, alignements, insertion de liens et d'images. Cases à cocher *Définir les valeurs par défaut des nouveaux messages* et *Définir la valeur par défaut des réponses et des transferts* pour basculer les défauts directement depuis l'édition.
- **Insertion automatique dans le compose** (`client/src/components/mail/ComposeModal.tsx`) : à l'ouverture d'un nouveau message, la signature « nouveaux messages » est insérée sous le corps vide ; pour une réponse ou un transfert, la signature « réponses/transferts » est insérée **avant** la citation d'origine, comme Outlook Web.
- **Persistance locale** (`client/src/utils/signatures.ts`) : stockage dans `localStorage` (`mail.signatures.v1`, `mail.signatures.defaultNew`, `mail.signatures.defaultReply`) avec événement `mail.signatures.changed` pour synchroniser toutes les vues (ruban, modales) en temps réel. Les signatures et leurs valeurs par défaut restent 100 % côté client et ne transitent jamais par le serveur.
- **Bloc signature isolé** : chaque signature insérée est enveloppée dans un `<div class="outlook-signature" data-signature="true">` précédé d'un saut de ligne, pour faciliter un repérage / remplacement futur et préserver le formatage d'origine.

### Corrigé

#### Build Docker — compilation TypeScript du client
- **Échec de `npm run build` dans le Dockerfile** (`compose build operation failed … exit code: 1`) : le type du paramètre de `upsertSignature` (`client/src/utils/signatures.ts`) combinait `Omit<MailSignature, 'updatedAt'>` avec `& { id?: string }`, mais une intersection TypeScript **ne rend pas une propriété déjà requise optionnelle** — `id` restait donc obligatoire et `SignatureEditorModal.save()` échouait avec `TS2322: Type 'string | undefined' is not assignable to type 'string'` lors de la création d'une nouvelle signature (`signature?.id` vaut `undefined`). Le type a été remplacé par un littéral explicite `{ id?: string; name: string; html: string }`, ce qui débloque le build Docker et la compilation locale.

### Amélioré

#### Mode sombre — lisibilité du corps des e-mails HTML
- **Rendu des e-mails sur surface claire en mode sombre** : beaucoup d'e-mails HTML embarquent des couleurs codées en dur via des styles inline (texte noir sur fond blanc, citations grises, signatures colorées…) qui restaient superposées au fond sombre de l'application et devenaient illisibles — certains blocs apparaissaient en noir sur gris foncé, d'autres en blanc sur blanc selon la façon dont l'expéditeur avait mis en forme le message. Le conteneur `.email-body` est désormais rendu sur un fond blanc dédié avec un padding et un `border-radius`, et `color-scheme: light` est forcé sur l'arbre HTML du message afin que les contrôles de formulaire et les citations restent cohérents (`client/src/index.css`). Cette approche est celle utilisée par Gmail et Outlook Web : le reste de l'interface (en-tête, barre de conversation, boutons *Répondre / Transférer*) conserve le thème sombre, seul le corps HTML est isolé sur sa propre surface pour préserver les couleurs d'origine conçues par l'expéditeur.
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

#### Regroupement des conversations (style Outlook)
- Nouveau menu **Conversations** dans l'onglet **Afficher** du ruban (icône bulle de dialogue, modes classique et simplifié), avec deux sections calquées sur Outlook :
  - **Liste de messages** : `Regrouper les messages par conversation` · `Regrouper les messages par branches dans les conversations` · `Ne pas regrouper les messages`.
  - **Volet de lecture → Organisation des messages** : `Afficher tous les messages de la conversation sélectionnée` · `Afficher uniquement le message sélectionné`.
- **Regroupement en arborescence dans la liste** : lorsqu'un mode « Regrouper » est actif, chaque conversation est condensée en une seule ligne « racine » portant l'objet + un compteur de messages. Un **chevron** à gauche permet de déplier la conversation pour afficher les messages descendants indentés sous le parent.
- **Badge de dossier d'origine** : en vue unifiée (multi-boîtes), chaque message enfant d'une conversation porte un petit badge indiquant son dossier (ex. `Éléments envoyés`), pour distinguer les mails reçus et ceux envoyés au sein du même fil.
- **Volet de lecture thread-aware** : en mode « Afficher tous les messages de la conversation », le volet de lecture restitue l'empilement complet du fil (messages empilés, seul le plus récent déplié, en-têtes cliquables). En mode « Afficher uniquement le message sélectionné », il revient à l'affichage d'un seul message.
- **Persistance** : `conversationGrouping` (`none` / `conversation` / `branches`) et `conversationShowAllInReadingPane` sont mémorisés dans `localStorage` et restaurés au prochain chargement.

### Ajouté (hors sécurité)

#### Catégories de messages (style Outlook)
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
- Palette Outlook entièrement basée sur des variables CSS (`--outlook-*` au format RGB) permettant les opacités Tailwind (`/30`, `/50`, etc.) dans les deux modes.

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
- Import/export de contacts (vCard, CSV)
- Règles de filtrage automatique des emails
- Support S/MIME et PGP
- Vue conversation (groupement par thread)
- Recherche avancée avec filtres
- Support multi-langue complet (i18n)
- Sauvegarde et restauration de la configuration
