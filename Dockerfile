# ---- Build Stage ----
FROM node:20-alpine AS builder

# Chaîne de compilation des modules natifs. `kerberos` (authentification
# intégrée Windows) se compile contre GSSAPI : aucun binaire précompilé
# n'existe pour musl, il est donc bâti ici. C'est une dépendance *optionnelle* :
# si la compilation échoue, l'image se construit quand même et la fonction se
# signalera simplement indisponible dans Admin → Connexion Windows.
RUN apk add --no-cache python3 make g++ krb5-dev

WORKDIR /app

# Install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci

# Install client dependencies
COPY client/package*.json ./client/
RUN cd client && npm ci

# Copy source code
COPY server ./server
COPY client ./client

# Build client
RUN cd client && npm run build

# Build server
RUN cd server && npm run build

# Arbre de dépendances de production, résolu ici pour que l'image finale
# n'ait pas à embarquer la chaîne de compilation (le module natif est déjà bâti).
RUN cd server && npm ci --omit=dev

# ---- Production Stage ----
FROM node:20-alpine AS production

# Bibliothèques d'exécution GSSAPI, nécessaires au module `kerberos` compilé
# à l'étape précédente.
RUN apk add --no-cache krb5-libs

WORKDIR /app

# Dépendances de production déjà installées et compilées dans le builder
COPY --from=builder /app/server/package*.json ./server/
COPY --from=builder /app/server/node_modules ./server/node_modules

# Copy built server
COPY --from=builder /app/server/dist ./server/dist

# Copy built client into server's public folder
COPY --from=builder /app/client/dist ./server/dist/public

# Create directories
RUN mkdir -p /app/plugins /app/server/uploads/branding /app/server/backups /app/data

EXPOSE 3000

ENV NODE_ENV=production

# Un ticket Kerberos d'Active Directory transporte un PAC qui grossit avec le
# nombre de groupes de l'utilisateur, et l'en-tête `Authorization` dépasse alors
# la limite HTTP par défaut de 16 Ko — le symptôme est un 431 ou un 400 sans
# explication. Le reverse proxy doit être élargi de la même façon
# (`proxy_buffer_size`, `large_client_header_buffers`), voir DEPLOYMENT.md.
ENV NODE_OPTIONS=--max-http-header-size=65536

# Marque le conteneur unhealthy si l'app ne répond plus (ex : crash-loop au
# démarrage) au lieu de laisser le reverse proxy renvoyer des 502 opaques.
# start-period large : initDatabase (migrations) peut prendre du temps au boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "server/dist/index.js"]
