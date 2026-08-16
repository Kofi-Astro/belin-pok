# Belin-Pok Enterprise

Inventory, management, and (eventually) ecommerce platform for a wholesale
men's clothing shop — caps, t-shirts, jackets, sweatshirts, shorts, joggers,
boxers, socks, and similar items.

This repo is being built in phases:

- **Phase 1 (current)** — foundations, inventory, and the admin/management
  dashboard. No public storefront, no mobile app, no payments yet.
- Phase 2+ — public storefront, wholesale ordering, payments, mobile app.
  The schema and API are deliberately left open enough to add these without
  a rewrite (e.g. `customers`, `orders`, and `order_items` already support
  both retail and wholesale, `customers.status` already models a
  pending/approved/rejected wholesale approval workflow, etc.).

## Tech stack

| Layer                      | Choice                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| Backend API                | Python + FastAPI                                                 |
| Database / Auth / Storage  | Supabase (Postgres + Row Level Security + Auth + file storage)  |
| Admin frontend              | Flutter, compiled to Flutter Web for this phase                  |
| API hosting                | Railway                                                           |
| Web hosting                | Cloudflare Pages (`belpok.xyz`)                                  |
| Source control / CI        | GitHub + GitHub Actions                                          |

## Repo layout

```text
apps/admin/        Flutter Web admin dashboard
services/api/       FastAPI backend
supabase/           SQL migrations, RLS policies, seed data
.github/workflows/  CI/CD
```

## Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- Docker (Supabase CLI runs a local Postgres + Auth + Storage stack in containers)
- Python 3.12+
- Flutter SDK (stable channel) with web support enabled (`flutter config --enable-web`)

## Supabase: schema & local dev

All schema changes live as plain SQL files in `supabase/migrations/`, applied
in filename order. `supabase/seed.sql` seeds baseline data (the default
product categories) and runs automatically after migrations when you reset
your local database.

```bash
# One-time: log in and link this repo to the hosted Supabase project
supabase login
supabase link --project-ref rkjcrvgtbrbdzjakgtpz

# Local dev stack (Postgres, Auth, Storage, Studio) in Docker
supabase start

# Apply all migrations + seed.sql to your local database
supabase db reset

# After editing/adding a migration file, push it to the hosted project
supabase db push
```

To add a new migration, create a new timestamped file in
`supabase/migrations/` (`YYYYMMDDHHMMSS_description.sql`) rather than editing
an existing one — migrations are append-only history, same as git commits.

### Roles & Row Level Security

Every table has RLS enabled with a default-deny policy. Staff roles
(`owner`, `inventory_manager`, `order_fulfillment`, `viewer`) are read from
the `staff` table and checked via the `current_staff_role()` /
`is_staff()` SQL helper functions (see
`supabase/migrations/20260816120014_rls_policies.sql`).

RLS protects any access that goes through Supabase's own APIs (PostgREST,
the Flutter app's direct Auth/Storage calls). The FastAPI backend connects
to Postgres directly with a trusted service connection, which bypasses RLS
by design (Postgres doesn't enforce RLS against the table owner/superuser)
— so for that path, **FastAPI's own dependency checks are the real
authorization layer**, and RLS serves as a second line of defense in case
anything else ever talks to the database directly.

## Backend: FastAPI (`services/api/`)

Talks to Postgres directly via SQLAlchemy (async, asyncpg driver) rather
than through Supabase's REST API — see "Roles & Row Level Security" above
for what that means for authorization. Verifies Supabase Auth JWTs against
the project's JWKS endpoint (`SUPABASE_URL/auth/v1/.well-known/jwks.json`),
so no JWT secret needs to be configured.

```bash
cd services/api
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # includes requirements.txt + pytest/ruff

cp .env.example .env   # fill in DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY

uvicorn app.main:app --reload   # http://localhost:8000, docs at /docs
```

```bash
ruff check .          # lint
python -m pytest -v   # needs DATABASE_URL pointed at a Postgres with the schema
                       # applied (supabase start + db reset, or see
                       # tests/ci_bootstrap.sql for how CI does this against a
                       # plain Postgres container without the full Supabase stack).
                       # Must be `python -m pytest`, not plain `pytest` -- the
                       # latter doesn't add the cwd to sys.path, so `app` fails
                       # to import.
```

Staff invitations (`POST /staff/invite`) call the Supabase Auth admin API
using `SUPABASE_SECRET_KEY` — that's the only place the backend uses it;
everything else goes through `DATABASE_URL`.

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

`SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` are baked into
`lib/config.dart` as defaults (safe to ship in a client build — that's what
"publishable" means, access is still governed by RLS). Override any of the
three with `--dart-define=KEY=value` if you need to point at a different
Supabase project or API host.

Only the Web build is wired up for deployment (Cloudflare, see below) --
Android/iOS need signing + app store setup and Windows/Linux desktop can
only be built on their own OS (Flutter doesn't cross-compile desktop
targets), so those stay local-only builds until/unless that's worth setting
up.

To sign in, a Supabase Auth user needs a matching row in the `staff` table
(role `owner` to see everything, including the Staff screen). Create the
first owner manually — invite comes later, from that first owner:

```sql
-- after the person has signed up / been created in Supabase Auth
insert into public.staff (id, email, full_name, role)
values ('<their auth.users id>', 'owner@example.com', 'Their Name', 'owner');
```

## Environment variables

Secrets are never committed. Each service has its own `.env.example`
documenting what it needs; copy it to `.env` locally and fill in real
values (get them from the Supabase project dashboard). In production,
these are set as Railway/Cloudflare Pages environment variables (see
Deployment below), not files in the repo.

## Deployment

Both apps deploy via their platforms' native GitHub integration (already
linked), not GitHub Actions — `.github/workflows/api.yml` and `admin.yml`
only lint/test on PRs, so bad code doesn't land on `main`, but neither one
deploys anything. That avoids a second, conflicting deploy path fighting
the native integration.

- `services/api/` deploys via **Railway's native GitHub integration**. In
  the Railway service's settings, set:

  | Setting | Value |
  | --- | --- |
  | Root Directory | `services/api` |

  Railway auto-detects the Python app from there (`requirements.txt`,
  `Procfile`/`railway.json` for the start command and health check path).
  Set `DATABASE_URL`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY` as
  environment variables in that service's settings (same values as your
  local `.env` — see `services/api/.env.example`).

- `apps/admin/` deploys via **Cloudflare's native GitHub integration**
  (Workers Builds — the project's Deploy command is `npx wrangler deploy`,
  driven by `apps/admin/wrangler.jsonc`, which pins the assets directory to
  `build/web`). Flutter isn't auto-detected, so without a **Build command**
  set, nothing ever compiles the app — `wrangler deploy` just ships
  whatever static files it finds, which without a prior build means the
  raw, unbuilt `web/` template (this is exactly what caused the "blank
  scaffold": no `main.dart.js` was ever generated). In the project's
  settings, set:

  | Setting | Value |
  | --- | --- |
  | Root directory | `apps/admin` |
  | Build command | `git clone https://github.com/flutter/flutter.git --depth 1 -b stable _flutter && export PATH="$PATH:$(pwd)/_flutter/bin" && flutter config --enable-web && flutter pub get && flutter build web --release --dart-define=API_BASE_URL=$API_BASE_URL` |
  | Deploy command | `npx wrangler deploy` (default — leave as-is) |

  Also add an `API_BASE_URL` environment variable in that project's
  settings, set to the deployed Railway API URL (e.g.
  `https://belin-pok-api.up.railway.app`) — the build command above reads
  it. Then point `belpok.xyz` at this Worker as a custom domain from the
  Cloudflare dashboard — right now `belpok.xyz` (the bare domain) actually
  resolves to the Railway API instead, so `www.belpok.xyz` or a subdomain
  needs to be the one pointed here, with the API on something like
  `api.belpok.xyz`.
- Schema changes are **not** auto-deployed — run `supabase db push`
  yourself after a migration lands on `main`. Nothing here runs migrations
  against the real database unattended.
