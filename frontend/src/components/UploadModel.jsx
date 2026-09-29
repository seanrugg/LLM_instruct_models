import React, { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { modelAPI } from '../api/client'

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
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function guessFramework(filename) {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return FRAMEWORK_MAP[ext] || ''
}

function sanitizeName(filename) {
  // Remove extension and replace underscores/hyphens/spaces with spaces
  const name = filename.replace(/\.[^.]+$/, '')
  return name.replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function UploadModel() {
  const [file, setFile] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [metadata, setMetadata] = useState({
    name: '',
    description: '',
    version: '',
    framework: '',
    tags: '',
  })
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [modelId, setModelId] = useState(null)
  const navigate = useNavigate()

  const handleFile = useCallback((selectedFile) => {
    if (!selectedFile) return

    const ext = selectedFile.name.slice(selectedFile.name.lastIndexOf('.')).toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError(`File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
      return
    }

    setFile(selectedFile)
    setError('')
    setMetadata({
      name: sanitizeName(selectedFile.name),
      description: '',
      version: '',
      framework: guessFramework(selectedFile.name),
      tags: '',
    })
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
    setError('')

    try {
      // Create model
      const modelResponse = await modelAPI.create({
        name: metadata.name.trim(),
        description: metadata.description || null,
        version: metadata.version || null,
        framework: metadata.framework || null,
        tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
      })

      const modelId = modelResponse.data.id
      setModelId(modelId)

      // Upload file
      const response = await modelAPI.upload(modelId, file, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total))
          }
        },
      })

      setSuccess(true)
    } catch (err) {
      if (err.response?.status === 413) {
        setError('File too large. Maximum size: 50GB')
      } else if (err.response?.status === 400) {
        setError('Upload failed: ' + (err.response?.data?.detail || 'Invalid file'))
      } else {
        setError(err.response?.data?.detail || 'Upload failed')
      }
    } finally {
      setUploading(false)
    }
  }

  if (success) {
    return (
      <div style={{ maxWidth: 600, margin: '4rem auto', textAlign: 'center' }}>
        <div className="card">
          <div className="alert alert-success">
            <h3>Upload Complete!</h3>
            <p>Model: {metadata.name}</p>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Redirecting to model page...
            </p>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => navigate(`/model/${modelId}`)}
            style={{ marginTop: '1rem' }}
          >
            View Model
          </button>
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

          {/* Metadata form (shown after file selected) */}
          {file && (
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
                  <label>Framework</label>
                  <select
                    className="form-control"
                    value={metadata.framework}
                    onChange={(e) => setMetadata({ ...metadata, framework: e.target.value })}
                  >
                    <option value="">Select framework</option>
                    <option value="pytorch">PyTorch</option>
                    <option value="tensorflow">TensorFlow</option>
                    <option value="gguf">GGUF</option>
                    <option value="onnx">ONNX</option>
                    <option value="safetensors">Safetensors</option>
                    <option value="other">Other</option>
                  </select>
                </div>
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
          )}

          {/* Progress indicator */}
          {uploading && (
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <span>Uploading...</span>
                <span>{progress}%</span>
              </div>
              <div style={{ height: '8px', background: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--primary)',
                    transition: 'width 0.3s',
                  }}
                />
              </div>
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
