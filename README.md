# Belin-Pok Enterprise

Inventory, management, and (eventually) ecommerce platform for a wholesale
men's clothing shop — caps, t-shirts, jackets, sweatshirts, shorts, joggers,
boxers, socks, and similar items.

This repo is being built in phases:

- **Phase 1** — foundations, inventory, and the admin/management dashboard.
  No public storefront, no mobile app, no payments yet.
- **Phase 2 (current)** — the public storefront (`apps/storefront/`): guest
  checkout (no account needed), retail customer accounts, product
  browsing/search, cart, and order placement. Still no payment step —
  orders land as `status='pending'` ("pending payment"); Paystack
  integration is a later phase. No wholesale ordering flow yet either —
  wholesale accounts are still approved/managed by staff in the admin app.
- Phase 3+ — wholesale self-serve ordering, payments, mobile app. The
  schema and API are deliberately left open enough to add these without a
  rewrite (e.g. `customers`, `orders`, and `order_items` already support
  both retail and wholesale, `customers.status` already models a
  pending/approved/rejected wholesale approval workflow, etc.).

## Tech stack

| Layer                     | Choice                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Backend API               | Python + FastAPI                                                                                                        |
| Database                  | PostgreSQL (Railway Postgres)                                                                                          |
| Auth                      | Built into the API: hashed passwords, short-lived access tokens + rotating refresh tokens                              |
| Photo storage             | S3-compatible bucket (Railway Bucket), served through the API                                                          |
| Admin frontend             | Flutter, compiled to Flutter Web for this phase                                                                         |
| Storefront frontend        | Flutter, compiled to Flutter Web for this phase                                                                         |
| Hosting                    | Railway -- API, database, bucket, and both web apps                                                                     |
| Source control / CI       | GitHub + GitHub Actions                                                                                                  |

## Repo layout

```text
apps/admin/          Flutter Web admin dashboard (+ Dockerfile/railway.json for hosting)
apps/storefront/      Flutter Web public storefront (+ Dockerfile/railway.json for hosting)
packages/belpok_core/ Shared Dart package: models, API client + sign-in session, theme
services/api/         FastAPI backend
services/api/migrations/ SQL migrations (schema + seed data), applied by app/migrate.py
deploy/               Shared Caddy config that serves the built web apps
.github/workflows/    CI/CD
```

## Prerequisites

- PostgreSQL 15+ for local development (e.g. `brew install postgresql`)
- Python 3.12+
- Flutter SDK (stable channel) with web support enabled (`flutter config --enable-web`)

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
environment (locally, or `railway run` / a Railway service shell):

```bash
python -m app.cli create-owner --username admin --password admin
```

That account must choose a new password the first time it signs in
(pass `--no-force-change` to skip that). Everyone else is invited from the
admin app's Staff screen.

## Admin app: Flutter (`apps/admin/`)

One codebase, every platform Flutter supports -- Web (the deployed target
for now), plus Android, iOS, macOS, Windows, and Linux for local use on a
phone/tablet at the shop counter or testing on a dev machine. `flutter
devices` lists what's available to run on.

```bash
cd apps/admin
flutter pub get

flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8000   # web
flutter run -d macos --dart-define=API_BASE_URL=http://localhost:8000    # macOS
flutter run -d <device-id> --dart-define=API_BASE_URL=http://localhost:8000  # a connected phone/simulator
```

`API_BASE_URL` is the only setting (`lib/config.dart`) -- sign-in, data
and product photos all go through the API.

Only the Web build is wired up for deployment (Railway, see below) --
Android/iOS need signing + app store setup and Windows/Linux desktop can
only be built on their own OS (Flutter doesn't cross-compile desktop
targets), so those stay local-only builds until/unless that's worth setting
up.

Sign in with the owner account from "The first owner account" above,
then invite everyone else from the Staff screen.

## Storefront app: Flutter (`apps/storefront/`)

The public storefront -- browsing, cart, guest/signed-in checkout, order
history. Same multi-platform Flutter setup as the admin app (Web is the
deployed target); unlike admin, most of it works with no sign-in at all --
only the account/order-history screen requires one.

```bash
cd apps/storefront
flutter pub get

flutter run -d chrome --dart-define=API_BASE_URL=http://localhost:8000   # web
```

Same `API_BASE_URL` override as the admin app. Customers create an
account (name, email, password) from the sign-in screen, which creates
their `customers` record at the same time.

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

Both Flutter apps depend on this via a local path dependency
(`path: ../../packages/belpok_core` in each `pubspec.yaml`) for the pieces
they genuinely share: the `Category`/`Product`/`ProductVariant`/
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
GitHub integration from `main` -- `.github/workflows/*.yml` only lint/test
on PRs and never deploy, so there's exactly one deploy path.

| Domain | Railway service | Source |
| --- | --- | --- |
| `belpok.xyz`, `www.belpok.xyz` | storefront | `apps/storefront/` |
| `admin.belpok.xyz` | admin | `apps/admin/` |
| `api.belpok.xyz` | api | `services/api/` |
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

### Admin and storefront services

Each is built from its own Dockerfile (Flutter SDK to compile, Caddy to
serve -- see `deploy/Caddyfile`). The Docker build needs
`packages/belpok_core` as well as the app, so these services build from
the repo root:

| Setting | admin | storefront |
| --- | --- | --- |
| Root Directory | *(blank -- repo root)* | *(blank -- repo root)* |
| Config file path | `apps/admin/railway.json` | `apps/storefront/railway.json` |
| Variable `API_BASE_URL` | `https://api.belpok.xyz` | `https://api.belpok.xyz` |

`API_BASE_URL` is read at **build** time (it's compiled into the app), so
changing it needs a redeploy.

### Switching over from Supabase + Cloudflare (one-time)

1. Create the Railway services above (Postgres, Bucket, api, admin,
   storefront) and set their variables. Deploy; the API's pre-deploy step
   builds the schema.
2. Create the first owner: `railway run --service api python -m app.cli create-owner --username admin --password admin`
   (or from the api service's shell).
3. Test on the raw `*.up.railway.app` URLs: sign in as admin (you'll be
   asked for a new password), receive an item with a photo, publish it,
   check it on the storefront, place a test order.
4. **DNS (owner's step):** add `api`, `admin`, `belpok.xyz` and `www` as
   custom domains on their Railway services, and update the DNS records
   wherever belpok.xyz's DNS is managed to the targets Railway shows.
   Then remove the custom domains from the two Cloudflare Workers
   projects, and delete `apps/*/wrangler.jsonc` once nothing deploys
   there any more.
5. **Delete the Supabase project (owner's step)** once everything above
   works -- nothing in this repo uses it any more.
