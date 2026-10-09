import React, { useState, useCallback, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { modelAPI, userAPI, setUploadInProgress } from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const ALLOWED_EXTENSIONS = ['.gguf', '.pt', '.pth', '.safetensors', '.onnx', '.tar', '.zip', '.gz', '.bin']
const FRAMEWORK_MAP = {
  '.gguf': 'gguf',
  '.pt': 'pytorch',
  '.pth': 'pytorch',
  '.safetensors': 'safetensors',
  '.onnx': 'onnx',
  '.tar': 'other',
  '.zip': 'other',
  '.gz': 'other',
  '.bin': 'other',
}

function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(2)} ${units[i]}`
}

function guessFramework(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return FRAMEWORK_MAP[ext] || ''
}

function sanitizeName(filename) {
  const name = filename.replace(/\.[^.]+$/, '')
  return name.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatETA(bytesPerSec, remaining) {
  if (bytesPerSec <= 0 || remaining <= 0) return '--'
  const seconds = Math.ceil(remaining / bytesPerSec)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

// Lazy-load the ESM parser module (browser-compatible)
let parserModule = null
async function loadParser () {
  if (!parserModule) {
    parserModule = await import('../lib/modelHeader.mjs')
  }
  return parserModule
}

async function parseFileInBrowser (file) {
  const parser = await loadParser()
  const arrayBuffer = await file.slice().arrayBuffer()
  const uint8 = new Uint8Array(arrayBuffer)

  const readBytes = async (offset, length) => {
    return uint8.slice(offset, offset + length)
  }

  return parser.parseModelHeader(readBytes, file.size, file.name)
}

export function UploadModel() {
  const { user, token, login, logout } = useAuth()
  const toast = useToast()
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [metadata, setMetadata] = useState({
    name: '',
    description: '',
    version: '',
    tags: '',
  })
  const [detected, setDetected] = useState(null) // parsed file metadata
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressDetail, setProgressDetail] = useState('') // "1.2 GB / 5.0 GB · 12.3 MB/s · 5m 23s"
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [successData, setSuccessData] = useState(null) // { id, sha256, name }
  const [modelId, setModelId] = useState(null)
  const navigate = useNavigate()
  const uploadRef = useRef(false) // ref for beforeunload guard

  // beforeunload guard
  useEffect(() => {
    if (uploading) {
      const handler = (e) => {
        e.preventDefault()
        e.returnValue = 'Upload in progress. Are you sure you want to leave?'
        return e.returnValue
      }
      window.addEventListener('beforeunload', handler)
      return () => window.removeEventListener('beforeunload', handler)
    }
  }, [uploading])

  const handleFile = useCallback(async (selectedFile) => {
    if (!selectedFile) return

    const ext = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
      return
    }

    setFile(selectedFile)
    setError('')

    // Auto-populate from filename
    const framework = guessFramework(selectedFile.name)
    setMetadata({
      name: sanitizeName(selectedFile.name),
      description: '',
      version: '',
      tags: '',
    })
    setDetected(null) // clear previous detection

    // Parse file in background to extract metadata
    try {
      const parsed = await parseFileInBrowser(selectedFile)
      setDetected(parsed)
      // Auto-fill name from parsed metadata if available and currently empty/default
      if (parsed.source_model_name && parsed.source_model_name !== sanitizeName(selectedFile.name)) {
        setMetadata(prev => ({ ...prev, name: parsed.source_model_name }))
      }
    } catch (err) {
      console.error('File parsing error:', err)
      setDetected({ warnings: [`Failed to parse file: ${err.message}`] })
    }
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) handleFile(droppedFile)
  }, [handleFile])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
  }, [])

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!file) {
      setError('Please select a file')
      return
    }
    if (!metadata.name.trim()) {
      setError('Model name is required')
      return
    }

    setUploading(true)
    setProgress(0)
    setProgressDetail('')
    setError('')
    setSuccess(false)
    uploadRef.current = true
    setUploadInProgress(true)

    let createdModelId = null

    try {
      // Check if session is still valid before creating
      try {
        await userAPI.getMe()
      } catch (err) {
        if (err.response?.status === 401) {
          logout()
          setError('Your session has expired. Please log in again.')
          toast.error('Session expired. Please log in again.')
          navigate('/login')
          return
        }
        // Other errors (network, 500, etc.) are non-fatal; continue with upload
        console.warn('Session check failed:', err.response?.status || err.message)
      }

      // Create model
      const modelResponse = await modelAPI.create({
        name: metadata.name.trim(),
        description: metadata.description || null,
        version: metadata.version || null,
        tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
      })

      createdModelId = modelResponse.data.id
      setModelId(createdModelId)

      // Upload file with progress
      const response = await modelAPI.upload(createdModelId, file, {
        onUploadProgress: (progressEvent) => {
          const loaded = progressEvent.loaded || 0
          const total = progressEvent.total || file.size
          const pct = Math.round((loaded * 100) / total)
          setProgress(pct)

          if (total > 0) {
            const bytesPerSec = loaded / ((Date.now() - (progressEvent.config && progressEvent.config.metadata ? progressEvent.config.metadata.startTime : Date.now())) || 1)
            const remaining = total - loaded
            const speed = formatSize(bytesPerSec) + '/s'
            const eta = formatETA(bytesPerSec, remaining)
            setProgressDetail(`${formatSize(loaded)} / ${formatSize(total)} · ${speed} · ETA ${eta}`)
          }
        },
        metadata: { startTime: Date.now() },
      })

      setSuccess(true)
      setSuccessData({
        id: createdModelId,
        sha256: response.data.sha256,
        name: response.data.name,
        file_format: response.data.file_format,
      })
      toast.success(`Upload complete: ${response.data.name}`)
    } catch (err) {
      // Clean up orphan model record if upload failed after create
      if (createdModelId) {
        try {
          await modelAPI.delete(createdModelId)
        } catch (_) { /* ignore cleanup errors */ }
      }

      let errorMessage = 'Upload failed'
      if (err.response?.status === 413) {
        // 413 can come from the app (size limit) or the proxy (nginx/apache limit)
        const detail = err.response.data?.detail
        if (detail && detail.includes('Maximum size')) {
          errorMessage = detail
        } else {
          errorMessage = 'Rejected by the web server as too large (proxy limit)'
        }
      } else if (err.response?.status === 409) {
        errorMessage = 'A file has already been uploaded for this model. Create a new model or version instead.'
      } else if (err.response?.status === 400) {
        errorMessage = 'Upload failed: ' + (err.response.data?.detail || 'Invalid file')
      } else if (err.response?.status === 401) {
        errorMessage = 'Session expired. Please log in again.'
      } else if (err.response) {
        // 400, 413, 422, 500, etc. — show the real error
        errorMessage = err.response.data?.detail || `Upload failed (${err.response.status})`
      } else {
        // Network error or other failure
        errorMessage = err.message || 'Upload failed (network error)'
      }
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setUploading(false)
      uploadRef.current = false
      setUploadInProgress(false)
    }
  }

  const copySha256 = async () => {
    if (successData?.sha256) {
      try {
        await navigator.clipboard.writeText(successData.sha256)
      } catch (_) { /* ignore */ }
    }
  }

  if (success) {
    return (
      <div style={{ maxWidth: 600, margin: '4rem auto' }}>
        <div className="card">
          <div className="alert alert-success">
            <h3 style={{ marginTop: 0 }}>Upload Complete!</h3>
            <p><strong>{successData.name}</strong></p>
            {successData.file_format && (
              <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                Format: {successData.file_format}
              </p>
            )}
            {successData.sha256 && (
              <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <code style={{
                  flex: 1,
                  fontSize: '0.75rem',
                  padding: '0.5rem',
                  background: 'var(--bg)',
                  borderRadius: '0.25rem',
                  wordBreak: 'break-all',
                  border: '1px solid var(--border)',
                  fontFamily: 'monospace',
                }}>
                  {successData.sha256}
                </code>
                <button className="btn btn-secondary" onClick={copySha256} title="Copy SHA-256">
                  Copy
                </button>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '1.5rem' }}>
            <button
              className="btn btn-primary"
              onClick={() => navigate(`/model/${successData.id}`)}
            >
              View Model
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setFile(null)
                setDetected(null)
                setMetadata({ name: '', description: '', version: '', tags: '' })
                setSuccess(false)
                setSuccessData(null)
                setModelId(null)
              }}
            >
              Upload Another
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 700, margin: '2rem auto' }}>
      <div className="card">
        <h2 style={{ marginBottom: '1.5rem' }}>Upload Model</h2>

        {error && <div className="alert alert-error">{error}</div>}

        <form onSubmit={handleUpload}>
          {/* File drop zone */}
          <div
            className="upload-zone"
            onClick={() => document.getElementById('file-input').click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            style={{
              cursor: 'pointer',
              border: dragging ? '2px dashed var(--primary)' : '2px dashed var(--border)',
              background: dragging ? 'var(--primary-light)' : 'var(--bg)',
            }}
          >
            <input
              id="file-input"
              type="file"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])}
              accept={ALLOWED_EXTENSIONS.join(',')}
            />
            {file ? (
              <div>
                <p style={{ fontSize: '1.25rem', fontWeight: 500 }}>{file.name}</p>
                <p style={{ color: 'var(--text-secondary)' }}>
                  {formatSize(file.size)}
                </p>
                <p style={{ marginTop: '0.5rem', color: 'var(--primary)' }}>
                  Click or drop to change file
                </p>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: '1.25rem', fontWeight: 500 }}>
                  Drag & drop a file here, or click to select
                </p>
                <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Allowed: {ALLOWED_EXTENSIONS.join(', ')}
                </p>
              </div>
            )}
          </div>

          {/* Detected from file (read-only) */}
          {detected && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '1rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Detected from file
              </h3>
              <div style={{
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '0.5rem',
                padding: '1rem',
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                gap: '0.75rem',
              }}>
                {detected.architecture && (
                  <div>
                    <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Architecture</strong>
                    <p style={{ margin: 0 }}>{detected.architecture}</p>
                  </div>
                )}
                {detected.parameter_count && (
                  <div>
                    <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Parameters</strong>
                    <p style={{ margin: 0 }}>{formatSize(detected.parameter_count * 4)}</p> {/* rough estimate */}
                  </div>
                )}
                {detected.quantization && (
                  <div>
                    <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Quantization</strong>
                    <p style={{ margin: 0 }}>{detected.quantization}</p>
                  </div>
                )}
                {detected.context_length && (
                  <div>
                    <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Context Length</strong>
                    <p style={{ margin: 0 }}>{detected.context_length.toLocaleString()}</p>
                  </div>
                )}
                {detected.license && (
                  <div>
                    <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>License</strong>
                    <p style={{ margin: 0 }}>{detected.license}</p>
                  </div>
                )}
                {detected.source_model_name && (
                  <div>
                    <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Source Model</strong>
                    <p style={{ margin: 0 }}>{detected.source_model_name}</p>
                  </div>
                )}
              </div>
              {detected.warnings && detected.warnings.length > 0 && (
                <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--warning)' }}>
                  {detected.warnings.join('; ')}
                </div>
              )}
            </div>
          )}

          {/* User-editable metadata */}
          <div style={{ marginTop: '1.5rem' }}>
            <div className="form-group">
              <label>Model Name *</label>
              <input
                type="text"
                className="form-control"
                value={metadata.name}
                onChange={(e) => setMetadata({ ...metadata, name: e.target.value })}
                required
                placeholder="e.g., Llama-3-8B-Instruct"
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                className="form-control"
                value={metadata.description}
                onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                placeholder="Brief description of the model..."
                rows="3"
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label>Version</label>
                <input
                  type="text"
                  className="form-control"
                  value={metadata.version}
                  onChange={(e) => setMetadata({ ...metadata, version: e.target.value })}
                  placeholder="e.g., 1.0.0"
                />
              </div>
              <div className="form-group">
                <label>Tags (comma-separated)</label>
                <input
                  type="text"
                  className="form-control"
                  value={metadata.tags}
                  onChange={(e) => setMetadata({ ...metadata, tags: e.target.value })}
                  placeholder="e.g., instruction, finetune, 7b"
                />
              </div>
            </div>
          </div>

          {/* Progress indicator */}
          {uploading && (
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span>{progress < 100 ? 'Uploading...' : 'Finalizing: hashing and verifying...'}</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: progress === 100 ? 'var(--success)' : 'var(--primary)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
              {progressDetail && (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  {progressDetail}
                </p>
              )}
              {progress < 100 && (
                <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>
                  Do not close this page while uploading.
                </p>
              )}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={!file || uploading}
            style={{ width: '100%', marginTop: '1.5rem' }}
          >
            {uploading ? 'Uploading...' : 'Upload Model'}
          </button>
        </form>
      </div>
    </div>
  )
}
