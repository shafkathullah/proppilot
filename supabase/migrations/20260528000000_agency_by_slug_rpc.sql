-- Close agency enumeration: anon can no longer SELECT the whole agencies table.
-- The public form resolves a single slug via a SECURITY DEFINER RPC instead.

-- ---- agencies: replace the open anon-readable policy ----
-- Was: `using (true)` for anon, authenticated  -> let anyone list every tenant.
-- Now: authenticated agents may read only their own agency row (Inbox needs the
-- name). Anon gets no direct table access; it uses agency_by_slug() below.
drop policy if exists "agencies are publicly readable" on public.agencies;

drop policy if exists "agents read own agency" on public.agencies;
create policy "agents read own agency"
  on public.agencies
  for select
  to authenticated
  using (
    id in (select agency_id from public.agents where user_id = auth.uid())
  );

-- ---- agency_by_slug: the only public path to resolve slug -> agency ----
-- SECURITY DEFINER so it runs past RLS, but returns at most one row (the slug
-- asked for). No way to enumerate: one call yields one tenant, never the list.
create or replace function public.agency_by_slug(p_slug text)
returns table (id uuid, slug text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select id, slug, name from public.agencies where slug = p_slug;
$$;

revoke all on function public.agency_by_slug(text) from public;
grant execute on function public.agency_by_slug(text) to anon, authenticated;
