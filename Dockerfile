# syntax=docker/dockerfile:1.7
# Chandelier — build multi-stage, images finales minimales et non-root.
# Cibles : "api" (Node 22) et "web" (Caddy + SPA). Multi-architecture (amd64, arm64/Apple Silicon).

ARG NODE_IMAGE=node:22-bookworm-slim
ARG CADDY_IMAGE=caddy:2-alpine

# ── Dépendances complètes (build) ────────────────────────────────────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit

# ── Build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY tsconfig.base.json ./
COPY prisma ./prisma
COPY packages ./packages
COPY apps ./apps
RUN npx prisma generate \
 && npm run build -w @chandelier/api \
 && npm run build -w @chandelier/web

# ── Dépendances de production uniquement ─────────────────────────────────────
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --omit=dev --workspace @chandelier/api --include-workspace-root=false
COPY prisma ./prisma
RUN npx prisma generate

# ── Image API ────────────────────────────────────────────────────────────────
FROM ${NODE_IMAGE} AS api
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/documents && chown node:node /data/documents
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=prod-deps --chown=root:root /app/prisma ./prisma
COPY --from=build --chown=root:root /app/apps/api/dist ./dist
COPY --chown=root:root package.json ./
COPY --chown=root:root docker/api-entrypoint.sh /usr/local/bin/api-entrypoint.sh
RUN chmod 0755 /usr/local/bin/api-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/api-entrypoint.sh"]

# ── Image web (Caddy : SPA + reverse proxy) ──────────────────────────────────
FROM ${CADDY_IMAGE} AS web
# Système de fichiers en lecture seule : l'état éventuel de Caddy va dans /tmp (tmpfs).
ENV XDG_DATA_HOME=/tmp/caddy-data XDG_CONFIG_HOME=/tmp/caddy-config
RUN addgroup -S chandelier && adduser -S -G chandelier -H chandelier
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
USER chandelier
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
