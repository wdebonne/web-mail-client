# Audit de sécurité — Web Mail Client

_Date : 24 avril 2026_
_Périmètre : `server/src/**`, `client/src/**`, configuration déploiement (`docker-compose.yml`, `Dockerfile`)._

## Synthèse

L'architecture générale est saine :

- requêtes paramétrées (pas de concaténation SQL directe),
- `bcrypt` (coût 12) pour les mots de passe,
- `helmet`, `zod`, `DOMPurify` sur la lecture des mails,
- keystore client PBKDF2 310 000 itérations + AES-GCM 256 bits.

Plusieurs faiblesses **critiques à hautes** doivent cependant être corrigées avant une exposition Internet.

| Sévérité   | Nombre |
|------------|--------|
| Critique   | 4      |
| Élevée     | 6      |
| Moyenne    | 8      |
| Faible / bonne pratique | — |

---

## 🔴 Critiques

### C1. Secrets par défaut silencieux en production

**Fichiers :**
- [server/src/index.ts](server/src/index.ts#L77)
- [server/src/middleware/auth.ts](server/src/middleware/auth.ts#L17)
- [server/src/services/websocket.ts](server/src/services/websocket.ts#L25)
- [server/src/utils/encryption.ts](server/src/utils/encryption.ts#L6)
- [server/src/database/connection.ts](server/src/database/connection.ts#L7)

Tous utilisent un fallback du type `'dev-secret-change-me'` / `'change-me-32-chars-minimum-key!!'` / credentials Postgres codés en dur. Si la variable d'environnement est absente, le serveur démarre quand même. Un attaquant connaissant ces constantes (repo public) peut :

- forger des JWT valides,
- déchiffrer les mots de passe IMAP/SMTP/CalDAV persistés,
- ouvrir des sessions arbitraires.

**Correctif :**

- en `NODE_ENV=production`, lever une erreur fatale si `SESSION_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL` ne sont pas définis,
- introduire un `JWT_SECRET` distinct du secret de session,
- supprimer toute constante fallback sensible.

### C2. Chiffrement des secrets serveur — salt statique

**Fichier :** [server/src/utils/encryption.ts](server/src/utils/encryption.ts#L5-L8)

```ts
crypto.scryptSync(key, 'salt', 32)
```

Le « sel » est littéralement la chaîne `"salt"`. Deux instances avec la même `ENCRYPTION_KEY` dérivent la même clé AES, des tables pré-calculées deviennent possibles. AES-GCM est correct, mais la dérivation doit utiliser un salt aléatoire :

- soit stocké avec chaque ciphertext,
- soit un salt propre à l'instance conservé en config.

Idéalement migrer vers `libsodium` (`crypto_secretbox`) ou `argon2id` pour la dérivation.

### C3. Upload de branding SVG autorisé

**Fichier :** [server/src/routes/branding.ts](server/src/routes/branding.ts#L37-L40), [server/src/routes/branding.ts](server/src/routes/branding.ts#L99)

Le filtre MIME accepte `image/svg+xml`. Un admin (ou un admin compromis) peut déposer un SVG contenant `<script>` ; il est ensuite servi **inline depuis l'origine** de l'application (`/favicon.ico`, `/icon-192.png`, etc.), donc exécuté dans le contexte applicatif.

**Correctif :**

- exclure SVG du filtre MIME, **ou**
- forcer `Content-Type: image/svg+xml`, `Content-Security-Policy: sandbox`, `Content-Disposition: attachment`,
- valider les magic bytes du fichier (pas seulement le MIME déclaré).

### C4. CSP permissive (`unsafe-inline` sur `script-src`)

**Fichier :** [server/src/index.ts](server/src/index.ts#L48-L60)

`script-src 'self' 'unsafe-inline'` annule une partie significative de la défense XSS. Combiné avec C3 ou un contournement de DOMPurify (voir H1), ça facilite l'exploitation.

**Correctif :** passer à un nonce/hash par build, retirer `unsafe-inline` sur `script-src`. `style-src 'unsafe-inline'` peut rester pour Tailwind runtime mais devrait idéalement aussi disparaître.

---

## 🟠 Élevées

### H1. XSS potentielle — signatures et brouillon dans `ComposeModal`

**Fichiers :**
- [client/src/components/mail/ComposeModal.tsx](client/src/components/mail/ComposeModal.tsx#L570)
- [client/src/components/mail/ComposeModal.tsx](client/src/components/mail/ComposeModal.tsx#L577)
- [client/src/components/mail/SignatureModals.tsx](client/src/components/mail/SignatureModals.tsx#L564)

`dangerouslySetInnerHTML` est utilisé sur `bodyHtml` (brouillon) et `selectedAccount.signature_html` **sans passage par DOMPurify**. La signature des comptes partagés est fournie par l'admin via [server/src/routes/admin.ts](server/src/routes/admin.ts#L380-L391) avec un simple `signatureHtml: z.string().optional()` — aucune validation HTML. Un admin malveillant ou compromis injecte du JS qui s'exécute chez tous les utilisateurs rattachés.

**Correctif :** passer systématiquement par `DOMPurify.sanitize(...)` avec la même whitelist que `MessageView`.

### H2. JWT stocké en `localStorage` + TTL 30 jours

**Fichiers :**
- [client/src/stores/authStore.ts](client/src/stores/authStore.ts#L28)
- [server/src/middleware/auth.ts](server/src/middleware/auth.ts#L20)

`localStorage` est exposé à toute XSS. Avec un TTL de 30 jours et **aucun mécanisme de révocation** (pas de `jti`, pas de denylist), un vol de token donne accès pendant un mois. La session cookie existe déjà (`httpOnly`) — c'est elle qu'il faut privilégier. Le JWT n'est justifié que pour les usages PWA offline.

**Correctif :**

- réduire le TTL (ex. 1 h) avec refresh token,
- ajouter un registre de tokens révocables (table `revoked_tokens` + `jti`),
- ou déplacer le token dans un cookie `httpOnly; Secure; SameSite=Strict`.

> **✅ Résolu (avril 2026)** — mis en œuvre :
> - Access token JWT réduit à 15 minutes ([server/src/services/deviceSessions.ts](server/src/services/deviceSessions.ts)).
> - Refresh token aléatoire 256 bits **hashé SHA-256** en base (`device_sessions`), livré dans un cookie `wm_refresh` `httpOnly; SameSite=Strict; Secure` (prod), scope `/api/auth`, TTL glissant 90 j, **rotation à chaque usage**.
> - Détection de rejeu : un refresh déjà révoqué purge toute la chaîne du device.
> - Payload d'access token porte un `sid` vérifié contre `device_sessions` à chaque requête → révocation immédiate côté serveur (`DELETE /api/auth/devices/:id`).
> - 2FA WebAuthn optionnelle (Touch ID / Face ID / Windows Hello) + déverrouillage biométrique local de la PWA après 7 j d'inactivité.
> - Fallback legacy accepté transitoirement pour ne pas invalider les sessions existantes.

### H3. Absence totale de rate-limiting

**Fichier :** [server/src/index.ts](server/src/index.ts) — aucun `express-rate-limit` ni équivalent.

Endpoints vulnérables au brute-force et au DoS applicatif :

- `/api/auth/login`, `/api/auth/register`,
- `/api/plugins/:id/execute`,
- upload de branding (5 MB × N),
- `express.json({ limit: '25mb' })` sur toutes les routes.

Combiné avec `password.min(6)` côté login ([server/src/routes/auth.ts](server/src/routes/auth.ts#L11)), c'est exploitable.

**Correctif :** `express-rate-limit` sur `/api/auth/*` (ex. 5/min/IP), sur endpoints coûteux, verrouillage progressif par compte après N échecs.

> **✅ Partiellement résolu (mai 2026)** — verrouillage progressif par compte implémenté (v1.10.0) :
> - Compteur `failed_attempts` et `locked_until` sur la table `users`.
> - Verrouillage automatique après N tentatives (configurable, défaut 3), durée configurable (défaut 30 min, 0 = permanent).
> - Liste noire d'IPs bloquant immédiatement toute tentative de connexion.
> - Liste blanche d'IPs jamais verrouillées (trace conservée + alerte email optionnelle).
> - Historique complet dans `login_attempts`.
> - Déblocage admin depuis Admin → Utilisateurs.
>
> **Reste à faire** : `express-rate-limit` au niveau HTTP (contre les attaques par IP sur `/api/auth/register`, les endpoints coûteux et le DoS mémoire via `express.json({ limit: '25mb' })`). Le verrouillage applicatif par compte est en place, mais sans throttle HTTP un attaquant peut toujours saturer l'infrastructure avec de nombreux comptes différents.

### H4. Politique de mot de passe trop faible

**Fichier :** [server/src/routes/auth.ts](server/src/routes/auth.ts#L9-L17)

`login` accepte `min(6)`, `register` `min(8)`, aucune contrainte de complexité, pas de vérif contre listes compromises.

**Correctif :** minimum 10–12 caractères + `zxcvbn` ou HIBP k-anonymity (`api.pwnedpasswords.com/range/...`).

### H5. Fuite d'informations via `error.message`

De nombreux handlers renvoient `res.status(500).json({ error: error.message })` :

- [server/src/routes/accounts.ts](server/src/routes/accounts.ts#L164)
- [server/src/routes/branding.ts](server/src/routes/branding.ts#L103)
- [server/src/routes/plugins.ts](server/src/routes/plugins.ts#L60)
- etc.

En cas d'erreur Postgres, cela expose le schéma, les noms de colonnes, les contraintes.

**Correctif :** middleware d'erreur centralisé qui logge côté serveur (`logger.error`) et renvoie un message générique au client.

### H6. WebSocket — JWT non borné, échec silencieux

**Fichier :** [server/src/services/websocket.ts](server/src/services/websocket.ts#L18-L34)

`jwt.verify` est dans un `try` externe : si l'auth échoue, la socket **reste ouverte** en attente d'un nouveau message et peut spammer jusqu'à déconnexion. Pas de timeout d'auth. Réutilise la même clé que les sessions (cf. C1).

**Correctif :**

- fermer la socket après N échecs d'auth,
- timeout de handshake (ex. 10 s),
- clé JWT dédiée.

---

## 🟡 Moyennes

### M1. Pas de protection CSRF explicite

Reposant uniquement sur `SameSite=Lax` ([server/src/index.ts](server/src/index.ts#L86)). Convient pour POST cross-origin moderne, mais un token CSRF double-submit serait plus robuste pour les routes basées sur la session cookie.

### M2. HSTS et CSP incomplets

`helmet` est chargé mais [server/src/index.ts](server/src/index.ts#L37-L44) désactive HSTS. Le CSP manuel n'a pas de `frame-ancestors 'self'` ni d'`object-src 'none'`.

Risque : clickjacking et downgrade TLS.

**Correctif :**

- activer HSTS (`max-age=31536000; includeSubDomains`) en prod,
- ajouter `frame-ancestors 'self'` et `object-src 'none'` à la CSP.

### M3. Register — premier utilisateur devient admin

**Fichier :** [server/src/routes/auth.ts](server/src/routes/auth.ts#L83-L99)

Si le déploiement expose `/api/auth/register` avant la création du compte bootstrap, un attaquant externe peut prendre l'admin. Combiné à l'absence de rate-limit (H3), la course est ouverte.

**Correctif :** désactiver l'endpoint tant qu'un token d'init (`BOOTSTRAP_TOKEN`) n'est pas fourni, ou provisionner l'admin par CLI.

### M4. CORS en développement — `localhost:5173` + `credentials: true`

**Fichier :** [server/src/index.ts](server/src/index.ts#L63-L66)

Acceptable en dev. S'assurer que `NODE_ENV=production` est bien fixé en prod, sinon tout site hébergé sur `localhost:5173` (extension, dev serveur tiers) peut dialoguer avec les cookies.

### M5. Plugins — `require()` dynamique

**Fichier :** [server/src/plugins/manager.ts](server/src/plugins/manager.ts#L42-L45)

Le chemin d'entrée est lu en BDD et chargé via `require(path.join(process.cwd(), 'plugins', row.name))`. Installable par un admin via [server/src/routes/plugins.ts](server/src/routes/plugins.ts#L85) avec `entryPoint` arbitraire — c'est une **RCE admin-authentifiée**. Acceptable si c'est une feature assumée, mais à durcir :

- valider `row.entry_point` (regex `^[a-z0-9_\-/]+\.js$`, refus de `..`),
- exécuter le plugin dans un `vm` / worker avec permissions limitées,
- interdire la modification d'`entryPoint` via API (à packager hors BDD).

### M6. `express.json({ limit: '25mb' })` global

**Fichier :** [server/src/index.ts](server/src/index.ts#L67-L68)

25 MB sur tous les endpoints, sans rate-limit → DoS mémoire facile.

**Correctif :** limite globale à 1 MB, appliquer 25 MB uniquement aux routes d'envoi de mail / upload avec middleware dédié.

### M7. TLS IMAP/SMTP — vérification implicite

**Fichier :** [server/src/services/mail.ts](server/src/services/mail.ts#L46)

Utilise `secure: true` mais aucun `tls: { rejectUnauthorized: true, servername: host }` explicite. Selon la version de `nodemailer` / `imapflow` et les options, certains cas acceptent des certificats auto-signés.

**Correctif :** forcer explicitement `tls: { rejectUnauthorized: true, servername: host, minVersion: 'TLSv1.2' }`.

### M8. Session cookie — `trust proxy` manquant

**Fichier :** [server/src/index.ts](server/src/index.ts#L82)

`cookie.secure: production` est bien défini mais pas d'`app.set('trust proxy', 1)`. Derrière un reverse proxy HTTPS, Express peut considérer la requête HTTP → le cookie n'est pas posé. Problème fonctionnel **et** bascule silencieuse sur JWT `localStorage` (cf. H2).

**Correctif :** `app.set('trust proxy', 1)` en production.

---

## 🟢 Faibles / bonnes pratiques

- **Admin logs filter** ([server/src/routes/admin.ts](server/src/routes/admin.ts#L684-L689)) : concaténation dans clauses `WHERE` mais avec `$paramIndex` correctement incrémentés — OK.
- **Keystore client** ([client/src/crypto/keystore.ts](client/src/crypto/keystore.ts)) : PBKDF2 310 000 itérations, AES-GCM 256, IV/salt aléatoires par clé — solide. Ajouter un compteur anti-bruteforce côté UI avant déchiffrement serait un plus.
- **Feed calendrier public** ([server/src/routes/calendarPublic.ts](server/src/routes/calendarPublic.ts)) : jeton opaque, permissions appliquées — bien. Vérifier que `public_token` est généré avec `crypto.randomBytes(32).toString('hex')` ou équivalent lors de sa création.
- **Logger Pino** : vérifier qu'aucun champ sensible (`password`, `Authorization`, `token`) n'est loggé via `req.body` en niveau debug.
- **Session table auto-créée** ([server/src/index.ts](server/src/index.ts#L73)) : en prod, préférer une migration contrôlée.

---

## Correctifs prioritaires recommandés

1. **C1** — refuser le démarrage en prod sans secrets (`SESSION_SECRET`, `ENCRYPTION_KEY`, `JWT_SECRET`, `DATABASE_URL`).
2. **C2** — migrer `encryption.ts` vers un salt aléatoire par secret (ou `libsodium`).
3. **H3** — `express-rate-limit` sur `/api/auth/*` et `/api/plugins/*/execute`.
4. **H1** — sanitize systématique des `signature_html` et `bodyHtml` côté compose.
5. **C3 + C4** — bannir SVG, durcir CSP (retirer `unsafe-inline` sur `script-src`).
6. **H5** — pipeline d'erreur centralisé qui masque `error.message`.
7. **H2** — réduire TTL JWT + refresh token, ou cookie `httpOnly`.
8. **M8** — `app.set('trust proxy', 1)` en prod.

---

## Checklist de vérification après corrections

- [ ] `NODE_ENV=production` + absence de `SESSION_SECRET` → serveur refuse de démarrer.
- [ ] Deux instances avec même `ENCRYPTION_KEY` et bases différentes produisent des ciphertexts **différents** pour la même valeur.
- [ ] Upload d'un SVG avec `<script>` → rejeté ou servi avec `Content-Disposition: attachment`.
- [ ] 10 tentatives `/api/auth/login` en < 1 min depuis une même IP → 429.
- [ ] Compose preview avec signature contenant `<img src=x onerror=...>` → pas d'exécution JS.
- [ ] Réponse 500 en cas d'erreur BDD → message générique, pas de détail Postgres.
- [ ] Token JWT expiré après la durée configurée, révoqué lors du logout.
- [ ] WebSocket sans message `auth` pendant 10 s → socket fermée.
