# Intégration NextCloud

Guide de configuration et d'utilisation de l'intégration NextCloud dans WebMail.

## Vue d'ensemble

L'intégration NextCloud est **optionnelle** et permet de :

- 📇 Synchroniser les contacts via **CardDAV**
- 📅 Synchroniser les calendriers via **CalDAV**
- 🖼️ Récupérer les photos de profil des utilisateurs
- 📋 Importer les listes de distribution

### Note sur l'aperçu DOCX/XLSX

Actuellement, WebMail fournit un aperçu local **simplifié** pour les fichiers DOCX/XLSX.
Ce mode privilégie la lisibilité du contenu, mais ne garantit pas une fidélité parfaite de la mise en page.

Une intégration bureautique plus fidèle est prévue via l'écosystème Office de NextCloud
(selon les applications activées sur votre instance, par exemple Collabora/OnlyOffice).

---

## Prérequis

- Instance NextCloud fonctionnelle (v20+)
- Compte utilisateur avec accès aux contacts et calendriers
- Accès réseau entre le serveur WebMail et NextCloud

---

## Configuration

### 1. Variables d'environnement

Ajoutez dans votre fichier `.env` :

```env
NEXTCLOUD_URL=https://cloud.example.com
NEXTCLOUD_USERNAME=admin
NEXTCLOUD_PASSWORD=votre_mot_de_passe
NEXTCLOUD_ENABLED=true
```

### 2. Configuration via l'interface d'administration

1. Connectez-vous en tant qu'administrateur
2. Allez dans **Administration > NextCloud**
3. Renseignez :
   - URL de l'instance NextCloud
   - Nom d'utilisateur
   - Mot de passe
4. Cliquez sur **Tester la connexion**
5. Sauvegardez si le test est réussi

---

## Synchronisation des contacts (CardDAV)

### Fonctionnement

WebMail interroge le service CardDAV de NextCloud pour récupérer les contacts :

```
NextCloud → CardDAV → vCard parsing → Base locale (contacts)
```

### Données récupérées

| Champ NextCloud | Champ WebMail |
|-----------------|---------------|
| FN | `displayName` |
| N | `firstName`, `lastName` |
| EMAIL | `email` |
| TEL | `phone` |
| ORG | `company` |
| TITLE | `jobTitle` |
| ROLE | `role` |
| DEPARTMENT | `department` |
| NOTE | `notes` |
| PHOTO | `photoUrl` |

### Photos de profil

Les photos de profil NextCloud sont automatiquement récupérées et utilisées :
- Dans la liste des contacts
- Dans le composeur d'email (autocomplétion)
- Dans la vue des messages (avatar de l'expéditeur)

Si un contact n'a pas de photo NextCloud, un avatar coloré est généré automatiquement à partir de ses initiales.

---

## Synchronisation des calendriers (CalDAV)

### Fonctionnement

```
NextCloud → CalDAV → iCal parsing → Base locale (calendars, calendar_events)
```

### Données synchronisées

| Champ iCal | Champ WebMail |
|------------|---------------|
| SUMMARY | `title` |
| DESCRIPTION | `description` |
| DTSTART | `start` |
| DTEND | `end` |
| LOCATION | `location` |
| ATTENDEE | `attendees` |
| RRULE | `recurrence` |

### Calendriers partagés

Les calendriers partagés dans NextCloud sont également importés. Les permissions sont respectées :
- **Lecture seule** : visualisation uniquement dans WebMail
- **Lecture/écriture** : modification possible depuis WebMail

---

## Listes de distribution

Les listes de distribution NextCloud (groupes de contacts) sont importées et disponibles :
- Dans l'autocomplétion du composeur d'email
- Dans la gestion des contacts (section Groupes)

---

## URLs CalDAV / CardDAV

### Format des URLs

```
# CardDAV
https://cloud.example.com/remote.php/dav/addressbooks/users/{username}/contacts/

# CalDAV
https://cloud.example.com/remote.php/dav/calendars/{username}/{calendar-name}/
```

### Vérification manuelle

Pour tester la connexion CardDAV :

```bash
curl -u "username:password" \
  -X PROPFIND \
  -H "Depth: 1" \
  "https://cloud.example.com/remote.php/dav/addressbooks/users/username/contacts/"
```

Pour tester la connexion CalDAV :

```bash
curl -u "username:password" \
  -X PROPFIND \
  -H "Depth: 1" \
  "https://cloud.example.com/remote.php/dav/calendars/username/"
```

---

## Dépannage

### Erreur de connexion

| Symptôme | Cause probable | Solution |
|----------|---------------|----------|
| `401 Unauthorized` | Identifiants incorrects | Vérifiez username/password |
| `404 Not Found` | URL incorrecte | Vérifiez l'URL NextCloud |
| `Connection refused` | Réseau bloqué | Vérifiez le firewall / réseau Docker |
| `SSL certificate error` | Certificat auto-signé | Ajoutez `NODE_TLS_REJECT_UNAUTHORIZED=0` (dev uniquement) |

### Contacts non synchronisés

1. Vérifiez que le carnet d'adresses par défaut existe dans NextCloud
2. Vérifiez les permissions de l'utilisateur sur le carnet
3. Consultez les logs : `docker-compose logs app | grep nextcloud`

### Calendriers non visibles

1. Vérifiez que le calendrier existe dans NextCloud
2. Vérifiez que le calendrier n'est pas masqué dans NextCloud
3. Vérifiez les permissions de partage

### Performances

Pour les instances NextCloud avec beaucoup de contacts (>1000) :
- La synchronisation initiale peut prendre quelques minutes
- Les synchronisations suivantes sont incrémentales
- Un cache local est maintenu dans PostgreSQL pour éviter les appels répétés

---

## Architecture technique

### Service NextCloud (`server/src/services/nextcloud.ts`)

Le service gère toutes les interactions avec NextCloud :

```
NextCloudService
├── testConnection()       → Test de connectivité
├── getContacts()          → Récupération CardDAV
├── getCalendars()         → Liste des calendriers CalDAV
├── getEvents(calendar)    → Événements d'un calendrier
├── getUserAvatar(email)   → Photo de profil
└── getDistributionLists() → Listes de distribution
```

### Protocoles

| Protocole | Standard | Usage |
|-----------|----------|-------|
| CardDAV | RFC 6352 | Contacts |
| CalDAV | RFC 4791 | Calendriers |
| vCard | RFC 6350 | Format de contact |
| iCalendar | RFC 5545 | Format d'événement |

### Authentification

L'authentification utilise **HTTP Basic Auth** sur HTTPS. Les identifiants sont :
- Stockés dans les variables d'environnement (configuration globale)
- Ou configurés par l'administrateur via l'interface web
- Jamais exposés côté client
