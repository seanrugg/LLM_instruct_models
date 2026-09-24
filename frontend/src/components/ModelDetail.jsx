import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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

export function ModelDetail() {
  const { id } = useParams()
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    loadModel()
  }, [id])

  const loadModel = async () => {
    setLoading(true)
    try {
      const response = await modelAPI.get(id)
      setModel(response.data)
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load model')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this model?')) return

    try {
      await modelAPI.delete(id)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete model')
    }
  }

  const handleDownload = () => {
    const url = modelAPI.download(id)
    window.open(url, '_blank')
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '3rem' }}>Loading...</div>
  if (error) return <div className="alert alert-error">{error}</div>
  if (!model) return null

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginBottom: '1rem' }}>
        Back
      </button>

      <div className="card">
        <div className="card-header">
          <h2>{model.name}</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-success" onClick={handleDownload}>
              Download
            </button>
            <button className="btn btn-danger" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>

        {model.description && (
          <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>
            {model.description}
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {model.framework && (
            <div>
              <strong style={{ color: 'var(--text-secondary)' }}>Framework</strong>
              <p>{model.framework}</p>
            </div>
          )}
          {model.version && (
            <div>
              <strong style={{ color: 'var(--text-secondary)' }}>Version</strong>
              <p>{model.version}</p>
            </div>
          )}
          {model.size_bytes && (
            <div>
              <strong style={{ color: 'var(--text-secondary)' }}>Size</strong>
              <p className="size">{formatSize(model.size_bytes)}</p>
            </div>
          )}
          {model.original_filename && (
            <div>
              <strong style={{ color: 'var(--text-secondary)' }}>Filename</strong>
              <p className="size" style={{ wordBreak: 'break-all' }}>{model.original_filename}</p>
            </div>
          )}
        </div>

        {model.tags && model.tags.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Tags</strong>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              {model.tags.map((tag, i) => (
                <span key={i} className="badge badge-primary">{tag}</span>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          <p>Created: {new Date(model.created_at).toLocaleDateString()}</p>
          <p>Updated: {new Date(model.updated_at).toLocaleDateString()}</p>
        </div>
      </div>
    </div>
  )
}
