-- Two accounts, and an anonymous visitor, against schema.sql's policies.
-- Every check raises on failure; the run stops at the first one.

create extension if not exists pgcrypto;

\set alice '''a0000000-0000-4000-8000-00000000000a'''
\set bob   '''b0000000-0000-4000-8000-00000000000b'''
\set carol '''c0000000-0000-4000-8000-00000000000c'''

insert into auth.users (id, email) values (:alice, 'alice@example.com'), (:bob, 'bob@example.com'), (:carol, 'carol@example.com');

-- Act as a user (or as nobody, for anon), the way a Supabase request does.
create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), false);
  perform set_config('request.jwt.claim.email', coalesce((select email from auth.users where id = uid), ''), false);
  execute format('set role %I', case when uid is null then 'anon' else 'authenticated' end);
end $$;

create function pg_temp.check(ok boolean, what text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', what; end if;
  raise notice 'ok  %', what;
end $$;

-- Runs a statement that RLS must refuse; passes only if it raises.
create function pg_temp.refused(statement text, what text) returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'FAILED: % — the statement was allowed', what;
exception when insufficient_privilege or check_violation or foreign_key_violation then
  raise notice 'ok  % (refused: %)', what, sqlerrm;
end $$;

-- --- Alice writes her own --------------------------------------------------
select pg_temp.act_as(:alice);
insert into public.contracts (name, rules) values ('Employees', '[{"kind":"nullRule","column":"id","op":"notNull"}]');
insert into public.validation_runs (candidate_name, status, contract_id)
  select 'load.csv', 'PASS', id from public.contracts where name = 'Employees';
select pg_temp.check((select count(*) = 1 from public.contracts), 'Alice sees her own contract');
select pg_temp.check((select count(*) = 1 from public.validation_runs), 'Alice sees her own run');
select pg_temp.check((select user_id = auth.uid() from public.contracts limit 1), 'a new row belongs to whoever inserted it');

insert into public.migration_objects (name, object) values ('Opening trial balance', '{"kind":"migration-object","name":"Opening trial balance","runs":[]}');
select pg_temp.check((select count(*) = 1 from public.migration_objects), 'Alice sees her own migration object');

-- Remember Alice's ids as the superuser, so Bob's attempts can name them.
reset role;
select id as alice_contract from public.contracts where name = 'Employees' \gset
select id as alice_run from public.validation_runs limit 1 \gset
select id as alice_object from public.migration_objects limit 1 \gset

-- --- Bob, against Alice's rows -------------------------------------------------
select pg_temp.act_as(:bob);
select pg_temp.check((select count(*) = 0 from public.contracts), 'Bob cannot read Alice''s contracts');
select pg_temp.check((select count(*) = 0 from public.validation_runs), 'Bob cannot read Alice''s runs');
select pg_temp.check((select count(*) = 0 from public.contracts where id = :'alice_contract'), 'Bob cannot read Alice''s contract even by id');
select pg_temp.check((select count(*) = 0 from public.migration_objects), 'Bob cannot read Alice''s migration objects');
select pg_temp.check((select count(*) = 0 from public.migration_objects where id = :'alice_object'), 'Bob cannot read Alice''s object even by id');
with changed as (update public.migration_objects set object = '{}' where id = :'alice_object' returning 1)
select pg_temp.check((select count(*) = 0 from changed), 'Bob cannot change Alice''s object');
with gone as (delete from public.migration_objects where id = :'alice_object' returning 1)
select pg_temp.check((select count(*) = 0 from gone), 'Bob cannot delete Alice''s object');
select pg_temp.refused(format('insert into public.migration_objects (user_id, name, object) values (%L, %L, %L)', :alice, 'Planted', '{}'),
  'Bob cannot create an object in Alice''s account');

with changed as (update public.contracts set rules = '[]' where id = :'alice_contract' returning 1)
select pg_temp.check((select count(*) = 0 from changed), 'Bob cannot change Alice''s contract');
with gone as (delete from public.contracts where id = :'alice_contract' returning 1)
select pg_temp.check((select count(*) = 0 from gone), 'Bob cannot delete Alice''s contract');
with gone as (delete from public.validation_runs where id = :'alice_run' returning 1)
select pg_temp.check((select count(*) = 0 from gone), 'Bob cannot delete Alice''s run');

select pg_temp.refused(format('insert into public.contracts (user_id, name) values (%L, %L)', :alice, 'Planted'),
  'Bob cannot create a contract in Alice''s name');
select pg_temp.refused(format('insert into public.validation_runs (user_id, candidate_name, status) values (%L, %L, %L)', :alice, 'x.csv', 'PASS'),
  'Bob cannot write a run into Alice''s history');
select pg_temp.refused(format('insert into public.validation_runs (candidate_name, status, contract_id) values (%L, %L, %L)', 'x.csv', 'PASS', :'alice_contract'),
  'Bob cannot attach his run to Alice''s contract');

-- Bob's own rows work, and he cannot hand one to Alice.
insert into public.contracts (name) values ('Employees');
select pg_temp.check((select count(*) = 1 from public.contracts), 'Bob can use a name Alice already uses — names are per account');
select pg_temp.refused(format('update public.contracts set user_id = %L where name = %L', :alice, 'Employees'),
  'Bob cannot move his contract into Alice''s account');
insert into public.migration_objects (name, object) values ('Opening trial balance', '{"kind":"migration-object"}');
select pg_temp.check((select count(*) = 1 from public.migration_objects), 'Bob can use an object name Alice already uses — names are per account');
select pg_temp.refused(format('update public.migration_objects set user_id = %L', :alice),
  'Bob cannot move his object into Alice''s account');

-- Runs are history: not even their owner may rewrite one.
insert into public.validation_runs (candidate_name, status) values ('mine.csv', 'FAIL');
with changed as (update public.validation_runs set status = 'PASS' returning 1)
select pg_temp.check((select count(*) = 0 from changed), 'nobody can rewrite a run, its owner included');

-- --- Organisations: Alice's firm, Bob invited, Carol a stranger ------------------
select pg_temp.act_as(:alice);
-- With RETURNING, as the app sends it: the creator must be able to read the row at once.
with made as (insert into public.organisations (name) values ('Kapoor and Co') returning id)
select pg_temp.check((select count(*) = 1 from made), 'creating an organisation returns it to its creator');
select id as firm from public.organisations where name = 'Kapoor and Co' \gset
select pg_temp.check((select role = 'admin' and email = 'alice@example.com' from public.memberships where org_id = :'firm' and user_id = auth.uid()),
  'creating an organisation makes its creator an admin, named by email');
insert into public.invitations (org_id, email, role) values (:'firm', 'Bob@Example.com', 'editor');
select pg_temp.refused(format('insert into public.invitations (org_id, email, role) values (%L, %L, %L)', :'firm', 'x@example.com', 'owner'),
  'an invitation carries one of the four roles only');
insert into public.migration_objects (name, object, org_id) values ('Vendors', '{"kind":"migration-object","name":"Vendors"}', :'firm');
select id as firm_object from public.migration_objects where name = 'Vendors' \gset
select pg_temp.check((select count(*) = 2 from public.migration_objects), 'Alice sees her personal object and the firm''s');

select pg_temp.act_as(:carol);
select pg_temp.check((select count(*) = 0 from public.organisations), 'a stranger sees no organisation');
select pg_temp.check((select count(*) = 0 from public.memberships), 'a stranger sees no member');
select pg_temp.check((select count(*) = 0 from public.migration_objects where id = :'firm_object'), 'a stranger cannot read the firm''s object');
select pg_temp.refused(format('insert into public.memberships (org_id, user_id, role) values (%L, %L, %L)', :'firm', :carol, 'admin'),
  'a stranger cannot make themselves a member');
select pg_temp.refused(format('insert into public.invitations (org_id, email, role) values (%L, %L, %L)', :'firm', 'carol@example.com', 'admin'),
  'a stranger cannot invite themselves');
select pg_temp.refused(format('insert into public.migration_objects (name, object, org_id) values (%L, %L, %L)', 'Planted', '{}', :'firm'),
  'a stranger cannot put an object into the firm');
select pg_temp.check((select public.accept_invitations() = 0), 'accepting with no invitation joins nothing');

select pg_temp.act_as(:bob);
select pg_temp.check((select count(*) = 0 from public.migration_objects where id = :'firm_object'), 'before accepting, Bob cannot read the firm''s object');
select pg_temp.check((select public.accept_invitations() = 1), 'Bob accepts the invitation sent to his email, whatever its case');
select pg_temp.check((select role = 'editor' and email = 'bob@example.com' from public.memberships where org_id = :'firm' and user_id = auth.uid()), 'Bob is an editor of the firm');
select pg_temp.check((select count(*) = 1 from public.migration_objects where id = :'firm_object'), 'an editor reads the firm''s object');
select pg_temp.check((select count(*) = 0 from public.migration_objects where id = :'alice_object'), 'an editor still cannot read Alice''s personal object');
with changed as (update public.migration_objects set name = 'Vendors (edited)' where id = :'firm_object' returning 1)
select pg_temp.check((select count(*) = 1 from changed), 'an editor can change the firm''s object');
with gone as (delete from public.migration_objects where id = :'firm_object' returning 1)
select pg_temp.check((select count(*) = 0 from gone), 'an editor cannot delete the firm''s object');
select pg_temp.check((select count(*) = 2 from public.memberships where org_id = :'firm'), 'a member sees who the members are');
select pg_temp.check((select count(*) = 0 from public.invitations), 'an editor sees no invitations');
select pg_temp.refused(format('insert into public.invitations (org_id, email, role) values (%L, %L, %L)', :'firm', 'dave@example.com', 'viewer'),
  'an editor cannot invite');
with changed as (update public.memberships set role = 'admin' where org_id = :'firm' and user_id = auth.uid() returning 1)
select pg_temp.check((select count(*) = 0 from changed), 'an editor cannot promote themselves');
with gone as (delete from public.memberships where org_id = :'firm' and user_id = :alice returning 1)
select pg_temp.check((select count(*) = 0 from gone), 'an editor cannot remove the admin');

-- Alice makes Bob a viewer; the last admin stays; a viewer reads and nothing else.
select pg_temp.act_as(:alice);
update public.memberships set role = 'viewer' where org_id = :'firm' and user_id = :bob;
select pg_temp.refused(format('update public.memberships set role = %L where org_id = %L and user_id = %L', 'viewer', :'firm', :alice),
  'an organisation keeps at least one admin');
select pg_temp.act_as(:bob);
select pg_temp.check((select count(*) = 1 from public.migration_objects where id = :'firm_object'), 'a viewer reads the firm''s object');
with changed as (update public.migration_objects set name = 'Vendors (viewer)' where id = :'firm_object' returning 1)
select pg_temp.check((select count(*) = 0 from changed), 'a viewer cannot change it');
select pg_temp.refused(format('insert into public.migration_objects (name, object, org_id) values (%L, %L, %L)', 'Planted', '{}', :'firm'),
  'a viewer cannot add an object to the firm');
delete from public.memberships where org_id = :'firm' and user_id = auth.uid();
select pg_temp.check((select count(*) = 0 from public.migration_objects where id = :'firm_object'), 'having left, Bob reads nothing of the firm');

-- Deleting the organisation returns its objects to whoever saved them.
select pg_temp.act_as(:alice);
delete from public.organisations where id = :'firm';
reset role;
select pg_temp.check((select count(*) = 0 from public.memberships where org_id = :'firm'), 'deleting an organisation removes its memberships, the last admin included');
select pg_temp.check((select org_id is null and user_id = :alice from public.migration_objects where id = :'firm_object'), 'and its objects become personal objects of whoever saved them, not deleted');

-- --- Anonymous ----------------------------------------------------------------
select pg_temp.act_as(null);
select pg_temp.check((select count(*) = 0 from public.contracts), 'anonymous visitors read no contracts');
select pg_temp.check((select count(*) = 0 from public.validation_runs), 'anonymous visitors read no runs');
select pg_temp.check((select count(*) = 0 from public.migration_objects), 'anonymous visitors read no migration objects');
select pg_temp.check((select count(*) = 0 from public.organisations) and (select count(*) = 0 from public.memberships), 'anonymous visitors see no organisation and no member');
select pg_temp.refused(format('insert into public.organisations (name, created_by) values (%L, %L)', 'Anon Co', :alice), 'anonymous visitors cannot create an organisation');
select pg_temp.refused(format('insert into public.migration_objects (user_id, name, object) values (%L, %L, %L)', :alice, 'Anon', '{}'),
  'anonymous visitors cannot write a migration object');
select pg_temp.refused(format('insert into public.contracts (user_id, name) values (%L, %L)', :alice, 'Anon'),
  'anonymous visitors cannot write a contract');

-- --- And Alice's rows are untouched -----------------------------------------
select pg_temp.act_as(:alice);
select pg_temp.check((select rules <> '[]'::jsonb from public.contracts where id = :'alice_contract'), 'Alice''s contract is unchanged after all of that');
select pg_temp.check((select count(*) = 1 from public.validation_runs), 'Alice''s history holds only her own run');
select pg_temp.check((select object ->> 'name' = 'Opening trial balance' from public.migration_objects where id = :'alice_object'), 'Alice''s object is unchanged, and she still sees only her own');
reset role;
\echo ALL ISOLATION CHECKS PASSED
