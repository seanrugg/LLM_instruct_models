import React from 'react'
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ProtectedRoute, PublicRoute } from './components/ProtectedRoute'
import { Login, Register } from './components/Auth'
import { ModelList } from './components/ModelList'
import { ModelDetail } from './components/ModelDetail'
import { UploadModel } from './components/UploadModel'

function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, allowRegistration, logout } = useAuth()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <header className="header">
      <h1>LLM Models</h1>
      <nav className="nav">
        <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
          Browse
        </Link>
        <Link to="/upload" className={location.pathname === '/upload' ? 'active' : ''}>
          Upload
        </Link>
        {!allowRegistration && (
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
            Contact admin for account
          </span>
        )}
        {user && (
          <span style={{ color: 'var(--text-secondary)' }}>
            {user.username}
          </span>
        )}
        <button className="btn btn-secondary" onClick={handleLogout}>
          Logout
        </button>
      </nav>
    </header>
  )
}

function AppContent() {
  const { allowRegistration } = useAuth()

  return (
    <div>
      <Header />
      <main className="container">
        <Routes>
          <Route
            path="/login"
            element={
              <PublicRoute>
                <Login />
              </PublicRoute>
            }
          />
          {allowRegistration && (
            <Route
              path="/register"
              element={
                <PublicRoute>
                  <Register />
                </PublicRoute>
              }
            />
          )}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <ModelList />
              </ProtectedRoute>
            }
          />
          <Route
            path="/upload"
            element={
              <ProtectedRoute>
                <UploadModel />
              </ProtectedRoute>
            }
          />
          <Route
            path="/model/:id"
            element={
              <ProtectedRoute>
                <ModelDetail />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  )
}

export default App
