-- Data Contract Validator — v2 increment 3 (persistence)
--
-- Run this once in the Supabase SQL editor before wiring the app up.
--
-- WHAT THIS STORES: contract SPECS — a name and the rules a human authored.
-- WHAT IT MUST NEVER STORE: the CSVs being checked, or anything derived from
-- them. The inferred baseline profile (value domains, ranges, timestamps) is
-- made of real values out of the file, so it is deliberately absent from the
-- saved shape; see src/lib/contractFile.js, which is the only thing that
-- decides what a saved contract contains.

create table if not exists public.contracts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name           text not null check (char_length(trim(name)) between 1 and 200),
  format_version integer not null default 1,
  rules          jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- One contract per name per person, so "save" can amend the contract the
  -- author already has rather than quietly creating a second one.
  unique (user_id, name),

  -- Rules must be a JSON array. Their internal shape is validated in the app
  -- (ruleIssue), which is the single definition of a well-formed rule.
  constraint rules_is_array check (jsonb_typeof(rules) = 'array')
);

comment on table public.contracts is
  'Authored contract specs (rules only). Never store raw data or inferred value domains here.';

-- Row Level Security: a contract belongs to exactly one account, and no policy
-- below can see across accounts. v3 adds sharing; until then this is the whole
-- of the access model.
alter table public.contracts enable row level security;

drop policy if exists "read own contracts"   on public.contracts;
drop policy if exists "insert own contracts" on public.contracts;
drop policy if exists "update own contracts" on public.contracts;
drop policy if exists "delete own contracts" on public.contracts;

create policy "read own contracts"
  on public.contracts for select
  using (auth.uid() = user_id);

create policy "insert own contracts"
  on public.contracts for insert
  with check (auth.uid() = user_id);

create policy "update own contracts"
  on public.contracts for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "delete own contracts"
  on public.contracts for delete
  using (auth.uid() = user_id);

create index if not exists contracts_user_updated_idx
  on public.contracts (user_id, updated_at desc);

-- updated_at has to be set by the database: a client that forgets to send it,
-- or sends a wrong clock, would make "which version is newer" unanswerable.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contracts_touch_updated_at on public.contracts;
create trigger contracts_touch_updated_at
  before update on public.contracts
  for each row execute function public.touch_updated_at();
