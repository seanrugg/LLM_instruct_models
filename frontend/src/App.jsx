import React from 'react'
import { Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom'
import { Login, Register } from './components/Auth'
import { ModelList } from './components/ModelList'
import { ModelDetail } from './components/ModelDetail'
import { UploadModel } from './components/UploadModel'

function Header() {
  const navigate = useNavigate()
  const location = useLocation()
  const user = JSON.parse(localStorage.getItem('user') || 'null')
  const token = localStorage.getItem('token')

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  if (!token) return null

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

function App() {
  const token = localStorage.getItem('token')

  return (
    <div>
      <Header />
      <main className="container">
        <Routes>
          <Route
            path="/login"
            element={token ? <ModelList /> : <Login />}
          />
          <Route
            path="/register"
            element={!token ? <Register /> : <ModelList />}
          />
          <Route
            path="/"
            element={token ? <ModelList /> : <Login />}
          />
          <Route
            path="/upload"
            element={token ? <UploadModel /> : <Login />}
          />
          <Route
            path="/model/:id"
            element={token ? <ModelDetail /> : <Login />}
          />
        </Routes>
      </main>
    </div>
  )
}

export default App
