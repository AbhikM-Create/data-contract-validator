-- The parts of Supabase that schema.sql relies on, reproduced on a plain
-- Postgres so its row-level security can be tested without a project:
--
--   * roles `anon` and `authenticated` — every request runs as one of them
--   * `auth.users` — the accounts a row's user_id refers to
--   * `auth.uid()` — the signed-in user, read from the request's JWT claims,
--     exactly as Supabase defines it
--   * the default grants Supabase gives both roles on public tables, so that
--     RLS, not a missing GRANT, is what the tests exercise
--
-- What this cannot reproduce is Supabase's own configuration — email
-- confirmation, token lifetimes, the API gateway. It tests the policies, which
-- are the whole access model; those settings are checked in the project.

create role anon nologin;
create role authenticated nologin;

create schema auth;
grant usage on schema auth to anon, authenticated;

-- The columns of Supabase's auth.users that schema.sql reads.
create table auth.users (id uuid primary key, email varchar(255), email_confirmed_at timestamptz);

create function auth.uid() returns uuid
language sql stable
as $$
  select nullif(
    coalesce(current_setting('request.jwt.claim.sub', true),
             (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')),
    ''
  )::uuid
$$;

grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
