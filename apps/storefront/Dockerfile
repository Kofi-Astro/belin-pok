# Builds apps/storefront for the web and serves it with Caddy, as a Railway
# service. The build context is the repo root (the app needs
# packages/belpok_core too) -- see the README's Deployment section for the
# Railway service settings this assumes.

FROM debian:bookworm-slim AS build

# Flutter installed from its official git tag rather than a prebuilt
# Flutter image: those lag behind releases, and both apps need the Dart
# version that ships with this exact release (pubspec: sdk ^3.12.2).
# Same release the apps are developed against; bump deliberately.
ARG FLUTTER_VERSION=3.47.7
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git unzip xz-utils \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "$FLUTTER_VERSION" https://github.com/flutter/flutter.git /opt/flutter
ENV PATH="/opt/flutter/bin:$PATH"
# Web is the only target built here, so only its artifacts are fetched
# up front (the rest are never needed in this image).
RUN flutter config --enable-web --no-analytics \
 && flutter precache --web

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
