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
- **Enregistrer les pièces jointes** des mails dans le drive Files de l'utilisateur, dans n'importe quel dossier (avec création d'arborescence à la volée)

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

Le dialog « Partager » propose **3 onglets** (voir [client/src/components/calendar/ShareCalendarDialog.tsx](../client/src/components/calendar/ShareCalendarDialog.tsx)) :

1. **Au sein de votre organisation** — annuaire interne (utilisateurs de l'app + comptes NC liés) exposé par `GET /api/contacts/directory/users`. Ajoute un partage interne NC-natif via `<CS:share>` quand les deux parties sont provisionnées.
2. **Invitations par email** — autocomplétion sur tous les contacts (locaux + NC). Une adresse inconnue est **auto-créée** comme contact local en plus d'être invitée. NextCloud envoie l'email d'invitation si `nc_managed`.
3. **Lien public** — génère un lien **HTML autonome** + un **flux iCal (.ics)** servis par l'application elle-même (`/api/public/calendar/:token[.ics]`), avec filtrage par permission. Fonctionne pour les calendriers locaux **et** NextCloud.

**Permissions granulaires** (persistées en base, mappées vers NC) :

| Niveau | Description | NC mapping |
|--------|-------------|------------|
| `busy` | Disponibilités uniquement | `read` (filtré côté app) |
| `titles` | Titres et lieux | `read` (filtré côté app) |
| `read` | Tous les détails | `read` |
| `write` | Lecture + écriture | `read-write` |

Endpoints :

| Méthode | URL | Description |
|---------|-----|-------------|
| `POST` | `/api/calendar/:id/share` | Ajouter/mettre à jour un partage (body `{ userId?, email?, permission }`) |
| `DELETE` | `/api/calendar/:id/share` | Révoquer un partage (body `{ userId }` ou `{ email }`) |
| `GET` | `/api/calendar/:id/shares` | Liste (internal + external, avec `public_html_url` / `public_ics_url`) |
| `POST` | `/api/calendar/:id/publish` | Publier / republier (body `{ permission: "busy"\|"titles"\|"read" }`) |
| `PATCH` | `/api/calendar/:id/publish` | Modifier la permission d'un lien déjà publié |
| `DELETE` | `/api/calendar/:id/publish` | Supprimer le lien public |
| `GET` | `/api/public/calendar/:token` | Viewer HTML (sans auth) |
| `GET` | `/api/public/calendar/:token.ics` | Flux iCalendar RFC 5545 (sans auth) |
| `GET` | `/api/public/calendar/:token.json` | Flux JSON (sans auth) |

> ℹ️ Auparavant `POST /publish` renvoyait l'URL `<CS:publish-url>` de NextCloud, qui conduisait à l'interface WebDAV *(« This is the WebDAV interface… »)*. Le lien est désormais servi par l'application sous forme de page HTML et de flux `.ics` directement consommables par Outlook, Apple Calendar, Google Calendar et Thunderbird.

### Contacts

Quand un utilisateur est provisionné et qu'il n'a **pas** de compte CardDAV attaché à une boîte mail,
les nouveaux contacts sont automatiquement stockés dans le carnet d'adresses NC par défaut
(`/remote.php/dav/addressbooks/users/<ncUsername>/contacts/`).

La vue « NextCloud » dans la page Contacts filtre sur `nc_managed = true`.

### Synchronisation

- Sync **périodique** : service `nextcloudSyncPoller` lancé au démarrage du serveur,
  intervalle configurable (min. 5 min, défaut 15 min)
- Sync **à la demande** : bouton *Sync* depuis l'admin, endpoint `POST /admin/nextcloud/users/:userId/sync`
- Sync **depuis l'agenda** : bouton *Synchroniser* de la page Agenda → `POST /calendar/sync` effectue la sync CalDAV des comptes mail **puis** appelle `nc.syncCalendars()` + `nc.syncContacts()` pour l'utilisateur courant. `last_sync_at` / `last_sync_error` sont mis à jour dans `nextcloud_users`. Réponse : `{ synced, results, nextcloud: { ok, error? } }`.
- Sync **immédiate au déplacement** : lorsqu'un événement d'un calendrier `nc_managed` est déplacé (drag & drop) ou modifié via l'UI, `PUT /events/:id` déclenche `pushEventToCalDAV()` qui pousse directement l'ICS mis à jour vers NextCloud via `PUT` + `If-Match` sur `nc_etag`.

### Migration d'un calendrier Local ↔ NextCloud

Depuis la sidebar de l'agenda, le menu contextuel d'un calendrier propose :

- **Migrer vers NextCloud** (calendriers locaux, quand l'utilisateur est lié à NC) → `POST /calendar/:id/migrate` avec `{ target: 'nextcloud' }` :
  1. Crée le calendrier sur NC (`MKCALENDAR`)
  2. PUT de tous les événements existants (réutilise `ical_data` ou reconstruit l'ICS)
  3. Bascule `source='nextcloud'`, `nc_managed=true`, renseigne `caldav_url` et `external_id`
- **Migrer en local** (calendriers `source='nextcloud'`) → `POST /calendar/:id/migrate` avec `{ target: 'local', deleteRemote?: boolean }` :
  1. Si `deleteRemote=true`, supprime le calendrier côté NC
  2. Efface `nc_managed`, `caldav_url`, `external_id` — le calendrier devient strictement local

Une modale de confirmation liste les gains et pertes de chaque direction (partage, iMIP, accès mobile, etc.).

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
