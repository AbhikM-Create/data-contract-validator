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

-- ---------------------------------------------------------------------------
-- Validation runs (final PRD, increment 4)
--
-- WHAT THIS STORES: the summary of a check — when, which contract, which file,
-- how each layer came out, and the SHAPE of each finding (layer, source, code,
-- column).
--
-- WHAT IT MUST NEVER STORE: violation messages or evidence. Those quote real
-- values out of the file — "row 21: Consumer", a median of 9,608,791.1 — and
-- storing them would put the checked data in the database while the page still
-- promises it never leaves the browser. src/lib/runRecord.js is the only thing
-- that builds these rows, and a test there asserts no value can leak through.

create table if not exists public.validation_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade default auth.uid(),

  -- Set null rather than cascade: deleting a contract must not erase the
  -- history of what it caught. contract_name is kept alongside so the run still
  -- reads correctly once the contract itself is gone.
  contract_id    uuid references public.contracts (id) on delete set null,
  contract_name  text,

  baseline_name  text,
  candidate_name text not null,
  status         text not null check (status in ('PASS', 'FAIL', 'INSUFFICIENT')),

  layers         jsonb not null default '{}'::jsonb,
  findings       jsonb not null default '[]'::jsonb,
  rules_total    integer not null default 0,
  rules_broken   integer not null default 0,
  baseline_rows  integer,
  candidate_rows integer,

  ran_at         timestamptz not null default now(),

  constraint layers_is_object  check (jsonb_typeof(layers) = 'object'),
  constraint findings_is_array check (jsonb_typeof(findings) = 'array')
);

comment on table public.validation_runs is
  'Run summaries. Never store violation messages or evidence — they quote real cell values.';

alter table public.validation_runs enable row level security;

drop policy if exists "read own runs"   on public.validation_runs;
drop policy if exists "insert own runs" on public.validation_runs;
drop policy if exists "delete own runs" on public.validation_runs;

create policy "read own runs"
  on public.validation_runs for select
  using (auth.uid() = user_id);

-- A run may name only a contract its author owns. A foreign key is checked
-- WITHOUT row-level security, so on its own it lets one account point a run at
-- another account's contract id — and when that contract is deleted, the other
-- account's history row is changed (set null) by someone it does not belong
-- to. The subquery below runs under the inserting user's own RLS, so it can
-- only ever find their own contracts. (supabase/tests/rls.sql pins this.)
create policy "insert own runs"
  on public.validation_runs for insert
  with check (
    auth.uid() = user_id
    and (
      contract_id is null
      or exists (select 1 from public.contracts c where c.id = contract_id and c.user_id = auth.uid())
    )
  );

create policy "delete own runs"
  on public.validation_runs for delete
  using (auth.uid() = user_id);

-- A run is a record of something that happened; there is no update policy,
-- because rewriting history is not an operation this app should offer.

create index if not exists validation_runs_user_ran_idx
  on public.validation_runs (user_id, ran_at desc);

-- ===========================================================================
-- Organisations, roles and sign-off (phase 3)
--
-- A migration object belongs to a programme, not a person. An organisation
-- holds people in ROLES, and the decisions they record against evidence:
--
--   admin       invites people and assigns roles
--   engineer    records definitions and submits checks for sign-off
--   data_owner  accepts or rejects a submitted check
--   auditor     reads everything, including the audit log; changes nothing
--
-- WHAT THIS STORES: who is in which organisation in which role; the rules and
-- mapping specs that were signed off (definitions — the same content a
-- migration object file holds); the SUBJECT of each submission (file names
-- and SHA-256s, fingerprints, verdicts and counts — src/lib/signoff.js is the
-- only thing that builds one, and a test proves it holds no record value);
-- each decision; and an audit log of all of it.
--
-- WHAT IT MUST NEVER STORE: files, records, or the evidence pack, which
-- quotes records. The pack stays with the person who made it; the decision
-- points at it by its reference and fingerprints.
--
-- Rules the database enforces itself, so no client can skip them:
--   * separation of duties — nobody decides on a check they submitted, or on
--     one held to definitions they recorded
--   * definitions, submissions, decisions and the audit log are append-only:
--     no update, no delete, for any role including the service role (a
--     trigger, not a policy, because the service role bypasses policies)
--   * every change is written to the audit log by a trigger, not by the app
--   * an organisation always keeps at least one admin
--
-- What it cannot stop: a database superuser can disable a trigger. Keep the
-- database's own logs if your audit needs to cover the people who run it.
-- ===========================================================================

create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(trim(name)) between 1 and 200),
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  org_id   uuid not null references public.organizations (id) on delete cascade,
  user_id  uuid not null references auth.users (id) on delete cascade,
  role     text not null check (role in ('admin', 'engineer', 'data_owner', 'auditor')),
  added_by uuid references auth.users (id),
  added_at timestamptz not null default now(),
  primary key (org_id, user_id, role)
);

create table if not exists public.invitations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id) on delete cascade,
  email       text not null check (email = lower(trim(email)) and email like '%_@_%'),
  role        text not null check (role in ('admin', 'engineer', 'data_owner', 'auditor')),
  invited_by  uuid not null default auth.uid() references auth.users (id),
  created_at  timestamptz not null default now(),
  accepted_at timestamptz,
  unique (org_id, email, role)
);

-- A rule set or mapping spec exactly as it was fingerprinted. The fingerprint
-- is the SHA-256 of the canonical JSON (src/lib/hashing.js); Postgres cannot
-- recompute that canonical form, so the app recomputes it on every read and
-- flags a row whose body does not match its fingerprint.
create table if not exists public.definitions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations (id),
  kind        text not null check (kind in ('contract', 'spec')),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  body        jsonb not null check (jsonb_typeof(body) = 'object'),
  object_name text check (char_length(object_name) <= 200),
  recorded_by uuid not null default auth.uid() references auth.users (id),
  recorded_at timestamptz not null default now(),
  unique (org_id, kind, sha256)
);

-- A check put forward for sign-off. The subject is what the decision is about;
-- the columns beside it are copies of its fields for indexing, and a check
-- constraint holds them to the subject so the two can never disagree.
create table if not exists public.submissions (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations (id),
  reference       text not null check (reference ~ '^EV-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$'),
  object_name     text check (char_length(object_name) <= 200),
  wave            text check (char_length(wave) <= 200),
  cycle           text check (char_length(cycle) <= 200),
  contract_def    uuid not null references public.definitions (id),
  spec_def        uuid not null references public.definitions (id),
  subject         jsonb not null,
  submitted_by    uuid not null default auth.uid() references auth.users (id),
  submitted_at    timestamptz not null default now(),
  unique (org_id, reference),
  constraint subject_agrees check (
    jsonb_typeof(subject) = 'object'
    and subject ->> 'reference' = reference
    and subject -> 'object' ->> 'name' is not distinct from object_name
    and subject -> 'object' ->> 'wave' is not distinct from wave
    and subject -> 'object' ->> 'cycle' is not distinct from cycle
  )
);

create table if not exists public.decisions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations (id),
  submission_id uuid not null references public.submissions (id),
  decision      text not null check (decision in ('accept', 'accept-with-exceptions', 'reject')),
  exceptions    jsonb not null default '[]'::jsonb check (jsonb_typeof(exceptions) = 'array'),
  comment       text check (char_length(comment) <= 2000),
  decided_by    uuid not null default auth.uid() references auth.users (id),
  decided_at    timestamptz not null default now(),
  -- One decision per person per submission. Changing your mind is a new
  -- submission, so the record of the first decision survives.
  unique (submission_id, decided_by),
  constraint exceptions_fit check (
    (decision = 'accept-with-exceptions') = (jsonb_array_length(exceptions) > 0)
  ),
  constraint reject_says_why check (decision <> 'reject' or char_length(trim(coalesce(comment, ''))) > 0)
);

create table if not exists public.audit_log (
  id        bigint generated always as identity primary key,
  org_id    uuid not null,
  at        timestamptz not null default now(),
  actor     uuid,
  action    text not null,
  entity    text not null,
  entity_id text,
  detail    jsonb not null default '{}'::jsonb
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists submissions_org_idx on public.submissions (org_id, submitted_at desc);
create index if not exists decisions_submission_idx on public.decisions (submission_id);
create index if not exists audit_log_org_idx on public.audit_log (org_id, at desc);

-- --- who holds what -----------------------------------------------------------
-- SECURITY DEFINER so a policy on memberships can ask about memberships
-- without recursing into its own policy. Each answers only about the caller.

create or replace function public.holds_role(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid() and m.role = any (roles))
$$;

-- The caller's own email. auth.users is not readable by signed-in users, so a
-- policy cannot read it directly.
create or replace function public.my_email()
returns text language sql stable security definer set search_path = public as $$
  select lower(u.email::text) from auth.users u where u.id = auth.uid()
$$;

create or replace function public.is_member(org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.memberships m where m.org_id = org and m.user_id = auth.uid())
$$;

-- --- row-level security ---------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.memberships   enable row level security;
alter table public.invitations   enable row level security;
alter table public.definitions   enable row level security;
alter table public.submissions   enable row level security;
alter table public.decisions     enable row level security;
alter table public.audit_log     enable row level security;

drop policy if exists "members read their organisation" on public.organizations;
drop policy if exists "anyone signed in creates an organisation" on public.organizations;
create policy "members read their organisation" on public.organizations for select using (public.is_member(id));
create policy "anyone signed in creates an organisation" on public.organizations for insert
  with check (auth.uid() is not null and created_by = auth.uid());

drop policy if exists "members read memberships" on public.memberships;
drop policy if exists "admins remove members" on public.memberships;
create policy "members read memberships" on public.memberships for select using (public.is_member(org_id));
create policy "admins remove members" on public.memberships for delete using (public.holds_role(org_id, array['admin']));
-- No insert policy: a membership is created only by accepting an invitation
-- (accept_invitation, below) or by creating the organisation.

drop policy if exists "admins and the invited read invitations" on public.invitations;
drop policy if exists "admins invite" on public.invitations;
drop policy if exists "admins withdraw invitations" on public.invitations;
create policy "admins and the invited read invitations" on public.invitations for select
  using (public.holds_role(org_id, array['admin']) or email = public.my_email());
create policy "admins invite" on public.invitations for insert
  with check (public.holds_role(org_id, array['admin']) and invited_by = auth.uid() and accepted_at is null);
create policy "admins withdraw invitations" on public.invitations for delete
  using (public.holds_role(org_id, array['admin']) and accepted_at is null);

drop policy if exists "members read definitions" on public.definitions;
drop policy if exists "engineers record definitions" on public.definitions;
create policy "members read definitions" on public.definitions for select using (public.is_member(org_id));
create policy "engineers record definitions" on public.definitions for insert
  with check (public.holds_role(org_id, array['engineer']) and recorded_by = auth.uid());

drop policy if exists "members read submissions" on public.submissions;
drop policy if exists "engineers submit" on public.submissions;
create policy "members read submissions" on public.submissions for select using (public.is_member(org_id));
-- Both definitions must be this organisation's, with the fingerprints the
-- subject names. A foreign key is checked without row-level security, so on
-- its own it would let a submission point at another organisation's rules.
create policy "engineers submit" on public.submissions for insert
  with check (
    public.holds_role(org_id, array['engineer'])
    and submitted_by = auth.uid()
    and exists (select 1 from public.definitions d where d.id = contract_def and d.org_id = submissions.org_id
                and d.kind = 'contract' and d.sha256 = submissions.subject -> 'definitions' ->> 'contract')
    and exists (select 1 from public.definitions d where d.id = spec_def and d.org_id = submissions.org_id
                and d.kind = 'spec' and d.sha256 = submissions.subject -> 'definitions' ->> 'spec')
  );

drop policy if exists "members read decisions" on public.decisions;
drop policy if exists "data owners decide" on public.decisions;
create policy "members read decisions" on public.decisions for select using (public.is_member(org_id));
create policy "data owners decide" on public.decisions for insert
  with check (
    public.holds_role(org_id, array['data_owner'])
    and decided_by = auth.uid()
    and exists (select 1 from public.submissions s where s.id = submission_id and s.org_id = decisions.org_id)
  );

drop policy if exists "members read the audit log" on public.audit_log;
create policy "members read the audit log" on public.audit_log for select using (public.is_member(org_id));
-- No write policy at all: only the triggers below write to it.

-- --- separation of duties -----------------------------------------------------------
-- A trigger rather than a policy, so the refusal can say why.

create or replace function public.enforce_separation_of_duties()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  s public.submissions;
begin
  select * into s from public.submissions where id = new.submission_id;
  if s.submitted_by = new.decided_by then
    raise exception 'Separation of duties: you submitted this check, so someone else must decide on it.'
      using errcode = '42501';
  end if;
  if exists (select 1 from public.definitions d where d.id in (s.contract_def, s.spec_def) and d.recorded_by = new.decided_by) then
    raise exception 'Separation of duties: you recorded the rules or the mapping this check was held to, so someone else must decide on it.'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists decisions_separation_of_duties on public.decisions;
create trigger decisions_separation_of_duties before insert on public.decisions
  for each row execute function public.enforce_separation_of_duties();

-- --- append-only -------------------------------------------------------------------

create or replace function public.refuse_rewrite()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only: % cannot be changed or deleted.', tg_table_name, tg_argv[0]
    using errcode = '42501';
end $$;

drop trigger if exists definitions_append_only on public.definitions;
drop trigger if exists submissions_append_only on public.submissions;
drop trigger if exists decisions_append_only on public.decisions;
drop trigger if exists audit_log_append_only on public.audit_log;
create trigger definitions_append_only before update or delete on public.definitions
  for each row execute function public.refuse_rewrite('a recorded definition');
create trigger submissions_append_only before update or delete on public.submissions
  for each row execute function public.refuse_rewrite('a submission');
create trigger decisions_append_only before update or delete on public.decisions
  for each row execute function public.refuse_rewrite('a decision');
create trigger audit_log_append_only before update or delete on public.audit_log
  for each row execute function public.refuse_rewrite('a log entry');

-- An organisation is never deleted (its decisions are append-only), and
-- invitations change once, when accepted, which accept_invitation does.
drop trigger if exists organizations_append_only on public.organizations;
create trigger organizations_append_only before delete on public.organizations
  for each row execute function public.refuse_rewrite('an organisation');

-- --- membership lifecycle ------------------------------------------------------------

-- Whoever creates an organisation is its first admin.
create or replace function public.add_founder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.memberships (org_id, user_id, role, added_by) values (new.id, new.created_by, 'admin', new.created_by);
  return new;
end $$;

drop trigger if exists organizations_add_founder on public.organizations;
create trigger organizations_add_founder after insert on public.organizations
  for each row execute function public.add_founder();

create or replace function public.keep_an_admin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin'
     and exists (select 1 from public.organizations o where o.id = old.org_id)
     and not exists (select 1 from public.memberships m where m.org_id = old.org_id and m.role = 'admin'
                     and m.user_id <> old.user_id) then
    raise exception 'An organisation needs at least one admin: add another before removing the last.'
      using errcode = '42501';
  end if;
  return old;
end $$;

drop trigger if exists memberships_keep_an_admin on public.memberships;
create trigger memberships_keep_an_admin before delete on public.memberships
  for each row execute function public.keep_an_admin();

-- accept_invitation(id): join with the invited role. Only the account whose
-- CONFIRMED email the invitation names can accept it — an unconfirmed address
-- proves nothing about who holds it.
create or replace function public.accept_invitation(invitation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  i public.invitations;
  me auth.users;
begin
  select * into me from auth.users where id = auth.uid();
  if me.id is null then
    raise exception 'Sign in to accept an invitation.' using errcode = '42501';
  end if;
  select * into i from public.invitations where id = invitation and accepted_at is null;
  if i.id is null or lower(me.email) is distinct from i.email then
    raise exception 'There is no open invitation for this account.' using errcode = '42501';
  end if;
  if me.email_confirmed_at is null then
    raise exception 'Confirm your email address before accepting an invitation.' using errcode = '42501';
  end if;
  insert into public.memberships (org_id, user_id, role, added_by) values (i.org_id, me.id, i.role, i.invited_by)
    on conflict do nothing;
  update public.invitations set accepted_at = now() where id = i.id;
end $$;

-- Members' emails, for the people screen. Only for an organisation the caller
-- belongs to.
create or replace function public.organization_members(org uuid)
returns table (user_id uuid, email text, role text, added_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.user_id, u.email::text, m.role, m.added_at
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.org_id = org and public.is_member(org)
  order by u.email, m.role
$$;

-- --- the audit log ------------------------------------------------------------------
-- Written by triggers, as the table owner, for every change to the tables
-- above. `actor` is the signed-in user; the detail names what changed and
-- never repeats a subject or a definition body (those rows are immutable and
-- can be read directly).

create or replace function public.audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  row_data jsonb := to_jsonb(coalesce(new, old));
  detail jsonb := '{}'::jsonb;
  org uuid;
  entity_id text;
begin
  org := coalesce((row_data ->> 'org_id')::uuid, (row_data ->> 'id')::uuid);
  entity_id := coalesce(row_data ->> 'id', concat_ws(':', row_data ->> 'user_id', row_data ->> 'role'));
  detail := case tg_table_name
    when 'organizations' then jsonb_build_object('name', row_data ->> 'name')
    when 'memberships'   then jsonb_build_object('user_id', row_data ->> 'user_id', 'role', row_data ->> 'role')
    when 'invitations'   then jsonb_build_object('email', row_data ->> 'email', 'role', row_data ->> 'role', 'accepted', row_data ->> 'accepted_at' is not null)
    when 'definitions'   then jsonb_build_object('kind', row_data ->> 'kind', 'sha256', row_data ->> 'sha256', 'object', row_data ->> 'object_name')
    when 'submissions'   then jsonb_build_object('reference', row_data ->> 'reference', 'object', row_data ->> 'object_name', 'cycle', row_data ->> 'cycle')
    when 'decisions'     then jsonb_build_object('submission_id', row_data ->> 'submission_id', 'decision', row_data ->> 'decision', 'exceptions', jsonb_array_length(row_data -> 'exceptions'))
    else '{}'::jsonb end;
  insert into public.audit_log (org_id, actor, action, entity, entity_id, detail)
    values (org, auth.uid(), lower(tg_op), tg_table_name, entity_id, detail);
  return null;
end $$;

drop trigger if exists organizations_audit on public.organizations;
drop trigger if exists memberships_audit on public.memberships;
drop trigger if exists invitations_audit on public.invitations;
drop trigger if exists definitions_audit on public.definitions;
drop trigger if exists submissions_audit on public.submissions;
drop trigger if exists decisions_audit on public.decisions;
create trigger organizations_audit after insert on public.organizations for each row execute function public.audit();
create trigger memberships_audit after insert or delete on public.memberships for each row execute function public.audit();
create trigger invitations_audit after insert or update or delete on public.invitations for each row execute function public.audit();
create trigger definitions_audit after insert on public.definitions for each row execute function public.audit();
create trigger submissions_audit after insert on public.submissions for each row execute function public.audit();
create trigger decisions_audit after insert on public.decisions for each row execute function public.audit();

-- The helper functions are callable by signed-in users only.
revoke all on function public.accept_invitation(uuid) from public, anon;
revoke all on function public.organization_members(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;
grant execute on function public.organization_members(uuid) to authenticated;
