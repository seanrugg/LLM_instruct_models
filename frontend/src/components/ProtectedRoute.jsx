import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute({ children }) {
  const { token, loading } = useAuth()

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>
  }

  if (!token) {
    return <Navigate to="/login" replace />
  }

  return children
}

export function PublicRoute({ children }) {
  const { token, loading } = useAuth()

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>
  }

  if (token) {
    return <Navigate to="/" replace />
  }

  return children
}
