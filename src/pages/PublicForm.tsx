import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase, type Agency } from '../lib/supabase'

export function PublicForm() {
  const { agencySlug } = useParams<{ agencySlug: string }>()
  const [agency, setAgency] = useState<Agency | null>(null)
  const [lookup, setLookup] = useState<'loading' | 'found' | 'not_found'>('loading')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!agencySlug) return
    let cancelled = false
    setLookup('loading')
    supabase
      .rpc('agency_by_slug', { p_slug: agencySlug })
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setLookup('not_found')
        } else {
          setAgency(data as Agency)
          setLookup('found')
        }
      })
    return () => {
      cancelled = true
    }
  }, [agencySlug])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!agency) return
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.from('contacts').insert({
      agency_id: agency.id,
      name: name.trim(),
      email: email.trim(),
      message: message.trim(),
    })
    setSubmitting(false)
    if (error) {
      setError(error.message)
      return
    }
    setSubmitted(true)
    setName('')
    setEmail('')
    setMessage('')
  }

  if (lookup === 'loading') {
    return <CenteredCard>Loading…</CenteredCard>
  }
  if (lookup === 'not_found') {
    return (
      <CenteredCard>
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Agency not found</h1>
        <p className="text-slate-600">The link you followed doesn’t match any agency.</p>
      </CenteredCard>
    )
  }

  return (
    <CenteredCard>
      <h1 className="mb-1 text-2xl font-semibold text-slate-900">Contact {agency!.name}</h1>
      <p className="mb-6 text-sm text-slate-500">Leave your details and an agent will get back to you.</p>

      {submitted ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
          Thanks — your message has been sent.
          <button
            className="ml-3 text-sm font-medium underline"
            onClick={() => setSubmitted(false)}
          >
            Send another
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Name">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </Field>
          <Field label="Email">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </Field>
          <Field label="Message">
            <textarea
              required
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 outline-none focus:border-slate-900"
            />
          </Field>
          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? 'Sending…' : 'Send message'}
          </button>
        </form>
      )}
    </CenteredCard>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  )
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md items-center px-4 py-12">
      <div className="w-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm">{children}</div>
    </div>
  )
}
