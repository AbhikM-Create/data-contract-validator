-- Organisations, roles, separation of duties and the audit log, against
-- schema.sql. Five people:
--
--   alice  admin + engineer of Northwind, records rules and submits checks
--   bob    data owner of Northwind, decides
--   dave   auditor of Northwind, reads, changes nothing
--   erin   invited to Northwind, email not yet confirmed
--   carol  admin of a different organisation, Contoso
--
-- Every check raises on failure; the run stops at the first one.

\set alice '''a0000000-0000-4000-8000-00000000000a'''
\set bob   '''b0000000-0000-4000-8000-00000000000b'''
\set carol '''c0000000-0000-4000-8000-00000000000c'''
\set dave  '''d0000000-0000-4000-8000-00000000000d'''
\set erin  '''e0000000-0000-4000-8000-00000000000e'''

update auth.users set email = 'alice@northwind.example', email_confirmed_at = now() where id = :alice;
update auth.users set email = 'Bob@Northwind.example', email_confirmed_at = now() where id = :bob;
insert into auth.users (id, email, email_confirmed_at) values
  (:carol, 'carol@contoso.example', now()),
  (:dave, 'dave@northwind.example', now()),
  (:erin, 'erin@northwind.example', null);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  execute format('set role %I', case when uid is null then 'anon' else 'authenticated' end);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

-- Passes only if the statement raises a refusal; `expect` (optional) must
-- appear in the message, so a refusal for the wrong reason does not count.
create function pg_temp.refused(statement text, what text, expect text default null) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'FAILED: % — the statement was allowed', what;
exception when insufficient_privilege or check_violation or foreign_key_violation or unique_violation or not_null_violation then
  if expect is not null and position(expect in sqlerrm) = 0 then
    raise exception 'FAILED: % — refused for the wrong reason: %', what, sqlerrm;
  end if;
  raise notice 'ok  % (refused: %)', what, sqlerrm;
end $$;

-- A subject as src/lib/signoff.js builds one, with the fingerprints given.
create function pg_temp.subject(reference text, contract text, spec text) returns jsonb language sql as $$
  select jsonb_build_object(
    'version', 1, 'reference', reference, 'generatedAt', '2026-10-28T12:00:00Z',
    'object', jsonb_build_object('name', 'Employees', 'wave', 'Wave 1', 'cycle', 'Mock 2'),
    'definitions', jsonb_build_object('contract', contract, 'spec', spec),
    'files', jsonb_build_array(jsonb_build_object('role', 'load', 'name', 'load.csv', 'sha256', repeat('0', 64), 'rows', 46, 'bytes', 4100)),
    'checks', jsonb_build_array(jsonb_build_object('kind', 'readiness', 'status', 'NOT_READY', 'counts', jsonb_build_object('records', 46, 'rejected', 2))))
$$;

\set c1 '''1111111111111111111111111111111111111111111111111111111111111111'''
\set s1 '''2222222222222222222222222222222222222222222222222222222222222222'''
\set c2 '''3333333333333333333333333333333333333333333333333333333333333333'''

-- --- an organisation and its people -------------------------------------------------
select pg_temp.act_as(null);
select pg_temp.refused('insert into public.organizations (name) values (''Anon Inc'')', 'an anonymous visitor cannot create an organisation');

select pg_temp.act_as(:alice);
insert into public.organizations (name) values ('Northwind');
reset role;
select id as northwind from public.organizations where name = 'Northwind' \gset
select pg_temp.act_as(:alice);
select pg_temp.check((select array_agg(role) = array['admin'] from public.memberships where user_id = :alice), 'whoever creates an organisation is its first admin');

insert into public.invitations (org_id, email, role) values
  (:'northwind', 'alice@northwind.example', 'engineer'),
  (:'northwind', 'bob@northwind.example', 'data_owner'),
  (:'northwind', 'dave@northwind.example', 'auditor'),
  (:'northwind', 'erin@northwind.example', 'engineer');
select public.accept_invitation(id) from public.invitations where email = 'alice@northwind.example';

select pg_temp.act_as(:carol);
insert into public.organizations (name) values ('Contoso');
select pg_temp.check((select count(*) = 0 from public.invitations), 'another organisation''s admin cannot see Northwind''s invitations');
reset role;
select id as contoso from public.organizations where name = 'Contoso' \gset
select id as bob_invite from public.invitations where email = 'bob@northwind.example' \gset
select pg_temp.act_as(:carol);
select pg_temp.refused(format('select public.accept_invitation(%L)', :'bob_invite'), 'nobody can accept an invitation addressed to someone else', 'no open invitation');

select pg_temp.act_as(:bob);
select pg_temp.check((select count(*) = 1 from public.invitations), 'the invited person sees their own invitation (email matched without case)');
select pg_temp.check((select array_agg(name) = array['Northwind'] from public.organizations), 'the invited person sees the name of the organisation inviting them, and no other');
select pg_temp.check((select count(*) = 0 from public.submissions), 'but nothing inside it until they accept');
select public.accept_invitation(:'bob_invite');
select pg_temp.check((select count(*) = 1 from public.organizations), 'accepting an invitation joins the organisation');
select pg_temp.refused(format('insert into public.memberships (org_id, user_id, role) values (%L, %L, %L)', :'northwind', :bob, 'admin'),
  'a member cannot grant themself a role');
select pg_temp.refused(format('insert into public.invitations (org_id, email, role) values (%L, %L, %L)', :'northwind', 'bob@northwind.example', 'admin'),
  'only an admin can invite');

select pg_temp.act_as(:dave);
select public.accept_invitation(id) from public.invitations where email = 'dave@northwind.example';

select pg_temp.act_as(:erin);
select pg_temp.refused(format('select public.accept_invitation(id) from public.invitations where email = %L', 'erin@northwind.example'),
  'an unconfirmed email address cannot accept an invitation', 'Confirm your email');

-- --- definitions and submissions ---------------------------------------------------------
select pg_temp.act_as(:bob);
select pg_temp.refused(format('insert into public.definitions (org_id, kind, sha256, body) values (%L, %L, %L, %L)', :'northwind', 'contract', :c1, '{"rules":[]}'),
  'a data owner cannot record definitions — that is the engineer''s role');

select pg_temp.act_as(:alice);
insert into public.definitions (org_id, kind, sha256, body, object_name) values
  (:'northwind', 'contract', :c1, '{"rules":[]}', 'Employees'),
  (:'northwind', 'spec', :s1, '{"key":{}}', 'Employees');
reset role;
select id as def_c1 from public.definitions where sha256 = :c1 \gset
select id as def_s1 from public.definitions where sha256 = :s1 \gset

select pg_temp.act_as(:carol);
select pg_temp.check((select count(*) = 0 from public.definitions), 'another organisation reads none of Northwind''s definitions');
select pg_temp.check((select array_agg(name) = array['Contoso'] from public.organizations), 'another organisation cannot even read Northwind''s name');

-- Carol, an engineer in her own organisation, tries to hold a Contoso
-- submission to Northwind's definitions by naming their ids.
insert into public.invitations (org_id, email, role) values (:'contoso', 'carol@contoso.example', 'engineer');
select public.accept_invitation(id) from public.invitations where email = 'carol@contoso.example';
select pg_temp.refused(format('insert into public.submissions (org_id, reference, object_name, wave, cycle, contract_def, spec_def, subject) values (%L, %L, %L, %L, %L, %L, %L, %L)',
  :'contoso', 'EV-AAAA-0000-0001', 'Employees', 'Wave 1', 'Mock 2', :'def_c1', :'def_s1', pg_temp.subject('EV-AAAA-0000-0001', :c1, :s1)),
  'a submission cannot point at another organisation''s definitions');

select pg_temp.act_as(:alice);
select pg_temp.refused(format('insert into public.submissions (org_id, reference, object_name, wave, cycle, contract_def, spec_def, subject) values (%L, %L, %L, %L, %L, %L, %L, %L)',
  :'northwind', 'EV-AAAA-0000-0002', 'Employees', 'Wave 1', 'Mock 3', :'def_c1', :'def_s1', pg_temp.subject('EV-AAAA-0000-0002', :c1, :s1)),
  'a submission''s columns must agree with its subject', 'subject_agrees');
select pg_temp.refused(format('insert into public.submissions (org_id, reference, object_name, wave, cycle, contract_def, spec_def, subject) values (%L, %L, %L, %L, %L, %L, %L, %L)',
  :'northwind', 'EV-AAAA-0000-0003', 'Employees', 'Wave 1', 'Mock 2', :'def_c1', :'def_s1', pg_temp.subject('EV-AAAA-0000-0003', :c2, :s1)),
  'a submission must be held to the definitions its subject fingerprints');
insert into public.submissions (org_id, reference, object_name, wave, cycle, contract_def, spec_def, subject)
  values (:'northwind', 'EV-AAAA-0000-0004', 'Employees', 'Wave 1', 'Mock 2', :'def_c1', :'def_s1', pg_temp.subject('EV-AAAA-0000-0004', :c1, :s1));
reset role;
select id as sub1 from public.submissions where reference = 'EV-AAAA-0000-0004' \gset

-- --- deciding ------------------------------------------------------------------------------
-- Alice also becomes a data owner; she still may not decide on her own work.
select pg_temp.act_as(:alice);
insert into public.invitations (org_id, email, role) values (:'northwind', 'alice@northwind.example', 'data_owner');
select public.accept_invitation(id) from public.invitations where email = 'alice@northwind.example' and role = 'data_owner';
select pg_temp.refused(format('insert into public.decisions (org_id, submission_id, decision) values (%L, %L, %L)', :'northwind', :'sub1', 'accept'),
  'separation of duties: nobody decides on a check they submitted', 'you submitted this check');

select pg_temp.act_as(:dave);
select pg_temp.refused(format('insert into public.decisions (org_id, submission_id, decision) values (%L, %L, %L)', :'northwind', :'sub1', 'accept'),
  'an auditor cannot decide');

select pg_temp.act_as(:bob);
select pg_temp.refused(format('insert into public.decisions (org_id, submission_id, decision) values (%L, %L, %L)', :'northwind', :'sub1', 'reject'),
  'a rejection must say why', 'reject_says_why');
select pg_temp.refused(format('insert into public.decisions (org_id, submission_id, decision) values (%L, %L, %L)', :'northwind', :'sub1', 'accept-with-exceptions'),
  'accepting with exceptions must list them', 'exceptions_fit');
insert into public.decisions (org_id, submission_id, decision, exceptions)
  values (:'northwind', :'sub1', 'accept-with-exceptions', '[{"finding":"readiness","reason":"two records fixed in source before cutover","owner":"HR data steward","fixBy":"2026-11-15"}]');
select pg_temp.check((select count(*) = 1 from public.decisions), 'the data owner records a decision');
select pg_temp.refused(format('insert into public.decisions (org_id, submission_id, decision) values (%L, %L, %L)', :'northwind', :'sub1', 'accept'),
  'one decision per person per submission — a changed mind is a new submission');

select pg_temp.act_as(:carol);
select pg_temp.check((select count(*) = 0 from public.submissions) and (select count(*) = 0 from public.decisions),
  'another organisation reads none of Northwind''s submissions or decisions');

-- Bob becomes an engineer too and records a second rule set; Alice submits a
-- check held to it. Bob wrote those rules, so he may not accept them.
select pg_temp.act_as(:alice);
insert into public.invitations (org_id, email, role) values (:'northwind', 'bob@northwind.example', 'engineer');
select pg_temp.act_as(:bob);
select public.accept_invitation(id) from public.invitations where email = 'bob@northwind.example' and role = 'engineer';
insert into public.definitions (org_id, kind, sha256, body) values (:'northwind', 'contract', :c2, '{"rules":[{"kind":"nullRule","column":"id","op":"notNull"}]}');
reset role;
select id as def_c2 from public.definitions where sha256 = :c2 \gset
select pg_temp.act_as(:alice);
insert into public.submissions (org_id, reference, object_name, wave, cycle, contract_def, spec_def, subject)
  values (:'northwind', 'EV-AAAA-0000-0005', 'Employees', 'Wave 1', 'Mock 2', :'def_c2', :'def_s1', pg_temp.subject('EV-AAAA-0000-0005', :c2, :s1));
reset role;
select id as sub2 from public.submissions where reference = 'EV-AAAA-0000-0005' \gset
select pg_temp.act_as(:bob);
select pg_temp.refused(format('insert into public.decisions (org_id, submission_id, decision) values (%L, %L, %L)', :'northwind', :'sub2', 'accept'),
  'separation of duties: nobody decides on a check held to rules they recorded', 'you recorded the rules');

-- --- nothing is rewritten ------------------------------------------------------------------
select pg_temp.act_as(:alice);
with changed as (update public.decisions set decision = 'reject' returning 1)
select pg_temp.check((select count(*) = 0 from changed), 'a member cannot rewrite a decision');
reset role;
select pg_temp.refused('update public.decisions set comment = ''edited''', 'not even the table owner can rewrite a decision', 'append-only');
select pg_temp.refused('delete from public.submissions', 'not even the table owner can delete a submission', 'append-only');
select pg_temp.refused('update public.definitions set body = ''{}''', 'not even the table owner can change a recorded definition', 'append-only');
select pg_temp.refused('delete from public.audit_log', 'not even the table owner can delete from the audit log', 'append-only');
select pg_temp.refused(format('delete from public.organizations where id = %L', :'northwind'), 'an organisation with a sign-off history cannot be deleted', 'append-only');
select pg_temp.act_as(:alice);
select pg_temp.refused('insert into public.audit_log (org_id, action, entity) values (gen_random_uuid(), ''insert'', ''planted'')', 'nobody writes to the audit log directly');

-- --- membership: removing people ---------------------------------------------------------
select pg_temp.act_as(:bob);
with gone as (delete from public.memberships where user_id = :dave returning 1)
select pg_temp.check((select count(*) = 0 from gone), 'a non-admin cannot remove a member');
select pg_temp.act_as(:alice);
delete from public.memberships where user_id = :dave;
select pg_temp.check((select count(*) = 0 from public.memberships where user_id = :dave), 'an admin removes a member who has left');
select pg_temp.refused(format('delete from public.memberships where user_id = %L and role = %L', :alice, 'admin'),
  'the last admin cannot be removed', 'at least one admin');

select pg_temp.act_as(:dave);
select pg_temp.check((select count(*) = 0 from public.submissions), 'a removed member reads nothing any more');

-- --- the audit log ---------------------------------------------------------------------------
select pg_temp.act_as(:bob);
select pg_temp.check((select count(*) = 1 from public.audit_log where entity = 'decisions' and actor = :bob and detail ->> 'decision' = 'accept-with-exceptions'),
  'the audit log records who decided what');
select pg_temp.check((select count(*) = 1 from public.audit_log where entity = 'memberships' and action = 'delete' and actor = :alice and detail ->> 'user_id' = :dave),
  'the audit log records who removed whom');
select pg_temp.check((select count(*) = 0 from public.audit_log where org_id = :'contoso'), 'the audit log shows only your own organisation');
select pg_temp.check((select count(*) = 3 from public.organization_members(:'northwind') where user_id = :alice), 'members can see who holds which role');
select pg_temp.check((select count(*) = 0 from public.organization_members(:'contoso')), 'and only in their own organisation');
reset role;
\echo ALL ORGANISATION CHECKS PASSED
