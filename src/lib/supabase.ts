import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Set them in .env.local for dev or .env.production for build.',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
})

export type ContactStatus = 'new' | 'contacted' | 'discarded'

export type Contact = {
  id: string
  agency_id: string
  name: string
  email: string
  message: string
  status: ContactStatus
  created_at: string
}

export type Agency = {
  id: string
  slug: string
  name: string
}
