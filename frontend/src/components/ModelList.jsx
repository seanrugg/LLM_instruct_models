import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { modelAPI } from '../api/client'

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

export function ModelList() {
  const [models, setModels] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    loadModels()
  }, [page, search])

  const loadModels = async () => {
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
  }

  const handleSearch = (e) => {
    e.preventDefault()
    setPage(1)
    loadModels()
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button type="submit" className="btn btn-primary">Search</button>
        </form>
        <button className="btn btn-success" onClick={() => navigate('/upload')}>
          Upload Model
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>
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
                {model.version && <span>v{model.version}</span>}
                {model.size_bytes && <span className="size">{formatSize(model.size_bytes)}</span>}
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
