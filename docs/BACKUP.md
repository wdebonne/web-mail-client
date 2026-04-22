# Sauvegarde & restauration de la configuration locale

WebMail stocke une partie de la configuration utilisateur **directement dans le
navigateur** (`localStorage`), indépendamment du serveur : signatures, catégories,
renommage et ordre des boîtes mail, favoris, vues, thème, etc. Ces données ne
sont **jamais** envoyées au serveur et peuvent être perdues si le cache du
navigateur est vidé, si vous changez d'appareil ou si vous utilisez la fenêtre
privée. Cette page décrit le système de sauvegarde & restauration intégré qui
permet de les protéger.

Accès : **Paramètres → Sauvegarde** (icône disque dur dans la barre latérale).

## Table des matières

- [Ce qui est sauvegardé](#ce-qui-est-sauvegardé)
- [Ce qui n'est PAS sauvegardé](#ce-qui-nest-pas-sauvegardé)
- [Sauvegarde manuelle](#sauvegarde-manuelle)
- [Sauvegarde automatique](#sauvegarde-automatique)
  - [Navigateurs compatibles](#navigateurs-compatibles)
  - [Choix du dossier](#choix-du-dossier)
  - [Nom de fichier personnalisé](#nom-de-fichier-personnalisé)
  - [Déclencheurs](#déclencheurs)
- [Restauration](#restauration)
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
| Confirmations | `mail.deleteConfirm` |
| Notifications (préférences locales) | `notifications.sound`, `notifications.calendar` |
| Divers | `emoji.recent` |

## Ce qui n'est PAS sauvegardé

- **Les e-mails** eux-mêmes : ils restent sur le serveur IMAP et sont toujours
  resynchronisés. Une sauvegarde IMAP complète est à faire via un outil
  externe (Thunderbird, `imapsync`, Duplicati + rclone sur maildir, etc.).
- **Les identifiants de connexion** : le token JWT (`auth_token`) et la session
  serveur sont volontairement exclus.
- **Les clés privées S/MIME / PGP** : elles sont stockées chiffrées en
  IndexedDB et ont leur propre mécanisme d'import/export depuis la page
  **Sécurité**.
- **Les abonnements push et le handle du dossier de sauvegarde** : stockés en
  IndexedDB, spécifiques à l'appareil.
- **Les réglages administrateur serveur** (`admin_settings`) : ils sont gérés
  côté base de données et sauvegardés avec le dump PostgreSQL.

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
