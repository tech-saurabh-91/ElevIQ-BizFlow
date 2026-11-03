# ElevIQ SFA API - production image
# Build from the repo root:  docker build -f server/Dockerfile -t eleviq-api .
FROM node:20-alpine AS deps
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY server/package*.json ./
COPY server/src ./src
# Uploads (invoices, profile photos) live here - mount a volume in compose.
RUN mkdir -p uploads logs && chown -R node:node /app
USER node
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5000/health || exit 1
CMD ["node", "src/server.js"]
