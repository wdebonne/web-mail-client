# Intégration NextCloud

Guide de configuration et d'utilisation de l'intégration NextCloud dans WebMail.

> **Version 2** — Provisioning automatique, création de calendriers/contacts côté NextCloud,
> partage interne/externe, lien public, invitations iMIP, synchronisation bidirectionnelle.

## Vue d'ensemble

L'intégration NextCloud est **optionnelle**. Quand elle est activée, elle permet à WebMail de :

- **Provisionner** automatiquement un compte NextCloud pour chaque utilisateur créé
- **Créer automatiquement** les calendriers et contacts directement sur NextCloud
- **Partager** les calendriers (interne NC, invitation email, lien public lecture seule)
- Envoyer automatiquement les **invitations iMIP** aux participants (via NextCloud)
- Synchroniser **bidirectionnellement** calendriers et contacts (polling + à la demande)
- Récupérer les photos de profil NextCloud

---

## Prérequis

- Instance NextCloud fonctionnelle (v24+ recommandé pour le partage calendrier)
- Compte **admin** NextCloud dédié avec un **App Password** (Paramètres → Sécurité → Mots de passe d'application)
- Accès réseau entre le serveur WebMail et l'URL NextCloud (HTTPS recommandé)

---

## Configuration (interface admin)

Toute la configuration se fait désormais dans l'espace admin de WebMail :
**Paramètres administrateur → NextCloud**.

### Onglet « Configuration »

| Champ | Description |
|-------|-------------|
| Activer l'intégration | Active globalement l'intégration |
| URL NextCloud | URL publique de l'instance (sans `/index.php`, ex: `https://cloud.example.com`) |
| Identifiant admin | Compte avec droits d'administration NC |
| Mot de passe admin / App password | **Chiffré au repos** avec `ENCRYPTION_KEY`. Utiliser un App Password dédié. |
| Provisionner automatiquement | À la création d'un utilisateur WebMail, crée aussi un compte NC |
| Créer les calendriers sur NextCloud | Les nouveaux calendriers sont MKCALENDAR'és sur NC |
| Intervalle de synchronisation | Minimum 5 min. Sync périodique côté serveur |

Le mot de passe saisi n'est jamais renvoyé au navigateur. Pour le conserver sans le modifier,
laissez le champ vide lors d'un enregistrement ultérieur.

### Onglet « Utilisateurs provisionnés »

Liste tous les utilisateurs WebMail avec leur statut NC :

- **Non provisionné** → boutons *Provisionner* (crée un compte NC avec mot de passe généré aléatoirement) ou *Lier existant* (utiliser un App Password NC existant)
- **Lié** → *Sync* (déclenche une synchro immédiate), *Délier* (supprime le mapping, conserve le compte NC)
- Les erreurs de synchronisation sont affichées sous chaque utilisateur

---

## Comment ça marche

### Provisionning

Deux modes sont disponibles :

1. **Automatique** : à l'activation de *Provisionner automatiquement*, chaque `POST /admin/users` déclenche
   l'appel OCS `POST /ocs/v2.php/cloud/users`. Un mot de passe aléatoire (`crypto.randomBytes(24).base64url`) est généré,
   stocké chiffré dans la table `nextcloud_users` (`nc_password_encrypted`).
2. **Manuel** : l'admin provisionne ou lie les comptes NC depuis l'interface. Utile pour des comptes NC préexistants.

> Le nom d'utilisateur NC est dérivé de la partie locale de l'email (alphanumérique + `._-`, tronqué à 64 car.).
> Si ce nom est déjà pris côté NC, l'auto-provisionning s'arrête proprement et laisse l'admin lier manuellement.

### Création de calendriers

À la création d'un calendrier via `POST /calendar` (sans `mailAccountId`) :

1. Si l'utilisateur est provisionné **et** l'option *Créer les calendriers sur NextCloud* est active :
   - Un `MKCALENDAR` est exécuté sur `/remote.php/dav/calendars/<ncUsername>/<slug>/`
   - Le calendrier est enregistré en DB avec `nc_managed = true` et `caldav_url` pointant sur NC
2. Sinon : calendrier purement local

> La modale « Nouveau calendrier » côté client ne demande **plus** de choisir entre *Local* et *Boîte mail*.
> Elle affiche simplement la destination détectée automatiquement (Nextcloud si l'utilisateur est lié
> et que l'option est active, Local sinon). Le front n'envoie plus de `mailAccountId` pour éviter de
> tenter un MKCALENDAR sur des serveurs CalDAV qui ne le supportent pas (ex : cPanel/o2switch,
> limité à un seul calendrier par compte).
>
> Le statut NC par utilisateur est exposé via `GET /calendar/nextcloud-status` →
> `{ enabled, linked, ncUsername, ncEmail, autoCreateCalendars }`.

### Événements et iMIP

Tous les événements créés/modifiés sur un calendrier `nc_managed` sont pushés via PUT vers NextCloud.
Si l'ICS contient des `ATTENDEE`, **NextCloud envoie automatiquement les invitations iMIP** aux participants
(y compris les adresses externes au domaine NC). Aucune configuration supplémentaire n'est requise.

### Partage de calendrier

Un nouvel endpoint `POST /calendar/:id/share` accepte trois modes :

| Payload | Résultat |
|---------|----------|
| `{ userId: "<app-user>", permission: "read"\|"write" }` | Partage interne. Si le destinataire est aussi provisionné NC, un partage NC-natif est fait via `<CS:share>` entre principals |
| `{ email: "user@ext.com", permission: ... }` | Invitation NC par email (NC envoie automatiquement le mail d'invitation) |
| `POST /calendar/:id/publish` | Lien public en lecture seule (via `<CS:publish-calendar>` + PROPFIND de `<CS:publish-url>`) |

Endpoints de gestion :
- `GET /calendar/:id/shares` → liste les partages (internes + externes)
- `DELETE /calendar/:id/share` → révoque un partage (body `{ userId }` ou `{ email }`)
- `DELETE /calendar/:id/publish` → supprime le lien public

L'interface est disponible via le dialog « Partager » depuis la sidebar du calendrier.

### Contacts

Quand un utilisateur est provisionné et qu'il n'a **pas** de compte CardDAV attaché à une boîte mail,
les nouveaux contacts sont automatiquement stockés dans le carnet d'adresses NC par défaut
(`/remote.php/dav/addressbooks/users/<ncUsername>/contacts/`).

La vue « NextCloud » dans la page Contacts filtre sur `nc_managed = true`.

### Synchronisation

- Sync **périodique** : service `nextcloudSyncPoller` lancé au démarrage du serveur,
  intervalle configurable (min. 5 min, défaut 15 min)
- Sync **à la demande** : bouton *Sync* depuis l'admin, endpoint `POST /admin/nextcloud/users/:userId/sync`

---

## Sécurité

- Tous les mots de passe NC (admin **et** par utilisateur) sont chiffrés avec `encrypt()` (AES-256-GCM)
  via la clé `ENCRYPTION_KEY` définie dans l'environnement serveur.
- Les mots de passe ne sont **jamais** renvoyés au navigateur (`GET /admin/nextcloud/status` omet volontairement le champ).
- Préférez toujours un **App Password** plutôt que le vrai mot de passe admin.
- En cas de rotation de la clé `ENCRYPTION_KEY`, toutes les credentials NC stockées deviendront illisibles
  et devront être re-saisies.

---

## Schéma de base de données

Tables ajoutées :

- `nextcloud_users` — mapping `user_id` ↔ `nc_username` + mot de passe chiffré + statut de sync
- `external_calendar_shares` — invitations par email + liens publics
- Colonnes ajoutées à `calendars` : `nc_managed`, `nc_principal_url`, `last_sync_at`
- Colonnes ajoutées à `contacts` : `nc_managed`, `nc_addressbook_url`, `nc_etag`, `nc_uri`
- Colonnes ajoutées à `calendar_events` : `nc_etag`, `nc_uri`
- Colonnes ajoutées à `shared_calendar_access` : `nextcloud_share_id`, `created_at`

---

## Dépannage

| Symptôme | Cause probable |
|----------|----------------|
| « Configuration NextCloud incomplète » | URL, username ou app password manquant / incorrect |
| « NC user already exists; skipping auto-provision » | Le compte NC existe déjà → utiliser *Lier existant* |
| Sync en erreur « 401 » | App Password révoqué ou changé → re-saisir le mot de passe de l'utilisateur |
| Aucune invitation iMIP reçue | Vérifier que l'app NextCloud « DAV » est active et que le SMTP NC est configuré |
| Lien public vide | L'app « calendar » NextCloud doit être activée pour que `<CS:publish-calendar>` fonctionne |
| « there is no unique or exclusion constraint matching the ON CONFLICT specification » (code `42P10`) sur `NextCloudService.syncCalendars` / `syncContacts` | Les index uniques partiels `idx_contacts_nc_email_unique`, `idx_contacts_nc_external_unique` et `idx_calendars_nc_external_unique` sont manquants ou ont un prédicat plus strict que la clause `WHERE source='nextcloud'` des requêtes. Redémarrer le serveur : la migration force un `DROP INDEX IF EXISTS` puis recrée les index avec le bon prédicat. Si la recréation échoue, c'est qu'il existe des doublons en base — les supprimer puis relancer. |

Logs utiles côté serveur : `grep -i "NC" logs/*.log` (tags : `NextCloud`, `nextcloud`, `NC sync`).
