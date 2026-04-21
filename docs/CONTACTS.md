# Gestion des Contacts

Guide complet de la gestion des contacts dans WebMail.

## Aperçu

WebMail dispose d'un système de gestion des contacts complet avec support de trois sources :

1. **Contacts locaux** (`source: 'local'`) : créés manuellement par l'utilisateur
2. **Expéditeurs** (`source: 'sender'`) : enregistrés automatiquement depuis les emails reçus
3. **Contacts NextCloud** (`source: 'nextcloud'`) : synchronisés depuis NextCloud CardDAV

---

## Expéditeurs automatiques

### Concept

Chaque fois que vous ouvrez un email reçu, l'expéditeur est automatiquement enregistré dans votre carnet d'adresses comme "Expéditeur non permanent". Cela signifie :

- ✅ Disponible immédiatement dans l'autocomplétion du composeur
- ✅ Affichable dans la page Contacts dans la section "Expéditeurs non enregistrés"
- ✅ Pas d'impact sur votre carnet d'adresses principal
- ❌ Non synchronisé avec NextCloud

### Workflow typique

1. **Réception d'un email** : L'expéditeur est automatiquement enregistré avec `source = 'sender'`
2. **Autocomplétion** : L'email est disponible dans le composeur avec un badge "Expéditeur"
3. **Promotion** : Dans la page Contacts, vous pouvez cliquer "Enregistrer" pour promouvoir l'expéditeur en contact permanent
4. **Après promotion** : Le contact passe en `source = 'local'` et devient un véritable contact

### API

#### Enregistrement automatique

**Endpoint** : `POST /api/contacts/senders/record`

Appelé automatiquement lorsqu'un message est ouvert. Upsert silencieux : ne provoque pas d'erreur si le contact existe déjà en permanent.

```bash
curl -X POST http://localhost:3000/api/contacts/senders/record \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "jean@example.com",
    "name": "Jean Dupont"
  }'
```

**Réponse 200** :
```json
{
  "id": "uuid-123",
  "email": "jean@example.com",
  "display_name": "Jean Dupont",
  "source": "sender"
}
```

#### Promotion d'expéditeur

**Endpoint** : `POST /api/contacts/:id/promote`

Convertit un expéditeur (`source = 'sender'`) en contact permanent (`source = 'local'`).

```bash
curl -X POST http://localhost:3000/api/contacts/uuid-123/promote \
  -H "Authorization: Bearer <token>"
```

**Réponse 200** :
```json
{
  "id": "uuid-123",
  "email": "jean@example.com",
  "display_name": "Jean Dupont",
  "source": "local"
}
```

---

## Page Contacts

### Sections

#### 1. Contacts locaux (par défaut)
- Vos contacts manuellement créés
- Organisés par groupes personnalisés
- Avec détails complets (téléphone, entreprise, etc.)

#### 2. Expéditeurs non enregistrés (nouveau)
- Cliquez sur le bouton **"Expéditeurs non enregistrés"** dans le panneau latéral gauche
- Badge orange avec compteur du nombre d'expéditeurs
- Chaque contact affiche :
  - L'email
  - Le nom du contact (si disponible)
  - Le badge "Expéditeur non enregistré"

### Actions sur les expéditeurs

#### Affichage
Cliquez sur un expéditeur pour voir ses détails dans le panneau droit.

#### Enregistrement (Promotion)
Cliquez sur le bouton **"Enregistrer"** (icône UserCheck) pour promouvoir l'expéditeur en contact permanent.

Une confirmation s'affichera :
```
Enregistrer "Jean Dupont" comme contact permanent ?
```

Après confirmation :
1. L'expéditeur bascule en contact local
2. Il disparaît de la section "Expéditeurs non enregistrés"
3. Il apparaît dans les contacts normaux
4. Il devient synchronisable avec NextCloud si activé

#### Modification
Même actions que les contacts normaux :
- Cliquez sur **"Modifier"** (icône Edit) pour éditer les détails
- Cliquez sur **"Supprimer"** (icône Trash) pour supprimer

---

## Composeur d'emails amélioré

### Sélection de l'expéditeur

Le champ "De" affiche maintenant :
- **Nom du compte** en gras
- **Adresse email** en sous-texte

Exemple :
```
Travail
jean@entreprise.com
```

Plus de double email ! 🎉

### Sélection des destinataires

#### Autocomplétion

Tapez dans le champ **À**, **Cc** ou **Cci** :

- 🔤 Minimum **1 caractère** pour activer l'autocomplétion (au lieu de 2)
- 👤 Affiche le **nom du contact** en priorité
- 📨 Affiche l'**adresse email** en sous-texte
- 🔸 Badge orange pour les **expéditeurs non enregistrés**

Exemple en tapant "j" :
```
Jean Dupont                          jean@example.com
Pierre Martin                        pierre@example.com
└─ Expéditeur (badge orange)
```

#### Modal de sélection de contacts

Cliquez sur le label **"À"**, **"Cc"** ou **"Cci"** pour ouvrir la modal de sélection :

- 🔍 Champ de recherche en haut
- ☑️ Cases à cocher pour sélectionner plusieurs contacts
- 🔸 Indicateur "Expéditeur" pour les contacts non enregistrés
- ✅ Ajout automatique des contacts sélectionnés

### Destinataires sélectionnés

Les destinataires s'affichent sous forme de **pilules bleues** :

```
Destinataires: [Jean Dupont ✕] [Marie Durand ✕] [Olivier ✕]
```

Cliquez le **✕** pour retirer un destinataire.

---

## Éditeur de texte riche

### Barre d'outils

#### Police et taille
- **Police** : Arial, Times New Roman, Courier New, Georgia, Verdana, etc.
- **Taille** : 8px, 10px, 12px, 14px, 16px, 18px, 20px, 24px, 28px, 32px, 36px, 40px, 44px, 48px, 54px, 60px, 66px, 72px

#### Formatage du texte
- **Gras** (Ctrl+B)
- *Italique* (Ctrl+I)
- <u>Souligné</u> (Ctrl+U)
- ~~Barré~~ (strikethrough)

#### Couleurs
- **Couleur du texte** : grille de 30 couleurs
- **Surlignage** : grille de 30 couleurs

#### Alignement
- ↤ Aligné à gauche
- ↥ Centré
- ↦ Aligné à droite
- ↨ Justifié

#### Listes
- • Puces
- 1. Numérotée
- → Augmenter le retrait
- ← Réduire le retrait

#### Insertions
- 🔗 **Lien hypertexte** : ouvre un dialog pour entrer l'URL
- 🖼️ **Image** : insérer une image par URL
- **Effacer la mise en forme** : réinitialise le texte sélectionné au format simple

---

## Base de données

### Schéma Contacts

Chaque contact possède une colonne `source` :

```sql
CREATE TABLE contacts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id),
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(255),
  phone VARCHAR(20),
  company VARCHAR(255),
  job_title VARCHAR(255),
  department VARCHAR(255),
  photo_url TEXT,
  notes TEXT,
  source VARCHAR(50) NOT NULL DEFAULT 'local',  -- 'local', 'sender', 'nextcloud'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, email)
);
```

### Valeurs de `source`

| Valeur | Description | Modifiable | Sync NextCloud |
|--------|-------------|-----------|-----------------|
| `'local'` | Contact créé manuellement | ✅ Oui | ✅ Oui (si activé) |
| `'sender'` | Expéditeur auto-enregistré | ✅ Oui | ❌ Non |
| `'nextcloud'` | Synchronisé depuis NextCloud | ❌ Non* | ✅ Oui |

\* Les contacts NextCloud ne peuvent pas être modifiés localement. Les modifications doivent se faire dans NextCloud directement.

---

## Cas d'usage

### Scénario 1 : Email reçu d'un nouveau contact

1. Vous recevez un email de `alice@company.com`
2. Vous ouvrez le message
3. Alice est **automatiquement enregistrée** comme expéditeur
4. Vous écrivez une réponse et tapez "a" → Alice apparaît dans l'autocomplétion
5. Plus tard, vous décidez de la sauvegarder comme contact permanent
6. Vous allez dans Contacts > Expéditeurs non enregistrés
7. Vous cliquez "Enregistrer" sur Alice
8. Alice devient un contact permanent avec `source = 'local'`

### Scénario 2 : Gestion des expéditeurs en masse

1. Vous avez accumulé plusieurs expéditeurs automatiques
2. Vous allez dans Contacts et cliquez "Expéditeurs non enregistrés"
3. Vous parcourez la liste et enregistrez ceux que vous voulez garder
4. Les autres restent comme expéditeurs temporaires (utiles pour l'autocomplétion)

### Scénario 3 : Synchronisation NextCloud

1. Vous avez NextCloud activé
2. Un contact local que vous avez créé se synchronise avec NextCloud
3. Les contacts NextCloud arrivent inversement avec `source = 'nextcloud'`
4. Vous ne pouvez pas les modifier localement, seulement les consulter
5. Si vous supprimez un contact local d'origine NextCloud... comportement ? (à définir)

---

## Limite et notes

- **Autocomplétion** : minimum 1 caractère (pour une meilleure UX)
- **Expéditeurs** : pas de limite, tous les emails reçus sont enregistrés silencieusement
- **Promotion** : une fois promut, un expéditeur ne revient jamais à `source = 'sender'`
- **NextCloud** : les contacts NextCloud sont en lecture seule localement
- **Suppression** : la suppression d'un contact supprime aussi ses éventuels doublets dans les autres sources (?) - **à clarifier**

---

## Configuration

Aucune configuration spéciale pour les contacts. Ils fonctionnent "out of the box" une fois le serveur lancé.

Si vous souhaitez **désactiver** l'auto-enregistrement des expéditeurs, il faudrait :
1. Ajouter une variable d'environnement `AUTO_RECORD_SENDERS=false`
2. Vérifier la condition dans `MessageView.tsx` et `server/src/components/mail/MessageView.ts`

(À implémenter si besoin)
