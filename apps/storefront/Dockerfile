# Builds apps/storefront for the web and serves it with Caddy, as a Railway
# service. The build context is the repo root (the app needs
# packages/belpok_core too) -- see apps/storefront/railway.json and the README's
# Deployment section for the Railway service settings this assumes.

# Same Flutter release the app is developed against; bump deliberately.
FROM ghcr.io/cirruslabs/flutter:3.47.7 AS build

# The API this build talks to, baked in at compile time (it's a
# --dart-define, not a runtime setting). Railway passes the service's
# API_BASE_URL variable in as this build argument.
ARG API_BASE_URL
RUN test -n "$API_BASE_URL" || (echo "Set the API_BASE_URL variable on this Railway service" >&2 && exit 1)

WORKDIR /src
COPY packages/belpok_core packages/belpok_core
COPY apps/storefront apps/storefront
WORKDIR /src/apps/storefront
RUN flutter pub get && flutter build web --release --dart-define=API_BASE_URL=$API_BASE_URL

FROM caddy:2.8.4-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/storefront/build/web /srv
