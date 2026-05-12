# Sauvegarde & restauration

WebMail propose **deux systèmes de sauvegarde complémentaires** :

| | Sauvegarde serveur (base de données) | Sauvegarde locale (navigateur) |
|---|---|---|
| **Accès** | Admin → Système → Sauvegarde | Paramètres → Sauvegarde |
| **Contenu** | Toute la base de données (utilisateurs, comptes, paramètres…) | Configuration locale du navigateur (signatures, thème, préférences…) |
| **Format** | `.json.gz` (JSON compressé) | `.json` |
| **Usage** | Migration serveur, reprise après incident | Changement de navigateur ou de PC |

---

## Sauvegarde serveur (Admin → Système → Sauvegarde)

Cette fonctionnalité permet de **sauvegarder et restaurer l'intégralité de l'application** :
utilisateurs, mots de passe, comptes mail IMAP/SMTP, paramètres administrateur, contacts,
calendriers, règles, modèles, plugins, listes de distribution, sécurité IP, passkeys WebAuthn.

> **Important :** Pour que les mots de passe de comptes mail chiffrés soient déchiffrables
> après restauration, la variable `ENCRYPTION_KEY` du fichier `.env` doit être identique sur
> les deux serveurs.

### Contenu de la sauvegarde

Les tables suivantes sont incluses dans le fichier `.json.gz` :

| Catégorie | Tables |
|---|---|
| Utilisateurs | `users`, `groups`, `user_groups`, `user_preferences`, `webauthn_credentials` |
| Comptes mail | `mail_accounts`, `mailbox_assignments`, `shared_mailbox_access` |
| Contacts | `contacts`, `contact_groups`, `contact_group_members`, `distribution_lists` |
| Calendriers | `calendars`, `calendar_events`, `shared_calendar_access`, `external_calendar_shares` |
| Messagerie | `auto_responders`, `mail_templates`, `mail_template_shares`, `mail_rules` |
| Intégrations | `nextcloud_users`, `o2switch_accounts`, `o2switch_email_links` |
| Plugins | `plugins`, `plugin_assignments` |
| Système | `admin_settings`, `ip_security_list`, `log_alert_rules`, `system_email_templates` |

**Non inclus** (données transitoires ou resynchronisables) :
- `cached_emails` — resynchronisé depuis les serveurs IMAP
- `sessions`, `device_sessions` — les utilisateurs se reconnecteront après restauration
- `login_attempts`, `password_resets` — données éphémères de sécurité
- `outbox` — mails en attente d'envoi

### Sauvegarde manuelle

1. Aller dans **Admin → Système → Sauvegarde**.
2. Renseigner un label (optionnel).
3. Cliquer sur **Créer la sauvegarde**.
4. Le fichier `.json.gz` apparaît dans la liste avec sa date, sa taille et son type.

### Sauvegarde automatique planifiée

Configurable dans la section **Sauvegarde automatique** :

| Paramètre | Description |
|---|---|
| Activer | Toggle on/off |
| Fréquence | Quotidienne, hebdomadaire, mensuelle |
| Heure (UTC) | Heure d'exécution (ex. `02:00`) |
| Jour | Jour de la semaine (hebdo) ou du mois (mensuel) |

Le planificateur démarre avec le serveur et vérifie chaque minute si une sauvegarde est due.
Un mécanisme anti-doublon empêche deux exécutions dans la même fenêtre de temps.

### Rétention intelligente

La politique de rétention s'applique aux **sauvegardes automatiques** uniquement
(les sauvegardes manuelles ne sont jamais supprimées automatiquement).

| Règle | Description par défaut |
|---|---|
| Dernières N | Garder les 7 dernières sauvegardes |
| 1 par semaine | Sur les 4 dernières semaines |
| 1 par mois | Sur les 12 derniers mois |
| 1 par an | Sur les 3 dernières années |

Les règles sont **cumulatives** : une sauvegarde peut satisfaire plusieurs critères
(ex. la première sauvegarde du mois compte aussi pour le quota mensuel et annuel).

### Télécharger une sauvegarde

Cliquer sur l'icône **↓** dans la liste. Le fichier `.json.gz` est téléchargé directement
depuis le serveur (authentification requise).

### Supprimer une sauvegarde

Cliquer sur l'icône **🗑** — une confirmation est demandée avant suppression définitive
du fichier sur le disque et de l'entrée en base de données.

### Restauration

> ⚠️ **Action destructive** : toutes les données actuelles de la base sont remplacées.
> Effectuez une sauvegarde préalable si nécessaire.

1. Aller dans **Admin → Système → Sauvegarde → section Restaurer depuis un fichier**.
2. Cliquer sur **Choisir un fichier .json.gz…** et sélectionner votre sauvegarde.
3. La modale de confirmation s'affiche.
4. **(Migration vers un autre serveur)** Renseigner les champs **URL source** et **URL cible** :
   - **URL source** — l'URL du serveur d'origine (ex. `https://mail.mondomaine.fr`)
   - **URL cible** — l'URL de ce serveur (ex. `https://mail.autre-serveur.fr`)
   - Tous les paramètres admin contenant l'ancienne URL sont remplacés automatiquement
     (`public_url`, WebAuthn RP ID, redirections OAuth…).
   - Si le **hostname change**, les passkeys (WebAuthn) sont **supprimées automatiquement**
     car elles sont liées au domaine d'origine et bloqueraient la connexion. Les utilisateurs
     peuvent se reconnecter avec leur mot de passe et enregistrer une nouvelle passkey.
5. Cliquer sur **Restaurer quand même**.
6. La restauration s'effectue dans une transaction — en cas d'erreur, aucune donnée n'est
   partiellement écrite.
7. Tous les utilisateurs sont déconnectés ; reconnectez-vous pour vérifier le résultat.

### Emplacement des fichiers sur le serveur

Les sauvegardes sont stockées dans le répertoire `server/backups/` du conteneur.
Pour les persister entre les redémarrements Docker, montez ce dossier en volume :

```yaml
# docker-compose.yml
volumes:
  - ./backups:/app/backups
```

---

## Sauvegarde locale (Paramètres → Sauvegarde)

WebMail stocke une partie de la configuration utilisateur **directement dans le
navigateur** (`localStorage`), indépendamment du serveur : signatures, catégories,
renommage et ordre des boîtes mail, favoris, vues, thème, etc. Ces données ne
sont **jamais** envoyées au serveur et peuvent être perdues si le cache du
navigateur est vidé, si vous changez d'appareil ou si vous utilisez la fenêtre
privée. Cette page décrit le système de sauvegarde & restauration intégré qui
permet de les protéger.

Accès : **Paramètres → Sauvegarde** (icône disque dur dans la barre latérale).

## Table des matières

### Sauvegarde serveur (base de données)
- [Contenu de la sauvegarde](#contenu-de-la-sauvegarde)
- [Sauvegarde manuelle](#sauvegarde-manuelle)
- [Sauvegarde automatique planifiée](#sauvegarde-automatique-planifiée)
- [Rétention intelligente](#rétention-intelligente)
- [Restauration](#restauration)
- [Emplacement des fichiers sur le serveur](#emplacement-des-fichiers-sur-le-serveur)

### Sauvegarde locale (navigateur)
- [Ce qui est sauvegardé](#ce-qui-est-sauvegardé)
- [Ce qui n'est PAS sauvegardé](#ce-qui-nest-pas-sauvegardé)
- [Sauvegarde manuelle (locale)](#sauvegarde-manuelle-1)
- [Sauvegarde automatique (locale)](#sauvegarde-automatique)
  - [Navigateurs compatibles](#navigateurs-compatibles)
  - [Choix du dossier](#choix-du-dossier)
  - [Nom de fichier personnalisé](#nom-de-fichier-personnalisé)
  - [Déclencheurs](#déclencheurs)
- [Restauration (locale)](#restauration-1)
- [Format du fichier](#format-du-fichier)
- [Intégration avec Duplicati / autres outils de backup](#intégration-avec-duplicati--autres-outils-de-backup)
- [Dépannage](#dépannage)

---

## Ce qui est sauvegardé

Toutes les clés `localStorage` listées ci-dessous sont incluses. Elles sont
définies dans la whitelist `BACKUP_KEYS` de
[`client/src/utils/backup.ts`](../client/src/utils/backup.ts).

| Domaine | Clés |
|---|---|
| Thème | `theme.mode` |
| Signatures | `mail.signatures.v1`, `mail.signatures.defaultNew`, `mail.signatures.defaultReply` |
| Catégories | `mail.categories`, `mail.messageCategories` |
| Comptes & dossiers | `mail.accountDisplayNames`, `mail.accountOrder`, `mail.folderOrder`, `mail.expandedAccounts`, `mail.favoriteFolders`, `mail.favoritesExpanded` |
| Vues unifiées | `mail.unifiedAccounts`, `mail.unifiedInboxEnabled`, `mail.unifiedSentEnabled` |
| Mise en page | `readingPaneMode`, `listDensity`, `listDisplayMode`, `listHeight`, `mailListWidth`, `folderPaneWidth` |
| Conversations | `conversationView`, `conversationGrouping`, `conversationShowAllInReadingPane` |
| Vue côte à côte | `splitRatio`, `splitKeepFolderPane`, `splitKeepMessageList`, `splitComposeReply` |
| Ruban | `ribbonCollapsed`, `ribbonMode` |
| Onglets | `tabMode`, `maxTabs` |
| Confirmations | `mail.deleteConfirmEnabled` |
| Notifications (préférences locales) | `notifications.sound`, `notifications.calendar` |
| GIFs | `giphyApiKey` (clé API GIPHY personnelle, si saisie) |
| Divers | `emoji-panel-recent` (emojis récemment utilisés) |

## Ce qui n'est PAS sauvegardé

- **Les e-mails** eux-mêmes : ils restent sur le serveur IMAP et sont toujours
  resynchronisés. Une sauvegarde IMAP complète est à faire via un outil
  externe (Thunderbird, `imapsync`, Duplicati + rclone sur maildir, etc.).
- **Les contacts, calendriers, listes de distribution** : ils sont **stockés
  côté serveur** (PostgreSQL + optionnellement synchronisés avec NextCloud via
  CardDAV/CalDAV). Ils sont donc couverts par la sauvegarde serveur (dump
  PostgreSQL) et ne font pas partie du `.json`. Le cache IndexedDB offline
  (`webmail-offline`) est juste une copie locale qui se reconstruit
  automatiquement à la prochaine connexion.
- **Les images insérées dans les signatures** : bonne nouvelle — elles **sont**
  dans la sauvegarde ! Le ruban et l'éditeur de signature embarquent les
  images en **data URI** (base64) directement dans le HTML, lui-même stocké
  dans `mail.signatures.v1`. Elles sont donc incluses tel quel dans le
  fichier, sans fichier binaire externe à gérer.
- **Les identifiants de connexion** : le token JWT (`auth_token`) et la session
  serveur sont volontairement exclus.
- **Les clés privées S/MIME / PGP** : stockées chiffrées (AES-GCM + PBKDF2)
  dans l'IndexedDB `webmail-security/keys`. Elles ne sont **pas** incluses
  dans le `.json` de sauvegarde pour éviter qu'un fichier mal rangé ne
  contienne du matériel cryptographique sensible, même chiffré. Elles
  disposent de leur **propre mécanisme d'import/export** depuis la page
  **Sécurité** (onglets *Exporter la clé publique* / *Exporter la clé privée*
  protégés par la passphrase).
- **Les abonnements Web Push, les brouillons hors-ligne non envoyés et le
  handle du dossier de sauvegarde** : stockés en IndexedDB, spécifiques à
  l'appareil et reconstructibles. Les brouillons validés côté serveur, eux,
  sont dans votre dossier IMAP *Brouillons* et ne se perdent pas.
- **Les réglages administrateur serveur** (`admin_settings`, branding
  personnalisé, clés VAPID, etc.) : gérés en base PostgreSQL et sauvegardés
  avec le dump serveur.

## Sauvegarde manuelle

Depuis *Paramètres → Sauvegarde → Sauvegarde manuelle* :

- **Exporter (.json)** — télécharge immédiatement un fichier horodaté
  (`web-mail-client-backup-AAAAMMJJ-HHMM.json`).
- **Restaurer depuis un fichier…** — ouvre un sélecteur de fichier, valide la
  structure, demande confirmation et remplace la configuration actuelle, puis
  recharge la page automatiquement.

## Sauvegarde automatique

### Navigateurs compatibles

La sauvegarde automatique dans un **dossier du PC** repose sur la
[File System Access API](https://developer.mozilla.org/docs/Web/API/File_System_Access_API).

| Navigateur | Windows | Linux | macOS | Mobile |
|---|---|---|---|---|
| Chrome / Chromium | ✅ | ✅ | ✅ | ❌ |
| Edge | ✅ | ✅ | ✅ | ❌ |
| Opera | ✅ | ✅ | ✅ | ❌ |
| Vivaldi / Brave (Chromium) | ✅ | ✅ | ✅ | ❌ |
| Firefox | ❌ fallback téléchargement | | | |
| Safari | ❌ fallback téléchargement | | | |

Sur les navigateurs non compatibles, l'onglet affiche un bandeau et
l'auto-backup retombe sur un **téléchargement** classique à chaque
modification (moins pratique — une sauvegarde manuelle régulière est alors
préférable).

### Choix du dossier

1. Cliquez sur **Choisir…** dans la section *Dossier de destination sur ce PC*.
2. Le navigateur ouvre un sélecteur de dossiers démarrant dans **Documents**
   (`startIn: 'documents'`).
3. Sélectionnez un dossier — par exemple :
   - `Documents\WebMail` (Windows)
   - `~/Documents/WebMail` (Linux)
4. Le navigateur demande l'autorisation d'écriture ; acceptez.
5. Le libellé du dossier s'affiche avec une coche verte.

Le handle du dossier est persisté en **IndexedDB**
(`web-mail-client-backup/handles/dir-handle`) et survit aux rechargements.
À chaque écriture, la permission est re-vérifiée silencieusement.

Vous pouvez cliquer sur **Changer…** pour sélectionner un autre dossier, ou
**Oublier** pour retirer l'autorisation.

> **Note de sécurité** : seul le dossier choisi est accessible. L'application
> n'a aucune visibilité sur le reste de votre disque.

### Nom de fichier personnalisé

Dans *Paramètres → Sauvegarde*, le champ **Nom du fichier de sauvegarde**
vous permet de définir le nom unique du fichier réécrit à chaque auto-backup.

- Le nom par défaut est `web-mail-client-backup.json`.
- L'extension `.json` est ajoutée automatiquement si vous l'omettez.
- Les caractères interdits (`\ / : * ? " < > |` et caractères de contrôle) sont
  remplacés par `_`.
- Les points et espaces finaux (interdits sous Windows) sont supprimés.

**Astuce** : donnez-lui un nom explicite pour éviter les suppressions
accidentelles :

```
Web-Mail-Client-NE-PAS-SUPPRIMER.json
```

Un nom parlant est plus sûr qu'un nom générique obscur ; prévenez les autres
utilisateurs de la machine qu'il ne faut pas y toucher.

### Déclencheurs

Une sauvegarde automatique est programmée dès qu'une **modification locale**
est détectée, puis exécutée après un debounce de **4 secondes** (pour
regrouper les rafales d'écritures).

Exemples de déclencheurs :

- Créer / renommer / supprimer une signature
- Créer / modifier / supprimer une catégorie ou l'assigner à un message
- Renommer une boîte mail ou réordonner comptes / dossiers
- Épingler ou déplier un dossier favori
- Changer de thème, de densité, de mode de ruban, de vue côte à côte
- Modifier une préférence de notification locale
- Toute écriture par un autre onglet (via l'événement `storage`)

Une dernière tentative est effectuée au `beforeunload` de l'onglet pour ne
rien perdre avant fermeture.

Si vous changez un paramètre et que la permission d'accès au dossier a été
perdue (ex. navigateur redémarré sans interaction préalable), l'erreur est
consignée dans `backup.auto.lastError` et affichée dans l'onglet. Cliquez sur
**Sauvegarder maintenant** pour redemander la permission.

## Restauration

Depuis n'importe quel appareil ou profil navigateur :

1. Ouvrez *Paramètres → Sauvegarde*.
2. Cliquez sur **Restaurer depuis un fichier…**.
3. Sélectionnez votre `.json` de sauvegarde.
4. Confirmez la boîte de dialogue (date de la sauvegarde + nombre de clés).
5. La configuration est remplacée et la page se recharge automatiquement.

> ⚠️ La restauration **remplace** la configuration locale courante. Exportez
> d'abord l'état actuel si vous n'êtes pas sûr.

La restauration fonctionne uniquement entre versions compatibles
(`version` ≤ version de l'app). Une sauvegarde créée par une version plus
récente sera refusée avec un message explicite.

## Format du fichier

```json
{
  "app": "web-mail-client",
  "version": 1,
  "createdAt": "2026-04-22T14:03:17.812Z",
  "userAgent": "Mozilla/5.0 …",
  "data": {
    "theme.mode": "dark",
    "mail.signatures.v1": "[{\"id\":\"sig_...\",...}]",
    "mail.categories": "[{\"id\":\"cat-orange\",...}]",
    "…": "…"
  }
}
```

Toutes les valeurs de `data` sont les chaînes brutes telles que stockées dans
`localStorage` (valeurs JSON sérialisées déjà sous forme de texte). Cela rend
le format stable et facilement lisible par un humain avec un éditeur de
texte.

## Intégration avec Duplicati / autres outils de backup

Le fichier unique créé par l'auto-backup est un simple `.json` — il est donc
**repris automatiquement** par tout outil qui sauvegarde le dossier dans
lequel il se trouve.

Configuration type avec **Duplicati** :

1. Placez le fichier dans un dossier déjà inclus dans vos sauvegardes, par
   exemple `Documents\` ou `Documents\Backups\`.
2. Donnez-lui un nom explicite (`Web-Mail-Client-NE-PAS-SUPPRIMER.json`).
3. Duplicati détecte le changement d'horodatage et inclut automatiquement la
   nouvelle version dans son prochain snapshot.

Avantages :

- **Un seul fichier**, non versionné localement — c'est Duplicati (ou rsync,
  Borg, Restic, OneDrive, etc.) qui gère l'historique des versions.
- **Petite taille** (quelques Ko à centaines de Ko), transfert instantané.
- **Portable** : restaurable depuis n'importe quel navigateur compatible.

## Dépannage

| Symptôme | Cause probable | Solution |
|---|---|---|
| *Votre navigateur ne permet pas l'écriture directe dans un dossier* | Firefox/Safari ou variante non Chromium | Utilisez Chrome/Edge/Vivaldi/Opera sur PC, ou exportez manuellement. |
| « Aucun dossier accessible » dans `lastError` | Permission perdue (navigateur fermé, dossier déplacé/supprimé) | Cliquez sur **Sauvegarder maintenant** pour redemander l'autorisation, ou re-sélectionnez le dossier. |
| Aucune sauvegarde ne se déclenche | Option **Activer la sauvegarde automatique** désactivée | Activez-la dans l'onglet. |
| Le fichier ne se met pas à jour après une modif | Debounce de 4 s — attendez ou cliquez sur **Sauvegarder maintenant** | — |
| « Sauvegarde créée par une version plus récente » | Le `.json` vient d'une future version incompatible | Mettez à jour l'application avant de restaurer. |
| « Ce fichier n'est pas une sauvegarde Web Mail Client » | Mauvais fichier sélectionné (clé `app` absente/différente) | Vérifiez le fichier. |

Pour réinitialiser totalement la fonctionnalité : *Paramètres → Sauvegarde →
Oublier*, puis videz au besoin les clés `backup.*` dans les DevTools du
navigateur (`Application → Local Storage`).
