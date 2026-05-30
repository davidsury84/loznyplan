# Alternativa k Nixpacks (Railway default) — Dockerfile pro reprodukovatelnost.
# Railway si vybere automaticky: pokud existuje Dockerfile, použije ho; jinak Nixpacks.

FROM node:20-alpine

WORKDIR /app

# Závislosti (cache layer)
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Aplikace
COPY server.js ./
COPY lozny-plan-v3-stohovani.html ./
COPY elkoplast-lozny-plan-embed.html ./

# Bezpečnost — nespouštět jako root
USER node

# Railway přidělí PORT dynamicky (env var). 3000 je default pro lokální dev.
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Health check (Docker-level, Railway má vlastní v railway.json)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

CMD ["node", "server.js"]
