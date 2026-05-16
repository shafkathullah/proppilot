# PropPilot

Mini realtime inbox for a real-estate agency. Public form at `/c/:agencySlug`, agent dashboard at `/inbox`, multi-tenant isolation via Supabase RLS.

**Repo:** https://github.com/shafkathullah/proppilot
**Deployed:** https://proppilot.shafu.xyz

**Demo accounts** (different agencies — verify isolation by logging into each):

| Email | Password | Agency | Public form |
|---|---|---|---|
| `agent@acme-realty.test` | `demopass1` | Acme Realty | `/c/acme-realty` |
| `agent@north-star-re.test` | `demopass2` | North Star Real Estate | `/c/north-star-re` |

Stack: Vite + React + TypeScript, Tailwind v4, Supabase (Auth, Postgres, RLS, Realtime), Cloudflare Workers (assets-only). Scaffolded from `npm create vite` (`react-ts` template) — the only template used.

## Run locally

```bash
npm install
cp .env.example .env.local      # then fill in Supabase URL + anon key
npm run dev                     # http://localhost:5173
```

### Apply the schema to your Supabase project

Schema, RLS, and the agency seeds live in `supabase/migrations/`. Push them with the Supabase CLI:

```bash
npx supabase login                                       # one-time
npx supabase link --project-ref ynnbqtbnzrhayhenxdby     # one-time
npx supabase db push                                     # applies all migrations
# or: npm run db:push
```

Then in **Authentication → Users**, create the two demo users, and link each to an agency:

```sql
insert into public.agents (user_id, agency_id) values
  ('<user-uuid-1>', (select id from public.agencies where slug='acme-realty')),
  ('<user-uuid-2>', (select id from public.agencies where slug='north-star-re'));
```

(That second snippet stays manual because it references `auth.users` UUIDs created on-demand by the dashboard, not by migrations.)

## Deploy (Cloudflare Workers, local)

```bash
cp .env.example .env.production    # same vars as .env.local
npm run build                      # bakes VITE_* into dist/
npx wrangler deploy                # uploads dist/ as a Worker
```

`wrangler.toml` declares `proppilot.shafu.xyz` as a custom domain. The first deploy provisions the DNS record + TLS cert. In Supabase → Authentication → URL Configuration, add `https://proppilot.shafu.xyz` to **Site URL** and **Redirect URLs**.

## How RLS works (the two-audience problem)

Anonymous visitors (the public form) and authenticated agents both hit `public.contacts`. RLS lives entirely in SQL — the React app trusts the database, not the other way around.

- **`agencies`** — public `SELECT` for both `anon` and `authenticated` on `(id, slug, name)`. The form page needs to resolve a slug → id without a session. No write policies, so nobody can mint agencies from the client.
- **`agents`** — `SELECT` only for `auth.uid() = user_id`. An agent can read their own row to learn which agency they belong to; that's all.
- **`contacts`** — four policies:
  - `anon` `INSERT`: allowed iff `status = 'new'`. The FK on `agency_id` already enforces that the agency exists, so the policy doesn't re-check it. (My first draft included an `exists (select 1 from agencies …)` in the `WITH CHECK`; that subquery against another RLS-protected table silently rejected every insert in practice. The FK does the same job without the gotcha.) No `SELECT` for anon — they can't read anyone's inbox.
  - `authenticated` `SELECT`: `agency_id IN (SELECT agency_id FROM agents WHERE user_id = auth.uid())`. Tenant isolation comes from this subquery, not from the app sending an `.eq()` filter.
  - `authenticated` `UPDATE`: same agency check, both `USING` and `WITH CHECK`. The app sends `update({ status })`, but a `BEFORE UPDATE` trigger rejects any change to `id / agency_id / name / email / message / created_at` — so an agent can't rewrite a contact's email or hijack a row into another agency.
  - No `DELETE` policy → deletes are denied by default for both audiences.

Things I considered and rejected:

- **Wrap the public insert in a `SECURITY DEFINER` RPC.** Cleaner — could enforce arbitrary validation server-side — but more code for the same outcome since RLS already restricts the insert shape. Skipped for the 2-hour budget.
- **Hide agency slug→id behind an RPC.** Same reasoning. Slugs are meant to be shared in URLs; exposing `(id, slug, name)` doesn't leak anything sensitive.
- **Column-level grants instead of a trigger.** Postgres column-level `UPDATE` privileges would let me say "agents can update only the `status` column", but they don't play cleanly with PostgREST's column inference. The trigger is more explicit and easier to read.

Things still open by design (anon can submit to any existing agency): rate-limiting the public form is out of scope. The right place for it is a thin Worker (`fetch` handler doing IP-bucket + Turnstile) in front of the Supabase insert.

## Avoiding duplicates between initial fetch and realtime

`Inbox.tsx` keeps contacts in a `Map<id, Contact>`:

1. **Subscribe first, fetch second.** The realtime channel is opened before the `SELECT * FROM contacts`, so events arriving during the round-trip aren't dropped.
2. **Map keyed by `id`.** Any row arriving via both paths overwrites itself in place — render order is `Array.from(map.values()).sort(by created_at desc)`.
3. **Snapshot never overwrites newer realtime data.** When the snapshot resolves, we only `set` rows whose `created_at` is `<=` the row already in the Map, so a realtime UPDATE that arrived first isn't clobbered by a stale snapshot row.
4. **UPDATEs use the same Map.** A status change from another agent's session flows through the same `set(id, row)` path; nothing special.

Optimistic status changes use the same pattern: write to the Map immediately, fire the UPDATE, roll back on error.

## What I left out (and why)

- **Pagination / search.** Inbox is small in the demo. A `LIMIT` + cursor would be one more `eq().lt('created_at', cursor)` call.
- **Email notifications.** Out of scope.
- **Rate-limiting / Turnstile** on the public form. Important in production; not asked for. See the note above for where it would slot in.
- **Agent self-signup.** Demo users created manually in the Supabase Dashboard. A real signup flow needs an invite system per agency.
- **Toasts, animations, dark mode.** Tailwind defaults only.
- **Server-side validation** beyond the RLS policies + trigger. Trimmed strings client-side; trusting RLS for everything else.

## Where AI helped vs hurt

- **Helped:** scaffolding the RLS policies and the trigger that restricts which columns are mutable — got the shape right the first time, including the `WITH CHECK` on UPDATE which is easy to forget. Also good at the "subscribe-then-fetch + Map dedup" boilerplate, which I usually get subtly wrong.
- **Hurt:** two real cycles wasted —
  1. The initial draft did `select('agency_id, agencies(name)')` and the generated TS types treated the relation as an array. Swapping to two sequential queries was faster than fighting the typegen.
  2. The first anon `INSERT` policy had `with check (status='new' and exists (select 1 from agencies where id = agency_id))`. Looked fine on paper. Empirically: every anon insert got rejected with an RLS violation, even though the EXISTS subquery returned true when run standalone as the anon role. I only caught it because I tested the end-to-end flow with curl after applying the migration. Dropping the EXISTS (the FK on `agency_id` does the same job) made it pass. I'd dig into the policy-context quirk if this were going to prod.
- **Judgement calls I'd flag:** the trigger-vs-column-grant decision and the choice not to use an RPC. Both are defensible either way; happy to walk through them.
