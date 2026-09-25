import React, { createContext, useState, useContext, useEffect } from 'react'
import { authAPI } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('user')
    return stored ? JSON.parse(stored) : null
  })
  const [loading, setLoading] = useState(true)
  const [allowRegistration, setAllowRegistration] = useState(true)

  // Fetch auth config on mount
  useEffect(() => {
    loadAuthConfig()
  }, [])

  const loadAuthConfig = async () => {
    try {
      const response = await authAPI.getConfig()
      setAllowRegistration(response.data.allow_registration)
    } catch (err) {
      console.error('Failed to load auth config:', err)
      setAllowRegistration(false)
    } finally {
      setLoading(false)
    }
  }

  const login = (tokenData, userData) => {
    localStorage.setItem('token', tokenData.access_token)
    localStorage.setItem('user', JSON.stringify(userData))
    setToken(tokenData.access_token)
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setToken(null)
    setUser(null)
  }

  const value = {
    token,
    user,
    allowRegistration,
    loading,
    login,
    logout,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
