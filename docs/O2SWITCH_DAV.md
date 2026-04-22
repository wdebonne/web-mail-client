# Synchronisation o2switch (CalDAV & CardDAV)

Cette page décrit la synchronisation **automatique** des calendriers (CalDAV) et des carnets d'adresses (CardDAV) avec une boîte mail hébergée chez **o2switch** (cPanel + SabreDAV). Les événements du calendrier et les contacts créés dans WebMail sont alors **également visibles dans RoundCube** (webmail natif d'o2switch) et dans n'importe quel client CalDAV/CardDAV compatible (Thunderbird, Apple Calendar, DAVx⁵, etc.).

## URLs par défaut

Pour une boîte `testmail@villepavilly.fr` hébergée sur o2switch :

| Service | URL |
|---|---|
| CalDAV | `https://colorant.o2switch.net:2080/calendars/testmail@villepavilly.fr/calendar` |
| CardDAV | `https://colorant.o2switch.net:2080/addressbooks/testmail@villepavilly.fr/addressbook` |

- Le port **2080** est le port HTTPS de l'interface SabreDAV d'o2switch.
- L'**identifiant** est l'adresse mail complète.
- Le **mot de passe** est celui de la boîte mail (IMAP/SMTP), aucun mot de passe spécifique n'est nécessaire.

## Activation automatique

Deux chemins activent la synchronisation :

### 1. Création d'un compte mail (utilisateur)

`POST /api/accounts` accepte le flag `o2switchAutoSync` :

```json
{
  "name": "Mairie",
  "email": "testmail@villepavilly.fr",
  "username": "testmail@villepavilly.fr",
  "password": "••••••",
  "imapHost": "colorant.o2switch.net",
  "smtpHost": "colorant.o2switch.net",
  "o2switchAutoSync": true
}
```

Quand `o2switchAutoSync` vaut `true` — ou quand `imapHost` se termine par `.o2switch.net` — le serveur :

1. Active `caldav_sync_enabled = true` et remplit `caldav_url` avec le chemin `/calendars/{email}/calendar`.
2. Active `carddav_sync_enabled = true` et remplit `carddav_url` avec le chemin `/addressbooks/{email}/addressbook`.
3. Lance une première synchronisation CalDAV en arrière-plan (import des calendriers et événements distants).

### 2. Liaison d'une adresse o2switch depuis l'admin

`POST /api/admin/o2switch/accounts/:id/link` accepte `autoSyncDav` (par défaut `true`). L'écran d'administration affiche une case à cocher *« Activer la synchronisation O2Switch (CalDAV + CardDAV) »*.

Une synchronisation CalDAV initiale est lancée pour chaque utilisateur assigné à la boîte, afin que les calendriers apparaissent immédiatement dans leur interface.

### 3. Création manuelle d'un compte mail depuis l'admin

Le formulaire *Administration → Comptes mail → Nouveau / Modifier* expose maintenant une case **« Synchronisation O2Switch (CalDAV + CardDAV) »**, cochée par défaut. Lorsque la case est active (ou que `imapHost` se termine par `.o2switch.net`), `POST /api/admin/mail-accounts` renseigne immédiatement les URLs CalDAV + CardDAV et active les deux flags. Comme la boîte n'est pas encore attribuée, **aucune synchro n'est lancée à ce stade** : elle part en arrière-plan dès qu'un utilisateur est rattaché à la boîte via `POST /api/admin/mail-accounts/:id/assignments`.

### 4. Ajout d'un calendrier CalDAV arbitraire (admin)

L'administrateur peut aussi importer n'importe quel calendrier distant (o2switch ou autre) pour le compte d'un utilisateur via *Administration → Gestion des calendriers → Ajouter via CalDAV* (endpoint `POST /api/admin/calendars/import-caldav`). Le flux :

1. Première tentative sans identifiants.
2. Si le serveur renvoie `401/403`, la réponse revient en HTTP 200 avec `{ ok: false, needsAuth: true }` — la modale affiche alors les champs *Identifiant* + *Mot de passe* (ce contrat spécial évite la déconnexion automatique de la session admin).
3. En cas de succès, chaque calendrier est dédupliqué sur `(user_id, external_id, mail_account_id IS NULL)` et ses événements sont importés sur `[−1 mois ; +6 mois]`.

## Création d'un calendrier directement sur le serveur CalDAV

Depuis la modale *Nouveau calendrier* (barre latérale du module *Calendrier*) :

1. Sélectionnez *Boîte mail* et choisissez la boîte cible.
2. Cochez *« Créer et synchroniser via CalDAV »*.
3. À la validation, le serveur envoie une requête **`MKCALENDAR`** (RFC 4791) au serveur distant :

```xml
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:set>
    <D:prop>
      <D:displayname>Nom du calendrier</D:displayname>
      <A:calendar-color>#0078D4</A:calendar-color>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>
```

Le slug de l'URL est dérivé du nom (NFD → ASCII, lowercase, `[^a-z0-9]` → `-`, 48 caractères max). La ligne locale est créée avec `source = 'caldav'`, `mail_account_id` rempli et `caldav_url = external_id = <href du nouveau collection>`. Les événements ultérieurs seront poussés automatiquement (cf. *Push en temps réel* ci-dessous).

Si le serveur CalDAV refuse `MKCALENDAR` (`4xx/5xx`), la route répond `502 Bad Gateway` avec le message du serveur et **aucune ligne locale n'est insérée** (pas de calendrier « fantôme »).

## Fusion du calendrier par défaut

Lors de la **première** synchronisation d'un compte, le calendrier local de l'utilisateur marqué `is_default = true` est **promu** (au lieu d'être dupliqué) pour pointer vers le calendrier distant par défaut :

- Choix du calendrier distant : nommé `calendar`, `default` ou `agenda` (insensible à la casse), sinon le premier renvoyé par `PROPFIND`.
- L'opération met à jour en place `mail_account_id`, `caldav_url`, `external_id` et `source = 'caldav'` — les événements locaux préalables restent visibles.

Résultat : le calendrier par défaut de l'application *est* le calendrier par défaut de la boîte mail.

## Push en temps réel

| Action UI | API | Effet distant |
|---|---|---|
| Créer un événement | `POST /api/calendar/events` | `PUT {caldavUrl}/{uid}.ics` |
| Modifier un événement | `PUT /api/calendar/events/:id` | `PUT {caldavUrl}/{uid}.ics` |
| Supprimer un événement | `DELETE /api/calendar/events/:id` | `DELETE {caldavUrl}/{uid}.ics` |
| Créer un contact | `POST /api/contacts` | `PUT {carddavUrl}/{uid}.vcf` |
| Modifier un contact | `PUT /api/contacts/:id` | `PUT {carddavUrl}/{uid}.vcf` avec `If-Match` |
| Supprimer un contact | `DELETE /api/contacts/:id` | `DELETE {carddavUrl}/{href}` |

Les appels distants sont **fire-and-forget** : ils n'empêchent jamais la réponse HTTP locale. En cas d'échec (réseau, 401), l'erreur est journalisée côté serveur (`CalDAV push failed`, `CardDAV push failed`) mais l'opération locale reste valide.

### Champs synchronisés (VEVENT — RFC 5545)

La modale événement ([client/src/components/calendar/EventModal.tsx](../client/src/components/calendar/EventModal.tsx)) expose l'intégralité des propriétés RoundCube ; le sérialiseur [server/src/utils/ical.ts](../server/src/utils/ical.ts) les pousse telles quelles vers o2switch :

| Champ UI | Propriété iCal | Notes |
|---|---|---|
| Titre | `SUMMARY` | |
| Description | `DESCRIPTION` | |
| Lieu | `LOCATION` | |
| Début / Fin | `DTSTART` / `DTEND` | `;VALUE=DATE` si *toute la journée* |
| Statut | `STATUS` | `CONFIRMED` / `TENTATIVE` / `CANCELLED` |
| Récurrence | `RRULE` | `FREQ`, `INTERVAL`, `BYDAY`, `BYMONTHDAY`, `BYMONTH`, `COUNT`, `UNTIL`, `BYDAY=1MO` (bysetpos) |
| Dates explicites | `RDATE` | mode *à certaines dates* |
| Rappel | `VALARM` | `ACTION:DISPLAY` + `TRIGGER:-PT<n>M` |
| Montrez-moi en tant que | `TRANSP` | `OPAQUE` (occupé) / `TRANSPARENT` (disponible) |
| Priorité | `PRIORITY` | `1` haute, `5` normale, `9` basse |
| Catégories | `CATEGORIES` | liste séparée par virgules |
| URL | `URL` | |
| Organisateur | `ORGANIZER;CN=…:mailto:…` | pré-rempli depuis la session |
| Participants | `ATTENDEE;ROLE=…;PARTSTAT=…;RSVP=TRUE;CN=…:mailto:…` | `REQ-PARTICIPANT`, `OPT-PARTICIPANT`, `CHAIR`, `NON-PARTICIPANT` |
| Pièces jointes | `ATTACH` | URL, ou inline base64 (`;VALUE=BINARY;ENCODING=BASE64;FMTTYPE=…`) jusqu'à 250 Mo par fichier |

À chaque modification, `ical_data` est remis à `NULL` pour forcer la reconstruction de l'ICS à partir des colonnes DB (`priority`, `url`, `categories`, `transparency`, `attachments`, `rdates`, `reminder_minutes`, `attendees`, `organizer`) et garantir la cohérence avec la base locale.

## Schéma de données

### `mail_accounts`

| Colonne | Type | Rôle |
|---|---|---|
| `caldav_url` | TEXT | URL collection CalDAV |
| `caldav_username` | VARCHAR | identifiant (souvent = email) |
| `caldav_sync_enabled` | BOOLEAN | active/désactive la synchro |
| `caldav_last_sync` | TIMESTAMP | dernière synchro réussie |
| `carddav_url` | TEXT | URL collection CardDAV |
| `carddav_username` | VARCHAR | identifiant |
| `carddav_sync_enabled` | BOOLEAN | active/désactive la synchro |
| `carddav_last_sync` | TIMESTAMP | dernière synchro réussie |

### `calendars`

Un calendrier distant est identifié par `(mail_account_id, external_id)` (index partiel unique `idx_calendars_caldav_unique`).

### `calendar_events`

Les événements remontés par la synchro sont dédupliqués via `(calendar_id, ical_uid)` (index partiel unique `idx_events_caldav_unique` — requis par le `ON CONFLICT` du sync, son absence faisait échouer la synchronisation avec un 500).

### `contacts`

Les contacts poussés sur CardDAV conservent trois champs de liaison :

- `mail_account_id` — compte mail dont le carnet a servi d'ancrage.
- `carddav_url` — URL de la collection distante.
- `carddav_href` — chemin absolu du vCard (retourné par `PUT`).
- `carddav_etag` — ETag RFC 7232, utilisé comme `If-Match` sur les mises à jour suivantes.

## Dépannage

**Erreur 500 lors d'une synchronisation CalDAV**
*Symptôme :* `POST /api/calendar/accounts/:id/sync` renvoie 500.
*Cause la plus fréquente :* index partiel `idx_events_caldav_unique` manquant. Redémarrer le backend applique la migration au démarrage (`initDatabase()`).

**Authentification échouée (401)**
Vérifier que le mot de passe stocké est bien celui d'**IMAP/SMTP** (o2switch SabreDAV utilise la même base d'auth). Si le mot de passe a changé, mettre à jour le compte mail (`PUT /api/accounts/:id`) — la synchro utilisera automatiquement le nouveau.

**Calendriers non visibles dans RoundCube**
Par défaut RoundCube n'affiche que le calendrier nommé `calendar`. La logique de fusion de WebMail cible justement ce calendrier-là pour être sûr que les événements y apparaissent.

**Contact non poussé**
Les contacts sont poussés si et seulement si un compte mail avec `carddav_sync_enabled = true` existe pour l'utilisateur. Les contacts créés **avant** l'activation de la synchro ne sont pas rattachés rétroactivement ; une édition (PUT) les rattachera si un compte CardDAV disponible est détecté.

## Autres serveurs compatibles

La même pile (auto-config différente, push identique) fonctionne avec :

- **NextCloud** (`/remote.php/dav/calendars/{user}/` et `/remote.php/dav/addressbooks/users/{user}/contacts/`)
- **SOGo** (`/SOGo/dav/{user}/Calendar/`, `/SOGo/dav/{user}/Contacts/`)
- **Baïkal / Radicale / Fastmail / iCloud** — URL à renseigner manuellement dans la modale *Synchroniser les calendriers* ou directement via `PUT /api/accounts/:id`.
