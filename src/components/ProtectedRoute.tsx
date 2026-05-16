import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../lib/AuthContext'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) {
    return <div className="flex h-full items-center justify-center text-slate-500">Loading…</div>
  }
  if (!session) return <Navigate to="/login" replace />
  return <>{children}</>
}
