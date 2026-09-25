import axios from 'axios'

const API_BASE = '/api'

const client = axios.create({
  baseURL: API_BASE,
})

// Add auth token to requests
client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 responses
client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default client

// Auth APIs
export const authAPI = {
  register: (data) => client.post('/auth/register', data),
  login: (data) => client.post('/auth/login', data),
  getConfig: () => client.get('/auth/config'),
}

// Model APIs
export const modelAPI = {
  list: (params) => client.get('/models', { params }),
  get: (id) => client.get(`/models/${id}`),
  create: (data) => client.post('/models', data),
  update: (id, data) => client.put(`/models/${id}`, data),
  delete: (id) => client.delete(`/models/${id}`),
  upload: (id, file, config = {}) => {
    const formData = new FormData()
    formData.append('file', file)
    return client.post(`/models/${id}/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 0, // No timeout for large file uploads
      onUploadProgress: config.onUploadProgress, // Pass through caller's progress callback
    })
  },
  generateDownloadToken: (id) => client.post(`/models/${id}/download-token`),
  download: (id, token) => `${API_BASE}/models/${id}/download?token=${token}`,
  search: (q) => client.get('/models/search', { params: { q } }),
}

// User APIs
export const userAPI = {
  getMe: () => client.get('/users/me'),
  getModels: (userId, params) => client.get(`/users/${userId}/models`, { params }),
}
