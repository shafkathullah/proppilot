import { useEffect, useMemo, useState } from 'react'
import { supabase, type Contact, type ContactStatus } from '../lib/supabase'

const STATUSES: ContactStatus[] = ['new', 'contacted', 'discarded']

export function Inbox() {
  const [contacts, setContacts] = useState<Map<string, Contact>>(new Map())
  const [agencyId, setAgencyId] = useState<string | null>(null)
  const [agencyName, setAgencyName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Resolve the signed-in agent's agency, then fetch + subscribe.
  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      setLoading(true)
      setError(null)

      const { data: agentRow, error: agentErr } = await supabase
        .from('agents')
        .select('agency_id')
        .maybeSingle()

      if (cancelled) return
      if (agentErr) {
        setError(agentErr.message)
        setLoading(false)
        return
      }
      if (!agentRow) {
        setError('No agency is linked to this account.')
        setLoading(false)
        return
      }
      const aid = (agentRow as { agency_id: string }).agency_id
      setAgencyId(aid)

      const { data: agencyRow } = await supabase
        .from('agencies')
        .select('name')
        .eq('id', aid)
        .maybeSingle()
      if (!cancelled && agencyRow) {
        setAgencyName((agencyRow as { name: string }).name)
      }

      // Subscribe FIRST so we don't drop events arriving during the fetch.
      channel = supabase
        .channel(`contacts:${aid}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'contacts', filter: `agency_id=eq.${aid}` },
          (payload) => {
            const row = payload.new as Contact
            setContacts((prev) => {
              if (prev.has(row.id)) return prev
              const next = new Map(prev)
              next.set(row.id, row)
              return next
            })
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'contacts', filter: `agency_id=eq.${aid}` },
          (payload) => {
            const row = payload.new as Contact
            setContacts((prev) => {
              const next = new Map(prev)
              next.set(row.id, row)
              return next
            })
          },
        )
        .subscribe()

      // Then load the initial snapshot. The Map dedupes any overlap.
      const { data, error: fetchErr } = await supabase
        .from('contacts')
        .select('*')
        .eq('agency_id', aid)
        .order('created_at', { ascending: false })

      if (cancelled) return
      if (fetchErr) {
        setError(fetchErr.message)
        setLoading(false)
        return
      }
      setContacts((prev) => {
        const next = new Map(prev)
        for (const c of data as Contact[]) {
          // Don't overwrite a newer realtime row with a stale snapshot row.
          const existing = next.get(c.id)
          if (!existing || existing.created_at <= c.created_at) next.set(c.id, c)
        }
        return next
      })
      setLoading(false)
    }

    init()
    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  const sorted = useMemo(
    () =>
      Array.from(contacts.values()).sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      ),
    [contacts],
  )

  async function changeStatus(id: string, status: ContactStatus) {
    const prev = contacts.get(id)
    if (!prev) return
    setContacts((m) => {
      const next = new Map(m)
      next.set(id, { ...prev, status })
      return next
    })
    const { error } = await supabase.from('contacts').update({ status }).eq('id', id)
    if (error) {
      setContacts((m) => {
        const next = new Map(m)
        next.set(id, prev)
        return next
      })
      alert(`Failed to update status: ${error.message}`)
    }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Inbox</h1>
          {agencyName && <p className="text-sm text-slate-500">{agencyName}</p>}
        </div>
        <button
          onClick={signOut}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-100"
        >
          Sign out
        </button>
      </header>

      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-slate-500">
          No contacts yet. They’ll appear here in realtime.
        </div>
      ) : (
        <ul className="space-y-3">
          {sorted.map((c) => (
            <li
              key={c.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{c.name}</span>
                    <span className="text-sm text-slate-500">&lt;{c.email}&gt;</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {new Date(c.created_at).toLocaleString()}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-slate-700">{c.message}</p>
                </div>
                <select
                  value={c.status}
                  onChange={(e) => changeStatus(c.id, e.target.value as ContactStatus)}
                  className={`shrink-0 rounded-md border px-2 py-1 text-sm ${statusClasses(c.status)}`}
                  aria-label="Status"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </li>
          ))}
        </ul>
      )}

      {agencyId && (
        <p className="mt-8 text-xs text-slate-400">
          Public form:{' '}
          <code className="rounded bg-slate-100 px-1 py-0.5">/c/&lt;your-slug&gt;</code>
        </p>
      )}
    </div>
  )
}

function statusClasses(status: ContactStatus) {
  switch (status) {
    case 'new':
      return 'border-blue-300 bg-blue-50 text-blue-800'
    case 'contacted':
      return 'border-emerald-300 bg-emerald-50 text-emerald-800'
    case 'discarded':
      return 'border-slate-300 bg-slate-100 text-slate-700'
  }
}
