-- Two accounts, and an anonymous visitor, against schema.sql's policies.
-- Every check raises on failure; the run stops at the first one.

create extension if not exists pgcrypto;

\set alice '''a0000000-0000-4000-8000-00000000000a'''
\set bob   '''b0000000-0000-4000-8000-00000000000b'''

insert into auth.users (id) values (:alice), (:bob);

-- Act as a user (or as nobody, for anon), the way a Supabase request does.
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

-- Remember Alice's ids as the superuser, so Bob's attempts can name them.
reset role;
select id as alice_contract from public.contracts where name = 'Employees' \gset
select id as alice_run from public.validation_runs limit 1 \gset

-- --- Bob, against Alice's rows -------------------------------------------------
select pg_temp.act_as(:bob);
select pg_temp.check((select count(*) = 0 from public.contracts), 'Bob cannot read Alice''s contracts');
select pg_temp.check((select count(*) = 0 from public.validation_runs), 'Bob cannot read Alice''s runs');
select pg_temp.check((select count(*) = 0 from public.contracts where id = :'alice_contract'), 'Bob cannot read Alice''s contract even by id');

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

-- Runs are history: not even their owner may rewrite one.
insert into public.validation_runs (candidate_name, status) values ('mine.csv', 'FAIL');
with changed as (update public.validation_runs set status = 'PASS' returning 1)
select pg_temp.check((select count(*) = 0 from changed), 'nobody can rewrite a run, its owner included');

-- --- Anonymous ----------------------------------------------------------------
select pg_temp.act_as(null);
select pg_temp.check((select count(*) = 0 from public.contracts), 'anonymous visitors read no contracts');
select pg_temp.check((select count(*) = 0 from public.validation_runs), 'anonymous visitors read no runs');
select pg_temp.refused(format('insert into public.contracts (user_id, name) values (%L, %L)', :alice, 'Anon'),
  'anonymous visitors cannot write a contract');

-- --- And Alice's rows are untouched -----------------------------------------
select pg_temp.act_as(:alice);
select pg_temp.check((select rules <> '[]'::jsonb from public.contracts where id = :'alice_contract'), 'Alice''s contract is unchanged after all of that');
select pg_temp.check((select count(*) = 1 from public.validation_runs), 'Alice''s history holds only her own run');
reset role;
\echo ALL ISOLATION CHECKS PASSED
