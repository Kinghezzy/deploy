# Backend Dockerfile
# Multi-stage build for the SynapsVault Node.js/TypeScript backend
# (https://github.com/SynapsVault/backend). The build context is a checkout of
# that repository; this file lives in the deploy repo.
#
# Targets:
#   runtime (default)  API server: node dist/index.js on $PORT (3000)
#   migrate            One-shot Drizzle migrations (used as a k8s initContainer)

ARG NODE_VERSION=22
# The backend's dependency tree has unresolved peer conflicts (e.g.
# x402-stellar wants @stellar/stellar-sdk@^12 while the app uses ^15), so npm
# needs --legacy-peer-deps until that is fixed upstream
# (tracked in https://github.com/SynapsVault/backend/issues). Override with
# --build-arg NPM_FLAGS= once the upstream peer dependency issue is resolved.
ARG NPM_FLAGS=--legacy-peer-deps
# Once upstream peer dependency conflicts (x402-stellar vs @stellar/stellar-sdk)
# are resolved, drop --legacy-peer-deps by passing --build-arg NPM_FLAGS="" or
# leaving NPM_FLAGS empty when the lockfile is clean.
ARG NPM_FLAGS=""

# ---------- Stage 1: All dependencies (build + migrate tooling) ----------
FROM node:${NODE_VERSION}-alpine AS deps
ARG NPM_FLAGS
WORKDIR /app

# Build tooling for any native modules
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
# Skip lifecycle scripts: the postinstall symlinks packages/registry-client,
# which is not copied yet. It is vendored explicitly below instead.
# `npm ci` needs a committed lockfile; fall back to `npm install` without one.
RUN if [ -f package-lock.json ]; then npm ci --ignore-scripts ${NPM_FLAGS} || npm ci --ignore-scripts --legacy-peer-deps; \
    else npm install --ignore-scripts --no-audit --no-fund ${NPM_FLAGS} || npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps; fi

# ---------- Stage 2: Production-only dependencies ----------
FROM node:${NODE_VERSION}-alpine AS prod-deps
ARG NPM_FLAGS
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev --ignore-scripts ${NPM_FLAGS} || npm ci --omit=dev --ignore-scripts --legacy-peer-deps; \
    else npm install --omit=dev --ignore-scripts --no-audit --no-fund ${NPM_FLAGS} || npm install --omit=dev --ignore-scripts --no-audit --no-fund --legacy-peer-deps; fi

COPY packages/registry-client ./packages/registry-client
RUN mkdir -p node_modules/@synapsvault && \
    cp -R packages/registry-client node_modules/@synapsvault/registry-client

# ---------- Stage 3: Build ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p node_modules/@synapsvault && \
    rm -rf node_modules/@synapsvault/registry-client && \
    cp -R packages/registry-client node_modules/@synapsvault/registry-client

# The upstream build script tolerates type errors (`|| true`), so fail here if
# it did not actually produce the server entrypoint.
RUN npm run build && test -f dist/index.js

# ---------- Target: migrate ----------
FROM build AS migrate
ENV NODE_ENV=production
USER node
CMD ["npx", "--no-install", "drizzle-kit", "migrate"]

# ---------- Target: runtime (default) ----------
FROM node:${NODE_VERSION}-alpine AS runtime
WORKDIR /app

# tini runs as PID 1 so it reaps zombies and forwards SIGTERM/SIGINT to Node,
# letting the server shut down gracefully during rollouts instead of being
# killed abruptly.
RUN apk add --no-cache tini

ENV NODE_ENV=production \
    PORT=3000

# Copy production dependencies and compiled output
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

# Run as the unprivileged user that ships with the node image
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1

# tini as PID 1 forwards signals to node and reaps orphaned children.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
