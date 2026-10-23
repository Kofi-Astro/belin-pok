# The web storefront (Next.js) as a Railway service. Build context: this
# folder (Railway Root Directory = apps/web).
#
# NEXT_PUBLIC_* values are compiled into the site at build time, so
# changing any of them on Railway needs a redeploy. Pages that are
# prerendered fetch the catalogue from NEXT_PUBLIC_API_BASE_URL during the
# build, so the API has to be up when this builds.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_SITE_URL
# Optional shop contact details; anything unset is simply not shown.
ARG NEXT_PUBLIC_CONTACT_PHONE
ARG NEXT_PUBLIC_CONTACT_WHATSAPP
ARG NEXT_PUBLIC_CONTACT_EMAIL
ARG NEXT_PUBLIC_SHOP_ADDRESS
ENV NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_API_BASE_URL" || (echo "Set NEXT_PUBLIC_API_BASE_URL on this Railway service" >&2 && exit 1)
RUN npm run build

# Runtime: just the standalone server bundle, static assets and public
# files -- no node_modules, no source.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
USER node
# server.js listens on $PORT, which Railway provides.
CMD ["node", "server.js"]
