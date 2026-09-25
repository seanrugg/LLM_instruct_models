import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { modelAPI } from '../api/client'

export function UploadModel() {
  const [step, setStep] = useState(1)
  const [metadata, setMetadata] = useState({
    name: '',
    description: '',
    version: '',
    framework: '',
    tags: '',
  })
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const navigate = useNavigate()

  // Warn before leaving during upload
  useEffect(() => {
    if (!uploading) return

    const handleBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [uploading])

  const handleMetadataSubmit = (e) => {
    e.preventDefault()
    if (!metadata.name) {
      setError('Model name is required')
      return
    }
    setStep(2)
    setError('')
  }

  const handleFileSelect = (e) => {
    const selectedFile = e.target.files[0]
    if (selectedFile) {
      setFile(selectedFile)
      setError('')
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    if (!file) {
      setError('Please select a file')
      return
    }

    setUploading(true)
    setProgress(0)
    setError('')

    try {
      // Create model
      const modelResponse = await modelAPI.create({
        name: metadata.name,
        description: metadata.description || null,
        version: metadata.version || null,
        framework: metadata.framework || null,
        tags: metadata.tags ? metadata.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
      })

      const modelId = modelResponse.data.id

      // Upload file
      const response = await modelAPI.upload(modelId, file, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            setProgress(Math.round((progressEvent.loaded * 100) / progressEvent.total))
          }
        },
      })

      setSuccess(true)
      setTimeout(() => navigate(`/model/${modelId}`), 2000)
    } catch (err) {
      // Show specific error messages
      if (err.response?.status === 413) {
        setError('File too large. Maximum size: ' + (err.response?.data?.detail || '50GB'))
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
        <div className="alert alert-success">
          <h3>Upload Complete!</h3>
          <p>Redirecting to model page...</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 600, margin: '2rem auto' }}>
      <button className="btn btn-secondary" onClick={() => navigate(-1)} style={{ marginBottom: '1rem' }}>
        Back
      </button>

      <div className="card">
        <h2 style={{ marginBottom: '1.5rem' }}>
          {step === 1 ? 'Model Information' : 'Upload File'}
        </h2>

        {error && <div className="alert alert-error">{error}</div>}

        {step === 1 ? (
          <form onSubmit={handleMetadataSubmit}>
            <div className="form-group">
              <label>Model Name *</label>
              <input
                type="text"
                className="form-control"
                value={metadata.name}
                onChange={(e) => setMetadata({ ...metadata, name: e.target.value })}
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                className="form-control"
                value={metadata.description}
                onChange={(e) => setMetadata({ ...metadata, description: e.target.value })}
                placeholder="Brief description of the model..."
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
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
              Next: Upload File
            </button>
          </form>
        ) : (
          <form onSubmit={handleUpload}>
            <div className="upload-zone" onClick={() => document.getElementById('file-input').click()}>
              <input
                id="file-input"
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
                required
              />
              {file ? (
                <div>
                  <p style={{ fontSize: '1.25rem', fontWeight: 500 }}>{file.name}</p>
                  <p style={{ color: 'var(--text-secondary)' }}>
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <p style={{ marginTop: '0.5rem', color: 'var(--primary)' }}>Click to change file</p>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: '1.25rem', fontWeight: 500 }}>Click to select a file</p>
                  <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Allowed: .gguf, .pt, .pth, .safetensors, .onnx, .tar, .zip, .gz, .bin
                  </p>
                </div>
              )}
            </div>

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
              </div>
            )}

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep(1)}
                disabled={uploading}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!file || uploading}
                style={{ flex: 1 }}
              >
                {uploading ? 'Uploading...' : 'Upload Model'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
