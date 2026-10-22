-- Sign-in state for public.users (see app/routers/auth.py). Only hashes
-- of tokens are ever stored, so a leaked database dump can't be replayed
-- as anyone's session or invite link.

-- One row per signed-in device. Rotated on every refresh (the old row is
-- revoked, a new one issued); revoked on sign-out, password change, or
-- deactivating a staff member, which is what makes those take effect
-- immediately instead of whenever a long-lived token would have expired.
--
-- rotated_at is set only when a token was revoked *because it was
-- exchanged for a new one*. Seeing such a token again means it was
-- copied and replayed, which ends all of that user's sessions; a token
-- that was merely signed out (revoked_at set, rotated_at null) is just
-- refused. Without that distinction, a phone left signed in after a
-- password change would sign out the laptop that changed it.
create table public.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_refresh_tokens_user_id on public.refresh_tokens(user_id);

-- Single-use links sent by email (or shared by the owner): a staff
-- invitation, or a password reset. Both end the same way -- the holder
-- sets a password -- so they share one table, told apart by purpose.
create table public.one_time_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  purpose text not null check (purpose in ('invite', 'password_reset')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_one_time_tokens_user_id on public.one_time_tokens(user_id);

-- Failed sign-ins, for throttling password guessing per identifier (see
-- app/routers/auth.py). Successful sign-ins aren't recorded.
create table public.failed_logins (
  id bigint generated always as identity primary key,
  identifier citext not null,
  created_at timestamptz not null default now()
);

create index idx_failed_logins_identifier_created_at on public.failed_logins(identifier, created_at desc);
