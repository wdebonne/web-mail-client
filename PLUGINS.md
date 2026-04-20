# Guide de Développement de Plugins

Ce guide explique comment créer, configurer et distribuer des plugins pour WebMail.

## Table des matières

- [Architecture](#architecture)
- [Créer un plugin](#créer-un-plugin)
- [Fichier manifest.json](#fichier-manifestjson)
- [Fichier index.js](#fichier-indexjs)
- [API disponible](#api-disponible)
- [Actions et données](#actions-et-données)
- [Configuration](#configuration)
- [Test et débogage](#test-et-débogage)
- [Distribution](#distribution)
- [Exemple complet](#exemple-complet)

---

## Architecture

Les plugins sont des modules chargés dynamiquement depuis le dossier `/plugins`. Chaque plugin est un répertoire contenant au minimum :

```
plugins/
└── mon-plugin/
    ├── manifest.json      # Métadonnées et configuration
    └── index.js           # Point d'entrée (classe exportée)
```

Le `PluginManager` du serveur :
1. Scanne le dossier `/plugins` au démarrage
2. Charge le `manifest.json` de chaque plugin
3. Instancie la classe exportée par `index.js`
4. Appelle `initialize(config)` avec la configuration
5. Route les actions vers la méthode `execute(action, data, context)`

---

## Créer un plugin

### Étape 1 : Créer le répertoire

```bash
mkdir -p plugins/mon-plugin
cd plugins/mon-plugin
```

### Étape 2 : Créer le manifest

Créez `manifest.json` :

```json
{
  "name": "mon-plugin",
  "displayName": "Mon Plugin",
  "description": "Description de ce que fait le plugin",
  "version": "1.0.0",
  "author": "Votre Nom",
  "icon": "🔧",
  "config": {},
  "actions": []
}
```

### Étape 3 : Créer le point d'entrée

Créez `index.js` :

```javascript
class MonPlugin {
  constructor() {
    this.config = {};
  }

  async initialize(config) {
    this.config = config;
  }

  async execute(action, data, context) {
    // Logique du plugin
    return { result: 'OK' };
  }

  async destroy() {
    // Nettoyage (optionnel)
  }
}

module.exports = MonPlugin;
```

---

## Fichier manifest.json

Référence complète des champs :

```json
{
  "name": "identifiant-unique",
  "displayName": "Nom affiché dans l'interface",
  "description": "Description pour l'administrateur",
  "version": "1.0.0",
  "author": "Auteur du plugin",
  "icon": "🔧",
  "minVersion": "1.0.0",
  "config": {
    "parametre1": {
      "type": "string",
      "label": "Libellé dans l'interface",
      "default": "valeur par défaut",
      "required": true,
      "description": "Description du paramètre"
    },
    "parametre2": {
      "type": "number",
      "label": "Nombre max",
      "default": 100,
      "required": false
    },
    "parametre3": {
      "type": "boolean",
      "label": "Activer la fonctionnalité",
      "default": true
    },
    "parametre4": {
      "type": "select",
      "label": "Choisir une option",
      "options": ["option1", "option2", "option3"],
      "default": "option1"
    }
  },
  "actions": [
    {
      "name": "action_id",
      "label": "Libellé de l'action",
      "description": "Ce que fait cette action",
      "context": ["email", "compose", "contact"]
    }
  ]
}
```

### Types de configuration

| Type | Rendu dans l'interface |
|------|----------------------|
| `string` | Champ texte |
| `number` | Champ numérique |
| `boolean` | Toggle on/off |
| `select` | Menu déroulant |
| `password` | Champ mot de passe (masqué) |

### Contextes d'action

| Contexte | Quand l'action est disponible |
|----------|------------------------------|
| `email` | Lecture d'un email |
| `compose` | Rédaction d'un email |
| `contact` | Fiche contact |
| `calendar` | Événement calendrier |
| `global` | Toujours disponible |

---

## Fichier index.js

### Structure de la classe

```javascript
class MonPlugin {
  /**
   * Constructeur - appelé une seule fois au chargement
   */
  constructor() {
    this.config = {};
  }

  /**
   * Initialisation avec la configuration
   * @param {Object} config - Valeurs de configuration
   */
  async initialize(config) {
    this.config = config;
    // Initialiser connexions, caches, etc.
  }

  /**
   * Exécuter une action
   * @param {string} action - Nom de l'action (depuis manifest.actions[].name)
   * @param {Object} data - Données contextuelles
   * @param {Object} context - Contexte d'exécution
   * @returns {Object} Résultat de l'action
   */
  async execute(action, data, context) {
    switch (action) {
      case 'mon_action':
        return await this.monAction(data, context);
      default:
        throw new Error(`Action inconnue : ${action}`);
    }
  }

  /**
   * Nettoyage avant désactivation (optionnel)
   */
  async destroy() {
    // Fermer les connexions, libérer les ressources
  }

  // Méthodes privées
  async monAction(data, context) {
    return { result: 'Fait !' };
  }
}

module.exports = MonPlugin;
```

### Objet `data`

Les données passées dépendent du contexte :

**Contexte `email` :**
```javascript
{
  subject: "Sujet de l'email",
  from: { name: "Expéditeur", address: "exp@example.com" },
  to: [{ name: "Dest", address: "dest@example.com" }],
  body: "Corps de l'email (texte ou HTML)",
  date: "2026-04-20T10:00:00Z",
  attachments: [{ filename: "doc.pdf", contentType: "application/pdf" }]
}
```

**Contexte `compose` :**
```javascript
{
  to: [{ name: "Dest", address: "dest@example.com" }],
  subject: "Sujet en cours",
  body: "Contenu en cours de rédaction",
  replyTo: { /* email original si réponse */ }
}
```

**Contexte `contact` :**
```javascript
{
  firstName: "Marie",
  lastName: "Durand",
  email: "marie@example.com",
  company: "ACME"
}
```

### Objet `context`

```javascript
{
  userId: "uuid",           // ID de l'utilisateur
  userEmail: "user@...",    // Email de l'utilisateur
  locale: "fr",             // Langue de l'utilisateur
  pluginConfig: {}          // Configuration du plugin
}
```

---

## Configuration

### Configuration par défaut

Les valeurs par défaut sont définies dans `manifest.json`. L'administrateur peut les modifier dans **Administration > Plugins**.

### Accès à la configuration

```javascript
async initialize(config) {
  this.apiUrl = config.apiUrl || 'http://localhost:8080';
  this.timeout = config.timeout || 30000;
  this.language = config.language || 'fr';
}
```

### Validation

Validez la configuration dans `initialize()` :

```javascript
async initialize(config) {
  if (!config.apiUrl) {
    throw new Error('Configuration requise : apiUrl');
  }
  this.config = config;
}
```

---

## Test et débogage

### Logs

Utilisez `console.log` — les logs sont capturés par le logger Pino du serveur :

```javascript
async execute(action, data, context) {
  console.log(`[mon-plugin] Action ${action} par ${context.userId}`);
  // ...
}
```

### Test en développement

1. Placez votre plugin dans le dossier `plugins/`
2. Lancez le serveur en mode dev : `npm run dev:server`
3. Le plugin sera rechargé à chaque modification
4. Testez via l'API :

```bash
curl -X POST http://localhost:3000/api/plugins/mon-plugin/execute \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"action": "mon_action", "data": {"test": true}}'
```

### Erreurs courantes

| Erreur | Cause | Solution |
|--------|-------|----------|
| `Plugin not found` | Dossier ou manifest.json manquant | Vérifiez la structure du dossier |
| `Action inconnue` | Action non déclarée dans le manifest | Ajoutez l'action dans `actions[]` |
| `initialize failed` | Erreur dans `initialize()` | Vérifiez la configuration |
| `Module not found` | Dépendance manquante | Installez dans le dossier du plugin |

---

## Distribution

### Structure de distribution

```
mon-plugin/
├── manifest.json
├── index.js
├── README.md          # Documentation du plugin
├── LICENSE            # Licence
├── package.json       # Si dépendances npm
└── node_modules/      # Dépendances (auto-installées)
```

### Installation d'un plugin

1. Copiez le dossier du plugin dans `/plugins`
2. Si le plugin a un `package.json`, lancez :
   ```bash
   cd plugins/mon-plugin && npm install
   ```
3. Redémarrez l'application (ou elle détectera automatiquement le nouveau plugin)
4. Activez le plugin dans **Administration > Plugins**
5. Configurez si nécessaire
6. Attribuez aux utilisateurs ou groupes

---

## Exemple complet

### Plugin : Traduction automatique

```
plugins/auto-translate/
├── manifest.json
└── index.js
```

**manifest.json :**
```json
{
  "name": "auto-translate",
  "displayName": "Traduction Automatique",
  "description": "Traduit automatiquement les emails reçus dans votre langue",
  "version": "1.0.0",
  "author": "WebMail",
  "icon": "🌐",
  "config": {
    "apiUrl": {
      "type": "string",
      "label": "URL de l'API de traduction",
      "default": "http://localhost:5000",
      "required": true
    },
    "targetLanguage": {
      "type": "select",
      "label": "Langue cible",
      "options": ["fr", "en", "de", "es", "it"],
      "default": "fr"
    },
    "autoDetect": {
      "type": "boolean",
      "label": "Détecter la langue source automatiquement",
      "default": true
    }
  },
  "actions": [
    {
      "name": "translate_email",
      "label": "Traduire cet email",
      "description": "Traduit le contenu de l'email",
      "context": ["email"]
    },
    {
      "name": "translate_text",
      "label": "Traduire le texte sélectionné",
      "description": "Traduit un texte libre",
      "context": ["compose"]
    }
  ]
}
```

**index.js :**
```javascript
class AutoTranslatePlugin {
  constructor() {
    this.config = {};
  }

  async initialize(config) {
    this.apiUrl = config.apiUrl || 'http://localhost:5000';
    this.targetLang = config.targetLanguage || 'fr';
    this.autoDetect = config.autoDetect !== false;
  }

  async execute(action, data, context) {
    switch (action) {
      case 'translate_email':
        return await this.translateEmail(data);
      case 'translate_text':
        return await this.translateText(data);
      default:
        throw new Error(`Action inconnue : ${action}`);
    }
  }

  async translateEmail(data) {
    const translated = await this.callApi(data.body, this.targetLang);
    return {
      result: translated,
      originalLanguage: translated.detectedLanguage,
      targetLanguage: this.targetLang
    };
  }

  async translateText(data) {
    const translated = await this.callApi(data.body, this.targetLang);
    return { result: translated.text };
  }

  async callApi(text, targetLang) {
    const response = await fetch(`${this.apiUrl}/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        target: targetLang,
        source: this.autoDetect ? 'auto' : undefined
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!response.ok) {
      throw new Error(`Erreur de traduction : ${response.status}`);
    }

    return await response.json();
  }

  async destroy() {
    // Rien à nettoyer
  }
}

module.exports = AutoTranslatePlugin;
```
