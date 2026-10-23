# The admin app (React + Vite) as a Railway service: built to static files,
# served by Caddy. Build context is the repo root, for the shared
# deploy/Caddyfile -- see the README's Deployment section.

FROM node:22-alpine AS build
WORKDIR /app
COPY apps/admin-web/package.json apps/admin-web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY apps/admin-web/ ./
# Compiled into the app at build time (Vite's import.meta.env), so changing
# either on Railway needs a redeploy.
ARG VITE_API_BASE_URL
ARG VITE_STOREFRONT_URL
RUN test -n "$VITE_API_BASE_URL" || (echo "Set VITE_API_BASE_URL on this Railway service" >&2 && exit 1)
RUN npm run build

FROM caddy:2.8.4-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
