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
RUN mkdir -p /app/plugins /app/uploads /app/data

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "server/dist/index.js"]
