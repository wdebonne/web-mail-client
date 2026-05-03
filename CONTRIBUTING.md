# Guide de Contribution

Merci de votre intérêt pour WebMail ! Ce document explique comment contribuer au projet.

## Table des matières

- [Code de conduite](#code-de-conduite)
- [Comment contribuer](#comment-contribuer)
- [Environnement de développement](#environnement-de-développement)
- [Structure du projet](#structure-du-projet)
- [Conventions de code](#conventions-de-code)
- [Processus de Pull Request](#processus-de-pull-request)
- [Rapporter un bug](#rapporter-un-bug)
- [Proposer une fonctionnalité](#proposer-une-fonctionnalité)

---

## Code de conduite

- Soyez respectueux et constructif
- Acceptez les critiques constructives
- Concentrez-vous sur ce qui est le mieux pour le projet
- Faites preuve d'empathie envers les autres contributeurs

---

## Comment contribuer

1. **Forkez** le dépôt
2. **Créez** une branche pour votre fonctionnalité (`git checkout -b feature/ma-fonctionnalite`)
3. **Committez** vos modifications (`git commit -m 'feat: ajout de ma fonctionnalité'`)
4. **Poussez** vers la branche (`git push origin feature/ma-fonctionnalite`)
5. **Ouvrez** une Pull Request

---

## Environnement de développement

### Prérequis

| Outil | Version |
|-------|---------|
| Node.js | 20 LTS |
| npm | 10+ |
| PostgreSQL | 16+ |
| Docker (optionnel) | 20.10+ |

### Installation

```bash
# Cloner votre fork
git clone https://github.com/votre-user/webmail.git
cd webmail

# Lancer la base de données avec Docker
docker-compose up -d db

# Installer les dépendances
cd server && npm install
cd ../client && npm install
cd ..

# Copier la configuration
cp .env.example .env
# Éditer .env pour le développement local

# Lancer en mode développement
npm run dev
```

Le frontend sera accessible sur `http://localhost:5173` et le backend sur `http://localhost:3000`.

### Commandes utiles

```bash
# Développement (frontend + backend simultanés)
npm run dev

# Build complet
npm run build

# Lancer uniquement le backend
npm run dev:server

# Lancer uniquement le frontend
npm run dev:client

# Base de données
npm run db:migrate    # Appliquer les migrations
npm run db:seed       # Données de test
```

---

## Structure du projet

```
webmail/
├── client/                 # Frontend React + TypeScript
│   ├── src/
│   │   ├── api/            # Client API (fetch wrapper)
│   │   ├── components/     # Composants réutilisables
│   │   │   └── mail/       # Composants messagerie
│   │   ├── hooks/          # Hooks React personnalisés
│   │   ├── pages/          # Pages (routes principales)
│   │   ├── pwa/            # Service Worker & IndexedDB
│   │   ├── stores/         # État global (Zustand)
│   │   └── types/          # Définitions TypeScript
│   └── vite.config.ts
├── server/                 # Backend Express + TypeScript
│   └── src/
│       ├── database/       # Schéma, connexion, migrations
│       ├── middleware/      # Auth, validation
│       ├── routes/         # Routes API REST
│       ├── services/       # Logique métier (Mail, WS, NextCloud)
│       ├── plugins/        # Gestionnaire de plugins
│       └── utils/          # Utilitaires (logger, crypto)
├── plugins/                # Plugins installés
│   └── ollama-ai/          # Exemple : plugin IA
├── docs/                   # Documentation détaillée
├── docker-compose.yml
├── Dockerfile
└── .env.example
```

---

## Conventions de code

### Commits

Suivez le format [Conventional Commits](https://www.conventionalcommits.org/fr/) :

```
<type>(<portée>): <description>

[corps optionnel]

[pied de page optionnel]
```

Types autorisés :

| Type | Description |
|------|-------------|
| `feat` | Nouvelle fonctionnalité |
| `fix` | Correction de bug |
| `docs` | Documentation |
| `style` | Formatage (pas de changement de code) |
| `refactor` | Refactoring |
| `perf` | Amélioration de performance |
| `test` | Ajout ou correction de tests |
| `chore` | Maintenance (dépendances, CI, etc.) |

Exemples :
```
feat(mail): ajout du déplacement par drag & drop
fix(contacts): correction de la recherche avec accents
docs: mise à jour du guide de déploiement
chore(deps): mise à jour de React 18.3
```

### TypeScript

- Utilisez les types stricts (`strict: true`)
- Préférez les interfaces aux types pour les objets
- Évitez `any` — utilisez `unknown` si nécessaire
- Nommage : `camelCase` pour les variables/fonctions, `PascalCase` pour les composants/types

### React

- Composants fonctionnels uniquement
- Hooks pour la logique réutilisable
- Un composant par fichier
- Nommage des fichiers en `PascalCase` pour les composants

### CSS / Tailwind

- Utilisez les classes Tailwind CSS
- Utilisez les couleurs du thème style messagerie professionnelle : `style messagerie professionnelle-blue`, `style messagerie professionnelle-bg-primary`, etc.
- Évitez les styles inline sauf nécessité absolue
- Responsive : mobile-first

### Backend

- Routes dans `server/src/routes/`
- Logique métier dans `server/src/services/`
- Validation des entrées avec Zod
- Gestion d'erreurs cohérente avec codes HTTP standards
- Logging via Pino

---

## Processus de Pull Request

### Avant de soumettre

- [ ] Le code compile sans erreur (`npm run build`)
- [ ] Pas de régression dans les fonctionnalités existantes
- [ ] Les nouvelles routes API sont documentées
- [ ] Les nouveaux composants suivent le design style messagerie professionnelle existant
- [ ] Les messages utilisateur sont en français

### Template de PR

```markdown
## Description
[Décrivez votre modification]

## Type de changement
- [ ] Bug fix
- [ ] Nouvelle fonctionnalité
- [ ] Breaking change
- [ ] Documentation

## Tests effectués
[Décrivez les tests réalisés]

## Captures d'écran (si applicable)
[Ajoutez des screenshots]
```

### Revue de code

- Au moins 1 approbation requise
- Les commentaires doivent être adressés avant merge
- Squash des commits avant merge

---

## Rapporter un bug

Utilisez le template suivant dans les Issues :

```markdown
### Description du bug
[Description claire et concise]

### Étapes pour reproduire
1. Aller sur '...'
2. Cliquer sur '...'
3. Voir l'erreur

### Comportement attendu
[Ce qui devrait se passer]

### Captures d'écran
[Si applicable]

### Environnement
- OS : [ex. Windows 11]
- Navigateur : [ex. Chrome 120]
- Version WebMail : [ex. 1.0.0]
- Docker : [Oui/Non, version]
```

---

## Proposer une fonctionnalité

Ouvrez une Issue avec le label `enhancement` :

```markdown
### Description de la fonctionnalité
[Description claire de ce que vous proposez]

### Motivation
[Pourquoi cette fonctionnalité serait utile]

### Solution envisagée
[Comment vous imaginez l'implémentation]

### Alternatives considérées
[Autres approches possibles]
```

---

## Développement de plugins

Pour créer un plugin, consultez le guide dédié : [PLUGINS.md](PLUGINS.md)
