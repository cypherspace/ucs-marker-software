# ── Stage 1: build everything ─────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /repo

# Cache npm install layer separately from source
COPY package*.json ./
COPY apps/marker/api/package*.json apps/marker/api/
COPY apps/marker/frontend/package*.json apps/marker/frontend/
COPY packages/shared-types/package*.json packages/shared-types/
COPY packages/shared-middleware/package*.json packages/shared-middleware/

RUN npm ci --ignore-scripts

COPY packages/ packages/
COPY apps/marker/ apps/marker/

# VITE_* vars are baked in at build time — pass as --build-arg
ARG VITE_GOOGLE_CLIENT_ID
ARG VITE_GOOGLE_API_KEY
ARG VITE_GOOGLE_PROJECT_NUMBER
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID \
    VITE_GOOGLE_API_KEY=$VITE_GOOGLE_API_KEY \
    VITE_GOOGLE_PROJECT_NUMBER=$VITE_GOOGLE_PROJECT_NUMBER

RUN npm run build --workspace=packages/shared-types \
 && npm run build --workspace=packages/shared-middleware \
 && npm run build --workspace=apps/marker/frontend \
 && npm run build --workspace=apps/marker/api

# ── Stage 2: production image ─────────────────────────────────────────────────
FROM node:20-slim

ENV NODE_ENV=production
WORKDIR /repo

# Reinstall only production deps (workspaces need all four package.json files)
COPY package*.json ./
COPY apps/marker/api/package*.json apps/marker/api/
COPY packages/shared-types/package*.json packages/shared-types/
COPY packages/shared-middleware/package*.json packages/shared-middleware/
RUN npm ci --omit=dev \
      --workspace=apps/marker/api \
      --workspace=packages/shared-types \
      --workspace=packages/shared-middleware \
      --ignore-scripts

# Built output from stage 1
COPY --from=builder /repo/packages/shared-types/dist       packages/shared-types/dist
COPY --from=builder /repo/packages/shared-middleware/dist  packages/shared-middleware/dist
COPY --from=builder /repo/apps/marker/api/dist             apps/marker/api/dist
# Frontend dist: index.ts resolves `../frontend/dist` relative to api cwd
COPY --from=builder /repo/apps/marker/frontend/dist        apps/marker/frontend/dist

WORKDIR /repo/apps/marker/api
EXPOSE 8080
CMD ["node", "dist/index.js"]
