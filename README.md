# Belin-Pok Enterprise

Inventory, point of sale, online shop and owner reporting for a menswear
retail and wholesale shop -- caps, t-shirts, jackets, sweatshirts, shorts,
joggers, boxers, socks, and similar items.

What's live today:

- **Admin & inventory system** (admin.belpok.xyz) -- stock by size and
  colour, fast stock receiving, a point-of-sale till (retail, wholesale and
  pack prices, split payments, buying on account, busy-hour shortcuts),
  online orders, customers and credit, staff with combinable roles, and
  owner reporting: sales reports, a sales journal and an activity log.
- **Web storefront** (belpok.xyz) -- browsing, search, cart, guest or
  account checkout for pickup or delivery, order history. Online prices
  carry a configurable markup over in-store prices.
- **Phone app** (Flutter) -- the storefront for Android/iOS, not yet
  published to the stores.

Not yet: online payment (orders are confirmed and paid by arrangement with
the customer) and self-serve wholesale ordering. The full guide for the
owner, staff and maintainers is `docs/Belin-Pok-Handbook.pdf`.

## Tech stack

| Layer                     | Choice                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Backend API               | Python + FastAPI                                                                                                        |
| Database                  | PostgreSQL (Railway Postgres)                                                                                          |
| Auth                      | Built into the API: hashed passwords, short-lived access tokens + rotating refresh tokens                              |
| Photo storage             | S3-compatible bucket (Railway Bucket), served through the API                                                          |
| Web storefront            | Next.js (React, server-rendered), Tailwind CSS -- `apps/web/`                                                          |
| Admin / inventory system  | React + Vite, Tailwind CSS, TanStack Query -- `apps/admin-web/`                                                        |
| Phone app (storefront)    | Flutter, for the Android/iOS release -- `apps/storefront/`                                                             |
| Hosting                   | Railway -- API, database, bucket, storefront and admin                                                                 |
| Source control / CI       | GitHub + GitHub Actions                                                                                                  |

## Repo layout

```text
apps/web/            Web storefront (Next.js) -- belpok.xyz
apps/admin-web/      Admin & inventory system (React + Vite) -- admin.belpok.xyz
apps/storefront/     Flutter storefront, for the Android/iOS app
packages/belpok_core/ Dart package for the Flutter app: models, API client + sign-in session, theme
services/api/         FastAPI backend
services/api/migrations/ SQL migrations (schema + seed data), applied by app/migrate.py
deploy/               Shared Caddy config that serves the built web apps
.github/workflows/    CI/CD
```

## Prerequisites

- PostgreSQL 15+ for local development (e.g. `brew install postgresql`)
- Python 3.12+
- Node.js 22+ (the web storefront and the admin)
- Flutter SDK, stable channel (only for the phone app)

## Database & migrations

All schema changes live as plain SQL files in `services/api/migrations/`,
applied in filename order by a small runner, `python -m app.migrate`. It
records what it applied in a `schema_migrations` table, so re-running it is
a no-op, and it runs automatically before every Railway deploy (the
`preDeployCommand` in `services/api/railway.json`) -- a deploy whose code
needs a new column can't go live before the column exists, and a failing
migration stops the deploy. The baseline product categories are seeded by
a migration too, so a fresh database is ready to use straight away.

```bash
createdb belpok
cd services/api
DATABASE_URL=postgresql+asyncpg://localhost/belpok JWT_SECRET=dev python -m app.migrate
```

To change the schema, add a new timestamped file
(`YYYYMMDDHHMMSS_description.sql`) rather than editing an existing one --
once a migration has reached a live database it's history, same as a git
commit.

### Roles & authorization

Nothing connects to the database except the API, so the API is the
authorization layer: `app/deps.py` resolves each request's signed-in user
to a `staff` row (roles `owner`, `inventory_manager`, `order_fulfillment`,
`viewer`, checked per endpoint with `require_role`) or a `customers` row.
Signing in itself -- passwords, sessions, invite and reset links -- is
`app/routers/auth.py`; see its module docstring for how sessions work.

## Backend: FastAPI (`services/api/`)

Talks to Postgres directly via SQLAlchemy (async, asyncpg driver), and
issues and verifies its own sign-in tokens (`app/security.py`).

```bash
cd services/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # includes requirements.txt + pytest/ruff

cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET at minimum
python -m app.migrate  # create/update the schema

uvicorn app.main:app --reload   # http://localhost:8000, docs at /docs
```

```bash
ruff check .          # lint
python -m pytest -v   # needs DATABASE_URL pointed at a Postgres that
                       # `python -m app.migrate` has been run against (CI
                       # does exactly that, against a plain Postgres
                       # container). Must be `python -m pytest`, not plain
                       # `pytest` -- the latter doesn't add the cwd to
                       # sys.path, so `app` fails to import.
```

Locally, with no `S3_*` settings, product photos are kept in memory (lost
on restart) -- fine for development, and refused anywhere `ENVIRONMENT`
isn't `local`. Without `RESEND_API_KEY`, invite/reset emails aren't sent;
an owner can still copy an invite link from the Staff screen.

### The first owner account

A brand-new database has no users, and staff are normally invited by an
owner -- so the first owner is created from a shell with the API's
environment. Locally:

```bash
python -m app.cli create-owner --username admin --password admin
```

In production, run it inside the API container (the database is only
reachable on Railway's private network, so `railway run` from your own
machine can't connect). The `LD_LIBRARY_PATH` line copies the running
app's library path into the SSH session -- without it, SQLAlchemy's async
support fails to load (`libstdc++.so.6: cannot open shared object file`):

```bash
railway ssh --service belin-pok -- sh -c 'export "$(tr "\0" "\n" < /proc/1/environ | grep "^LD_LIBRARY_PATH=")" && cd /app && /opt/venv/bin/python -m app.cli create-owner --username admin --password admin'
```

That account must choose a new password the first time it signs in
(pass `--no-force-change` to skip that). Everyone else is invited from the
admin app's Staff screen.

## Web storefront: Next.js (`apps/web/`)

The shop customers see at belpok.xyz. Catalogue pages (home, shop,
categories, products) are rendered on the server, so they're real HTML:
search engines index them, and links shared on WhatsApp/Facebook show the
product's photo and price. Cart, checkout and accounts run in the browser.

```bash
cd apps/web
npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 npm run dev   # http://localhost:3000
npm run typecheck
```

Settings are build-time environment variables (compiled in, so changing
one means a rebuild):

| Variable | |
| --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | the API (required) |
| `NEXT_PUBLIC_SITE_URL` | the shop's own address, for canonical links and the sitemap |
| `NEXT_PUBLIC_CONTACT_PHONE`, `NEXT_PUBLIC_CONTACT_WHATSAPP`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_SHOP_ADDRESS` | optional; shown in the footer and on the wholesale page -- anything unset is simply left out |

Previewing against an API on your own machine (`127.0.0.1`), also set
`NEXT_IMAGE_ALLOW_LOCAL_IP=1` at build time -- Next's image optimiser
refuses local addresses otherwise. Never set it for a deployed build.

## Admin: React (`apps/admin-web/`)

The admin and inventory system at admin.belpok.xyz: dashboard, point of
sale, online orders, customers and credit, products, inventory, receiving
stock, categories and staff. What each person sees follows their role
(`src/lib/auth.tsx`), matching what the API allows.

```bash
cd apps/admin-web
npm install
VITE_API_BASE_URL=http://localhost:8000 npm run dev   # http://localhost:5173
npm run build                                         # type-check + production build
```

`VITE_API_BASE_URL` (required) and `VITE_STOREFRONT_URL` (for "View on the
shop" links) are build-time settings. Sign in with the owner account from
"The first owner account" above, then invite everyone else from Staff.

## Phone app: Flutter (`apps/storefront/`)

The storefront as an Android/iOS app (the website is `apps/web`). Browsing,
cart, guest/signed-in checkout and order history, against the same API.

```bash
cd apps/storefront
flutter pub get
flutter run -d <device-id> --dart-define=API_BASE_URL=http://localhost:8000
```

Customers create an account (name, email, password) from the sign-in
screen, which creates their `customers` record at the same time.

### Running on a phone (Android/iOS)

`android/` and `ios/` are real, configured Flutter platform projects (app
ID / bundle ID `com.belpok.storefront` on both, branded launcher icon and
launch screen already in place) -- this isn't scaffolding you need to set
up, just point `flutter run` at a device:

```bash
flutter devices                          # lists connected phones + running emulators/simulators
flutter emulators                        # lists available Android emulators / the iOS Simulator
flutter emulators --launch <emulator-id> # boot one

flutter run -d <device-id> --dart-define=API_BASE_URL=http://localhost:8000
```

**Android:** with the Flutter SDK and Android toolchain installed
(`flutter doctor` should show both green), an emulator or a phone with USB
debugging enabled just works with the command above -- no extra setup.

**iOS: needs a Mac with Xcode.** Not something this repo or an AI agent can
do on your behalf -- do this once, locally, at build time:

1. Open `apps/storefront/ios/Runner.xcworkspace` in Xcode (not
   `Runner.xcodeproj` -- CocoaPods integration needs the workspace).
2. Select the `Runner` target → **Signing & Capabilities** → sign in with
   your Apple ID and pick your team. `CODE_SIGN_STYLE` is already set to
   `Automatic`, so Xcode handles provisioning-profile creation from there.
3. `flutter run -d <simulator-id>` needs no Apple ID at all -- only a
   physical device does.

### Production release builds

Both platforms need real credentials only you can provide; this repo is
set up to consume them but doesn't (and shouldn't) contain them.

**Android — signed App Bundle for Play Console:**

1. Generate an upload keystore once (keep it and its passwords somewhere
   safe -- losing it means you can never update the app again under the
   same listing):

   ```bash
   keytool -genkey -v -keystore ~/upload-keystore.jks -keyalg RSA \
     -keysize 2048 -validity 10000 -alias upload
   ```

2. Copy `apps/storefront/android/key.properties.example` to
   `apps/storefront/android/key.properties` (already gitignored) and fill
   in `storeFile` (path to the `.jks` above) and the passwords/alias.
   `android/app/build.gradle.kts` picks this up automatically -- with it
   present, release builds are signed with your upload key instead of the
   debug key.
3. `flutter build appbundle --release --dart-define=API_BASE_URL=https://api.belpok.xyz`
   → `build/app/outputs/bundle/release/app-release.aab`, ready to upload
   as a new app in Play Console (that listing itself -- store copy,
   screenshots, content rating, rollout -- is a manual Play Console step
   outside this repo).

**iOS — signed archive for App Store Connect:**

1. Needs a paid Apple Developer Program account (App Store distribution
   isn't available on a free account).
2. In Xcode (`ios/Runner.xcworkspace`), with your team selected as in
   local-run setup above, switch the scheme to **Release** and
   **Product → Archive**. Xcode's Organizer window can then validate and
   upload the archive straight to App Store Connect.
3. Alternatively, from the command line:

   ```bash
   flutter build ipa --release --dart-define=API_BASE_URL=https://api.belpok.xyz
   ```

   → `build/ios/archive/Runner.xcarchive` and an exported `.ipa` under
   `build/ios/ipa/`, uploadable via Xcode Organizer or
   `xcrun altool`/Transporter.
4. Creating the app record itself (bundle ID registration, App Store
   Connect listing, TestFlight) is a manual step in App Store Connect,
   outside this repo.

## Shared Dart package: `packages/belpok_core/`

The Flutter phone app depends on this via a local path dependency
(`path: ../../packages/belpok_core`): the `Category`/`Product`/`ProductVariant`/
`ProductImage`/`Order`/`OrderItem`/`Address` models (they mirror
`services/api/app/schemas.py` response shapes 1:1), the API client's HTTP/
error-decoding plumbing (`ApiHttp`, `ApiException`), the signed-in session
both apps use (`AuthSession`: sign in/up/out, token storage and refresh),
and the brand theme
(`AppColors`, `buildAppTheme()`) -- same brand, same products, just a
dashboard vs. a storefront layout around it. Not published anywhere; it
only ever needs to resolve inside this repo.

Nothing here issues its own top-level `flutter run`/`build` -- change it,
then `flutter pub get` in whichever app(s) you're testing to pick up the
change (a path dependency, so no version bump/publish step needed).

## Environment variables

Secrets are never committed. `services/api/.env.example` documents every
API setting; copy it to `.env` locally and fill in real values. In
production these are the Railway services' Variables (see Deployment
below), not files in the repo. The Flutter apps have no secrets -- only
`API_BASE_URL`, compiled in at build time.

## Deployment

Everything runs in one Railway project, deployed by Railway's native
GitHub integration from `main` (project `talented-adaptation`) -- `.github/workflows/*.yml` only lint/test
on PRs and never deploy, so there's exactly one deploy path.

| Domain | Railway service | Source |
| --- | --- | --- |
| `belpok.xyz`, `www.belpok.xyz` | web | `apps/web/` |
| `admin.belpok.xyz` | admin-web | `apps/admin-web/` |
| `api.belpok.xyz` | belin-pok | `services/api/` |
| -- | Postgres | Railway database |
| -- | Bucket | Railway bucket for product photos |

### API service

| Setting | Value |
| --- | --- |
| Root Directory | `services/api` |

Railway builds it with Nixpacks and reads `services/api/railway.json` for
the start command, health check, and the `preDeployCommand` that runs
migrations. Variables (see `services/api/.env.example` for all of them):

| Variable | Value |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | the Postgres service's URL with the scheme changed to `postgresql+asyncpg://` (example in `.env.example`) |
| `JWT_SECRET` | a long random string -- `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `S3_ENDPOINT_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` | from the bucket's credentials (Railway variable references work) |
| `CORS_ORIGINS` | `https://belpok.xyz,https://www.belpok.xyz,https://admin.belpok.xyz` |
| `ADMIN_APP_URL` / `STOREFRONT_URL` | `https://admin.belpok.xyz` / `https://belpok.xyz` |
| `RESEND_API_KEY`, `EMAIL_FROM` | optional -- see `.env.example` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | optional, for push notifications |

### Storefront and admin services

Railway no longer accepts a `railway.json` config file for newly created
services, so these settings live on the services themselves (Settings tab).
Both are built from a Dockerfile; Railway picks Docker automatically once
the Dockerfile path is set.

| Setting | web (storefront) | admin-web |
| --- | --- | --- |
| Source | `Kofi-Astro/belin-pok`, branch `main` | same |
| Root Directory | `apps/web` | *(blank -- repo root, for `deploy/Caddyfile`)* |
| Dockerfile path | *(default: `Dockerfile`)* | `apps/admin-web/Dockerfile` |
| Watch paths | `apps/web/**` | `apps/admin-web/**`, `deploy/**` |
| Healthcheck path | `/` | `/` |
| Variables | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SITE_URL` (+ optional contact details) | `VITE_API_BASE_URL`, `VITE_STOREFRONT_URL` |

The storefront runs as a Node server (Next.js standalone output); the
admin is static files served by Caddy, which falls back to `index.html` so
deep links like `/products/<id>` survive a reload. All their variables are
read at **build** time, so changing one needs a redeploy.

The API's `CORS_ORIGINS` must list every address the two apps are served
from, and `ADMIN_APP_URL` / `STOREFRONT_URL` are where invite and
password-reset links point -- keep both in step with the domains.

### Domains

belpok.xyz's DNS is managed in Cloudflare, which also proxies the
traffic; everything is hosted on Railway:

| Domain | Railway service |
| --- | --- |
| `belpok.xyz`, `www.belpok.xyz` | web |
| `admin.belpok.xyz` | admin-web |
| `api.belpok.xyz` | belin-pok |

Adding a domain: `railway domain <domain> --service <service> --port 8080`
prints the CNAME and `_railway-verify` TXT records to add in Cloudflare
(set up like the existing records).
Then add the address to the API's `CORS_ORIGINS` (and, for the admin or
storefront, `ADMIN_APP_URL` / `STOREFRONT_URL`, where invite and reset
links point).

### Backups

Railway's scheduled database backups need a Pro workspace, which this
isn't yet -- so back up with `scripts/backup-db.sh`, which saves a full
dump to `~/belpok-backups` on the computer running it (weekly, and before
any risky change). Restore with
`createdb belpok_restore && gunzip -c <file> | psql -d belpok_restore`.
Once on Pro, enable daily/weekly/monthly backups for `postgres-volume`.

### History

The move from Supabase and Cloudflare hosting to Railway is complete;
nothing in this repo uses Supabase, and the old Supabase project can be
deleted.
