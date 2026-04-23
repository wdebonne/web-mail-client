# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [Versioning Sémantique](https://semver.org/lang/fr/).

## [Unreleased]

### Ajouté

#### Agenda — Disposition Outlook des événements qui se chevauchent

- **Colonnes parallèles pour les chevauchements** ([client/src/pages/CalendarPage.tsx](client/src/pages/CalendarPage.tsx)) : les vues *Jour*, *Semaine* et *Semaine de travail* utilisent un algorithme de layout type Outlook. Les événements qui se chevauchent sont groupés en « clusters » (composantes connexes d'overlap), puis distribués dans des « voies » verticales parallèles. Chaque événement occupe `1/cols` de la colonne-jour, avec une légère superposition (4 px) pour le rendu en cascade caractéristique d'Outlook et un z-index croissant (hover = au-dessus).
- **Expansion latérale automatique** : un événement qui n'a pas de voisin dans les voies à sa droite (pour la plage temporelle qu'il occupe) s'étend pour occuper toute la largeur libre restante — un événement isolé dans sa propre demi-heure reste pleine largeur même si d'autres événements coexistent ailleurs dans la journée.

### Corrigé

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
  - **CSV Google Contacts** — Gmail / Google Contacts
  - **CSV Outlook / Microsoft 365**
  - **CSV générique** compatible tableur
  - Détection automatique du format à l'import, gestion du BOM UTF-8, décodage des photos embarquées (`PHOTO;ENCODING=b`).
- **Route d'import en masse** `POST /api/contacts/import` avec 3 modes de gestion des doublons :
  - `merge` : compléter les champs existants
  - `skip` : ignorer si l'e-mail existe déjà
  - `replace` : écraser les champs des contacts existants
  - Déduplication par e-mail, promotion automatique des expéditeurs non enregistrés lors d'un import.
- **Modale d'import** avec drag & drop, détection du format, aperçu des 50 premiers contacts avant validation et choix du mode de fusion.
- **Menu d'export** (vCard, CSV Google, CSV Outlook, CSV générique) accessible depuis la barre latérale de la page Contacts.
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
- **Couleurs adaptées au thème sombre** : utilisation de `bg-outlook-bg-selected`, `bg-outlook-bg-primary` et `bg-outlook-bg-tertiary` (variables CSS du thème) pour que le contact sélectionné, les en-têtes alphabétiques et les cartes restent lisibles en mode sombre.
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
