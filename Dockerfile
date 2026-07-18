# ---- Build Stage ----
FROM node:20-alpine AS builder

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

# ---- Production Stage ----
FROM node:20-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Copy built server
COPY --from=builder /app/server/dist ./server/dist

# Copy built client into server's public folder
COPY --from=builder /app/client/dist ./server/dist/public

# Create directories
RUN mkdir -p /app/plugins /app/server/uploads/branding /app/server/backups /app/data

EXPOSE 3000

ENV NODE_ENV=production

# Marque le conteneur unhealthy si l'app ne répond plus (ex : crash-loop au
# démarrage) au lieu de laisser le reverse proxy renvoyer des 502 opaques.
# start-period large : initDatabase (migrations) peut prendre du temps au boot.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-3000}/api/health" || exit 1

CMD ["node", "server/dist/index.js"]
