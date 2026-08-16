-- CI-only stand-in for the schemas that a real Supabase project provides
-- natively (auth.*, storage.*). This is applied ONLY to the ephemeral
-- Postgres container used by the api-ci workflow, so supabase/migrations/
-- can run unmodified against something structurally close enough to real
-- Supabase to catch schema mistakes before they hit a real project. This
-- file is never applied to the actual Supabase project (that project
-- already has real auth/storage schemas) and is not a Supabase migration.

create extension if not exists pgcrypto;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- The real auth.uid() reads the caller's JWT claims (set by PostgREST).
-- Tests connect as the Postgres superuser, which bypasses RLS entirely
-- regardless of what this returns, so a constant stand-in is sufficient.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid;
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name text,
  owner uuid,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;
