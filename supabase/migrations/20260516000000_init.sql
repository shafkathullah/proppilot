-- PropPilot schema + RLS
-- Paste this into Supabase SQL editor and run.

-- ============================================================
-- Tables
-- ============================================================

create table if not exists public.agencies (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.agents (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table if not exists public.contacts (
  id          uuid primary key default gen_random_uuid(),
  agency_id   uuid not null references public.agencies(id) on delete cascade,
  name        text not null,
  email       text not null,
  message     text not null,
  status      text not null default 'new' check (status in ('new','contacted','discarded')),
  created_at  timestamptz not null default now()
);

create index if not exists contacts_agency_created_idx
  on public.contacts (agency_id, created_at desc);

-- ============================================================
-- Realtime: publish contacts so the inbox can subscribe
-- ============================================================

alter publication supabase_realtime add table public.contacts;

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.agencies enable row level security;
alter table public.agents   enable row level security;
alter table public.contacts enable row level security;

-- ---- agencies ----
-- Public read of (id, slug, name) so the form page can resolve a slug.
-- No write policies => no inserts/updates/deletes from anon or authenticated.
drop policy if exists "agencies are publicly readable" on public.agencies;
create policy "agencies are publicly readable"
  on public.agencies
  for select
  to anon, authenticated
  using (true);

-- ---- agents ----
-- Each agent can read only their own row. No writes from clients (seed via SQL).
drop policy if exists "agents read self" on public.agents;
create policy "agents read self"
  on public.agents
  for select
  to authenticated
  using (user_id = auth.uid());

-- ---- contacts ----
-- Anon can submit a contact, with status='new' only. The FK to agencies
-- already enforces that the agency exists, so no need to re-check in the
-- policy (and an EXISTS subquery on another RLS-protected table inside a
-- WITH CHECK clause was failing in practice — likely a policy-context quirk).
drop policy if exists "anon can submit contact" on public.contacts;
create policy "anon can submit contact"
  on public.contacts
  for insert
  to anon
  with check (status = 'new');

-- Authenticated agents can read only contacts belonging to their agency.
drop policy if exists "agents read own agency contacts" on public.contacts;
create policy "agents read own agency contacts"
  on public.contacts
  for select
  to authenticated
  using (
    agency_id in (select agency_id from public.agents where user_id = auth.uid())
  );

-- Authenticated agents can update contacts in their own agency.
-- The trigger below restricts which columns are actually mutable.
drop policy if exists "agents update own agency contacts" on public.contacts;
create policy "agents update own agency contacts"
  on public.contacts
  for update
  to authenticated
  using (
    agency_id in (select agency_id from public.agents where user_id = auth.uid())
  )
  with check (
    agency_id in (select agency_id from public.agents where user_id = auth.uid())
  );

-- No DELETE policy => deletes are blocked for both audiences.

-- ============================================================
-- Trigger: restrict authenticated UPDATEs to the status column only,
-- and prevent anon INSERTs from setting non-default status (belt + suspenders).
-- ============================================================

create or replace function public.contacts_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.id         is distinct from old.id
       or new.agency_id is distinct from old.agency_id
       or new.name      is distinct from old.name
       or new.email     is distinct from old.email
       or new.message   is distinct from old.message
       or new.created_at is distinct from old.created_at then
      raise exception 'only status may be updated';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_guard on public.contacts;
create trigger contacts_guard
  before update on public.contacts
  for each row execute function public.contacts_guard();

-- ============================================================
-- Seed: two agencies for the demo
-- (Create the two auth users in Supabase Dashboard -> Authentication -> Users,
--  then insert their agents rows below, replacing the UUIDs.)
-- ============================================================

insert into public.agencies (slug, name) values
  ('acme-realty',   'Acme Realty'),
  ('north-star-re', 'North Star Real Estate')
on conflict (slug) do nothing;

-- After creating the two auth users, run e.g.:
--   insert into public.agents (user_id, agency_id)
--   values ('<auth-user-uuid-1>', (select id from public.agencies where slug='acme-realty'));
--   insert into public.agents (user_id, agency_id)
--   values ('<auth-user-uuid-2>', (select id from public.agencies where slug='north-star-re'));
