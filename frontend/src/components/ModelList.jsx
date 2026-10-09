import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { modelAPI, adminAPI } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

function formatSize(bytes) {
  if (!bytes) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(2)} ${units[i]}`
}

function SkeletonCard() {
  return (
    <div className="card" style={{ opacity: 0.6 }}>
      <div className="card-header">
        <div className="skeleton" style={{ width: '60%', height: '1.25rem' }}></div>
        <div className="skeleton" style={{ width: '60px', height: '24px' }}></div>
      </div>
      <div className="skeleton" style={{ width: '100%', height: '1rem' }}></div>
      <div className="skeleton" style={{ width: '80%', height: '1rem' }}></div>
      <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
        <div className="skeleton" style={{ width: '80px', height: '1rem' }}></div>
        <div className="skeleton" style={{ width: '60px', height: '1rem' }}></div>
      </div>
    </div>
  )
}

export function ModelList() {
  const { user } = useAuth()
  const toast = useToast()
  const [models, setModels] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('') // Uncommitted search query
  const [search, setSearch] = useState('') // Committed search query
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [importing, setImporting] = useState(false)
  const navigate = useNavigate()

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const params = { page, page_size: 12 }
      if (search) params.search = search
      const response = await modelAPI.list(params)
      setModels(response.data.items)
      setTotal(response.data.total)
    } catch (err) {
      console.error('Failed to load models:', err)
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => {
    loadModels()
  }, [loadModels])

  const handleSearch = (e) => {
    e.preventDefault()
    setSearching(true)
    setSearch(query) // Commit the query
    setPage(1)
  }

  const handleInputChange = (e) => {
    setQuery(e.target.value)
  }

  const handleImport = async () => {
    if (!confirm('Import all eligible model files from the server folder? This may take a moment.')) return

    setImporting(true)
    try {
      const response = await adminAPI.import()
      const { imported, skipped, failed } = response.data

      let message = `Import complete: ${imported.length} imported, ${skipped.length} skipped`
      if (failed.length > 0) {
        message += `, ${failed.length} failed`
      }
      toast.success(message)

      // Reload models to show imported files
      await loadModels()
    } catch (err) {
      const errorMsg = err.response?.data?.detail || 'Import failed'
      toast.error(errorMsg)
    } finally {
      setImporting(false)
    }
  }

  const totalPages = Math.ceil(total / 12)

  return (
    <div>
      <div className="search-box">
        <form onSubmit={handleSearch} style={{ display: 'flex', gap: '1rem', width: '100%' }}>
          <input
            type="text"
            className="form-control"
            placeholder="Search models..."
            value={query}
            onChange={handleInputChange}
          />
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {user?.is_admin && (
            <button
              className="btn btn-secondary"
              onClick={handleImport}
              disabled={importing}
              title="Import files from server folder"
            >
              {importing ? 'Importing...' : 'Import from Server'}
            </button>
          )}
          <button className="btn btn-success" onClick={() => navigate('/upload')}>
            Upload Model
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-3">
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : searching ? (
        <div className="grid grid-3">
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : models.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <h3>No models found</h3>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
            {search ? 'Try a different search term' : 'Upload your first model to get started'}
          </p>
        </div>
      ) : (
        <div className="grid grid-3">
          {models.map((model) => (
            <div key={model.id} className="card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/model/${model.id}`)}>
              <div className="card-header">
                <h3 className="card-title">{model.name}</h3>
                {model.framework && (
                  <span className="badge badge-primary">{model.framework}</span>
                )}
              </div>
              {model.description && (
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  {model.description.length > 150
                    ? model.description.substring(0, 150) + '...'
                    : model.description}
                </p>
              )}
              <div className="model-meta">
                {model.architecture && <span>{model.architecture}</span>}
                {model.parameter_count && <span>{formatParamCount(model.parameter_count)}</span>}
                {model.quantization && <span>{model.quantization}</span>}
                {model.size_bytes && <span className="size">{formatSize(model.size_bytes)}</span>}
                {model.version && <span>v{model.version}</span>}
              </div>
              {model.tags && model.tags.length > 0 && (
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {model.tags.slice(0, 3).map((tag, i) => (
                    <span key={i} className="badge badge-secondary">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="pagination">
          <button disabled={page === 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={p}
              className={p === page ? 'active' : ''}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          ))}
          <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}

function formatParamCount(val) {
  if (!val) return 'Unknown'
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(1)}B`
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(1)}K`
  return String(val)
}
