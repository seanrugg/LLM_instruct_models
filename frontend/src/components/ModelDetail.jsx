import React, { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { modelAPI } from '../api/client'
import { useToast } from '../context/ToastContext'

function formatSize(bytes) {
  if (!bytes || bytes === 0) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(2)} ${units[i]}`
}

const LOCKED_FIELDS = [
  { key: 'file_format', label: 'File Format' },
  { key: 'architecture', label: 'Architecture' },
  { key: 'parameter_count', label: 'Parameter Count' },
  { key: 'quantization', label: 'Quantization' },
  { key: 'context_length', label: 'Context Length' },
  { key: 'license', label: 'License' },
  { key: 'source_model_name', label: 'Source Model' },
  { key: 'sha256', label: 'SHA-256' },
]

function formatParamCount(val) {
  if (!val) return 'Unknown'
  if (val >= 1_000_000_000) return `${(val / 1_000_000_000).toFixed(2)}B`
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`
  return String(val)
}

function DetailSkeleton() {
  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div className="skeleton" style={{ width: '4rem', height: '2rem', marginBottom: '1rem' }}></div>
      <div className="card">
        <div className="card-header">
          <div className="skeleton" style={{ width: '40%', height: '1.5rem' }}></div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <div className="skeleton" style={{ width: '5rem', height: '2rem' }}></div>
            <div className="skeleton" style={{ width: '4rem', height: '2rem' }}></div>
            <div className="skeleton" style={{ width: '4rem', height: '2rem' }}></div>
          </div>
        </div>
        <div className="skeleton" style={{ width: '100%', height: '1rem' }}></div>
        <div className="skeleton" style={{ width: '80%', height: '1rem' }}></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginTop: '1.5rem' }}>
          <div className="skeleton" style={{ width: '100%', height: '3rem' }}></div>
          <div className="skeleton" style={{ width: '100%', height: '3rem' }}></div>
          <div className="skeleton" style={{ width: '100%', height: '3rem' }}></div>
        </div>
      </div>
      <div className="card" style={{ borderTop: '3px solid var(--success)' }}>
        <div className="skeleton" style={{ width: '30%', height: '1.25rem', marginBottom: '1rem' }}></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i}>
              <div className="skeleton" style={{ width: '60%', height: '0.875rem', marginBottom: '0.5rem' }}></div>
              <div className="skeleton" style={{ width: '100%', height: '1rem' }}></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function ModelDetail() {
  const { id } = useParams()
  const toast = useToast()
  const [model, setModel] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [downloading, setDownloading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', version: '', tags: '' })
  const [saving, setSaving] = useState(false)
  const [copiedSha, setCopiedSha] = useState(false)
  const [showChatTemplate, setShowChatTemplate] = useState(false)
  const [showFileMetadata, setShowFileMetadata] = useState(false)
  const navigate = useNavigate()

  const hasFileMetadata = model && (
    model.file_format ||
    model.architecture ||
    model.parameter_count ||
    model.quantization ||
    model.context_length ||
    model.license ||
    model.source_model_name ||
    model.sha256 ||
    model.chat_template ||
    (model.file_metadata && Object.keys(model.file_metadata).length > 0)
  )

  React.useEffect(() => {
    loadModel()
  }, [id])

  const loadModel = async () => {
    setLoading(true)
    try {
      const response = await modelAPI.get(id)
      setModel(response.data)
      setEditForm({
        name: response.data.name || '',
        description: response.data.description || '',
        version: response.data.version || '',
        tags: Array.isArray(response.data.tags) ? response.data.tags.join(', ') : (response.data.tags || ''),
      })
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load model')
      toast.error(err.response?.data?.detail || 'Failed to load model')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this model?')) return

    try {
      await modelAPI.delete(id)
      toast.success('Model deleted successfully')
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to delete model')
      toast.error(err.response?.data?.detail || 'Failed to delete model')
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    setError('')

    try {
      const tokenResponse = await modelAPI.generateDownloadToken(id)
      const token = tokenResponse.data.download_token
      const downloadUrl = modelAPI.download(id, token)
      window.location.href = downloadUrl
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to generate download link')
    } finally {
      setDownloading(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const tags = editForm.tags
        ? editForm.tags.split(',').map(t => t.trim()).filter(Boolean)
        : null
      await modelAPI.update(id, {
        name: editForm.name,
        description: editForm.description || null,
        version: editForm.version || null,
        tags,
      })
      setEditing(false)
      await loadModel()
      toast.success('Changes saved successfully')
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save changes')
      toast.error(err.response?.data?.detail || 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  const copySha256 = async () => {
    if (model?.sha256) {
      try {
        await navigator.clipboard.writeText(model.sha256)
        setCopiedSha(true)
        setTimeout(() => setCopiedSha(false), 2000)
      } catch (_) { /* ignore */ }
    }
  }

  if (loading) return <DetailSkeleton />
  if (error) return <div className="alert alert-error">{error}</div>
  if (!model) return null

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginBottom: '1rem' }}>
        Back
      </button>

      {/* Header */}
      <div className="card">
        <div className="card-header">
          <h2 style={{ margin: 0 }}>
            {editing ? (
              <input
                type="text"
                className="form-control"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                style={{ display: 'inline', width: 'auto' }}
              />
            ) : model.name}
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-success"
              onClick={handleDownload}
              disabled={downloading || !model.filename}
            >
              {downloading ? 'Generating...' : 'Download'}
            </button>
            {!editing && (
              <button className="btn btn-secondary" onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            <button className="btn btn-danger" onClick={handleDelete}>
              Delete
            </button>
          </div>
        </div>

        {/* Description */}
        {editing ? (
          <div className="form-group">
            <textarea
              className="form-control"
              value={editForm.description}
              onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
              rows="3"
              placeholder="Description"
            />
          </div>
        ) : model.description && (
          <p style={{ marginBottom: '1.5rem', lineHeight: 1.7 }}>{model.description}</p>
        )}

        {/* Editable fields */}
        {editing && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-group">
              <label>Version</label>
              <input
                type="text"
                className="form-control"
                value={editForm.version}
                onChange={(e) => setEditForm({ ...editForm, version: e.target.value })}
                placeholder="e.g., 1.0.0"
              />
            </div>
            <div className="form-group">
              <label>Tags (comma-separated)</label>
              <input
                type="text"
                className="form-control"
                value={editForm.tags}
                onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })}
                placeholder="e.g., instruction, 7b"
              />
            </div>
          </div>
        )}

        {/* Tags (display mode) */}
        {!editing && model.tags && model.tags.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <strong style={{ color: 'var(--text-secondary)' }}>Tags</strong>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
              {model.tags.map((tag, i) => (
                <span key={i} className="badge badge-primary">{tag}</span>
              ))}
            </div>
          </div>
        )}

        {/* File info grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {model.framework && (
            <div>
              <strong style={{ color: 'var(--text-secondary)' }}>Framework</strong>
              <p style={{ margin: 0 }}>{model.framework}</p>
            </div>
          )}
          {model.size_bytes && (
            <div>
              <strong style={{ color: 'var(--text-secondary)' }}>Size</strong>
              <p style={{ margin: 0, className: 'size' }}>{formatSize(model.size_bytes)}</p>
            </div>
          )}
          {model.original_filename && (
            <div>
              <strong style={{ color: 'var(--text-secondary)' }}>Filename</strong>
              <p style={{ margin: 0, wordBreak: 'break-all', fontSize: '0.875rem' }}>{model.original_filename}</p>
            </div>
          )}
        </div>

        {/* Timestamps */}
        <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          <p>Created: {new Date(model.created_at).toLocaleDateString()}</p>
          <p>Updated: {new Date(model.updated_at).toLocaleDateString()}</p>
          {editing && (
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setEditing(false); loadModel() }}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Verified from file panel */}
      {hasFileMetadata && (
        <div className="card" style={{ borderTop: '3px solid var(--success)' }}>
          <h3 style={{ fontSize: '1rem', color: 'var(--success)', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Verified from file
            {model.metadata_extracted_at && (
              <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                ({new Date(model.metadata_extracted_at).toLocaleString()})
              </span>
            )}
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
            {model.file_format && (
              <div>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Format</strong>
                <p style={{ margin: 0 }}>{model.file_format}</p>
              </div>
            )}
            {model.architecture && (
              <div>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Architecture</strong>
                <p style={{ margin: 0 }}>{model.architecture}</p>
              </div>
            )}
            {model.parameter_count && (
              <div>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Parameters</strong>
                <p style={{ margin: 0 }}>{formatParamCount(model.parameter_count)}</p>
              </div>
            )}
            {model.quantization && (
              <div>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Quantization</strong>
                <p style={{ margin: 0 }}>{model.quantization}</p>
              </div>
            )}
            {model.context_length && (
              <div>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Context Length</strong>
                <p style={{ margin: 0 }}>{model.context_length.toLocaleString()}</p>
              </div>
            )}
            {model.license && (
              <div>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>License</strong>
                <p style={{ margin: 0 }}>{model.license}</p>
              </div>
            )}
            {model.source_model_name && (
              <div>
                <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Source Model</strong>
                <p style={{ margin: 0 }}>{model.source_model_name}</p>
              </div>
            )}
          </div>

          {/* SHA-256 */}
          {model.sha256 && (
            <div style={{ marginTop: '1rem' }}>
              <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>SHA-256</strong>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                <code style={{
                  fontSize: '0.75rem',
                  padding: '0.5rem',
                  background: 'var(--bg)',
                  borderRadius: '0.25rem',
                  wordBreak: 'break-all',
                  border: '1px solid var(--border)',
                  fontFamily: 'monospace',
                  flex: 1,
                }}>
                  {model.sha256}
                </code>
                <button className="btn btn-secondary" onClick={copySha256} title="Copy SHA-256">
                  {copiedSha ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Chat template (collapsible) */}
          {model.chat_template && (
            <div style={{ marginTop: '1rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowChatTemplate(!showChatTemplate)}
                style={{ fontSize: '0.875rem' }}
              >
                {showChatTemplate ? 'Hide' : 'Show'} Chat Template
              </button>
              {showChatTemplate && (
                <pre style={{
                  marginTop: '0.5rem',
                  padding: '1rem',
                  background: 'var(--bg)',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--border)',
                  overflow: 'auto',
                  maxHeight: '300px',
                  fontSize: '0.8rem',
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {model.chat_template}
                </pre>
              )}
            </div>
          )}

          {/* File metadata JSON (collapsible) */}
          {model.file_metadata && Object.keys(model.file_metadata).length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => setShowFileMetadata(!showFileMetadata)}
                style={{ fontSize: '0.875rem' }}
              >
                {showFileMetadata ? 'Hide' : 'Show'} File Metadata
              </button>
              {showFileMetadata && (
                <pre style={{
                  marginTop: '0.5rem',
                  padding: '1rem',
                  background: 'var(--bg)',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--border)',
                  overflow: 'auto',
                  maxHeight: '300px',
                  fontSize: '0.8rem',
                  lineHeight: 1.6,
                }}>
                  {JSON.stringify(model.file_metadata, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
