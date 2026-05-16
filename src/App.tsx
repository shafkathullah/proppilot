import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PublicForm } from './pages/PublicForm'
import { Login } from './pages/Login'
import { Inbox } from './pages/Inbox'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/inbox" replace />} />
          <Route path="/login" element={<Login />} />
          <Route path="/c/:agencySlug" element={<PublicForm />} />
          <Route
            path="/inbox"
            element={
              <ProtectedRoute>
                <Inbox />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}

function NotFound() {
  return (
    <div className="flex h-full items-center justify-center p-8 text-slate-500">
      Not found.
    </div>
  )
}
