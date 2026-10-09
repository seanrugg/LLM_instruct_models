'use strict'

const express = require('express')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { pipeline } = require('stream')
const { promisify } = require('util')

const jwt = require('jsonwebtoken')
const bcrypt = require('bcryptjs')
const busboy = require('busboy')
const { Pool } = require('pg')

// ── Configuration ──────────────────────────────────────────────

const APP_NAME = process.env.APP_NAME || 'LLM Instruct Models Repository'
const APP_VERSION = process.env.APP_VERSION || '0.2.0'
const DEBUG = process.env.DEBUG === 'true'

// Database: individual vars with defaults; DATABASE_URL overrides all.
const DB_HOST = process.env.DB_HOST || 'localhost'
const DB_PORT = parseInt(process.env.DB_PORT || '5432', 10)
const DB_NAME = process.env.DB_NAME || 'llm_models'
const DB_USER = process.env.DB_USER || 'llm_user'
const DB_PASSWORD = process.env.DB_PASSWORD || ''

let DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  DATABASE_URL = `postgresql://${DB_USER}:${encodeURIComponent(DB_PASSWORD)}@${DB_HOST}:${DB_PORT}/${DB_NAME}`
}

const JWT_SECRET_KEY = process.env.JWT_SECRET_KEY || ''
const JWT_ALGORITHM = process.env.JWT_ALGORITHM || 'HS256'
const JWT_EXPIRE_MINUTES = parseInt(process.env.JWT_EXPIRE_MINUTES || '60', 10)

// MODEL_STORAGE_PATH: empty string treated as unset → default to ~/llm-storage
const rawStorage = process.env.MODEL_STORAGE_PATH
const MODEL_STORAGE_PATH = (rawStorage && rawStorage.trim()) ? rawStorage : path.join(os.homedir(), 'llm-storage')
const MAX_UPLOAD_SIZE_MB = parseInt(process.env.MAX_UPLOAD_SIZE_MB || '50000', 10)
const MAX_UPLOAD_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024

const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',')
const ALLOW_REGISTRATION = process.env.ALLOW_REGISTRATION === 'true'

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || null
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || null
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || null

const DOWNLOAD_TOKEN_EXPIRE_MINUTES = parseInt(process.env.DOWNLOAD_TOKEN_EXPIRE_MINUTES || '5', 10)

const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR || path.join(MODEL_STORAGE_PATH, '.tmp')

const ALLOWED_EXTENSIONS = ['.gguf', '.pt', '.pth', '.safetensors', '.onnx', '.tar', '.zip', '.gz', '.bin']

// IMPORT_DIR: optional directory to scan for unregistered model files
// If relative, resolved against os.homedir(); if absolute, used as-is.
// Feature is off if unset.
let IMPORT_DIR = process.env.IMPORT_DIR || null
if (IMPORT_DIR) {
  if (path.isAbsolute(IMPORT_DIR)) {
    IMPORT_DIR = IMPORT_DIR
  } else {
    IMPORT_DIR = path.join(os.homedir(), IMPORT_DIR)
  }
}

// ── Validation ─────────────────────────────────────────────────

if (!DEBUG) {
  if (JWT_SECRET_KEY.length < 32) {
    console.error(`FATAL: JWT_SECRET_KEY is too short (${JWT_SECRET_KEY.length} chars). Must be at least 32 characters.`)
    process.exit(1)
  }
}

// ── Database ───────────────────────────────────────────────────

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
})

// SQL to create tables matching the SQLAlchemy models
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version VARCHAR(50),
    tags JSONB,
    framework VARCHAR(50),
    size_bytes BIGINT,
    filename VARCHAR(512) NOT NULL DEFAULT '',
    original_filename VARCHAR(512),
    content_type VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  -- File-derived immutable metadata (extracted from stored file)
  ALTER TABLE models
    ADD COLUMN IF NOT EXISTS file_format VARCHAR(20),
    ADD COLUMN IF NOT EXISTS sha256 CHAR(64),
    ADD COLUMN IF NOT EXISTS architecture VARCHAR(64),
    ADD COLUMN IF NOT EXISTS parameter_count BIGINT,
    ADD COLUMN IF NOT EXISTS quantization VARCHAR(32),
    ADD COLUMN IF NOT EXISTS context_length INTEGER,
    ADD COLUMN IF NOT EXISTS chat_template TEXT,
    ADD COLUMN IF NOT EXISTS license VARCHAR(128),
    ADD COLUMN IF NOT EXISTS source_model_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS file_metadata JSONB,
    ADD COLUMN IF NOT EXISTS metadata_extracted_at TIMESTAMPTZ;

  -- Trigger: lock file-derived metadata once extracted
  CREATE OR REPLACE FUNCTION models_lock_file_metadata() RETURNS trigger AS $$
  BEGIN
    IF OLD.metadata_extracted_at IS NOT NULL AND (
       NEW.file_format IS DISTINCT FROM OLD.file_format OR NEW.sha256 IS DISTINCT FROM OLD.sha256 OR
       NEW.architecture IS DISTINCT FROM OLD.architecture OR NEW.parameter_count IS DISTINCT FROM OLD.parameter_count OR
       NEW.quantization IS DISTINCT FROM OLD.quantization OR NEW.context_length IS DISTINCT FROM OLD.context_length OR
       NEW.chat_template IS DISTINCT FROM OLD.chat_template OR NEW.license IS DISTINCT FROM OLD.license OR
       NEW.source_model_name IS DISTINCT FROM OLD.source_model_name OR NEW.file_metadata IS DISTINCT FROM OLD.file_metadata OR
       NEW.metadata_extracted_at IS DISTINCT FROM OLD.metadata_extracted_at OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes OR
       NEW.filename IS DISTINCT FROM OLD.filename OR NEW.framework IS DISTINCT FROM OLD.framework) THEN
      RAISE EXCEPTION 'file-derived metadata is immutable';
    END IF;
    RETURN NEW;
  END $$ LANGUAGE plpgsql;
  DROP TRIGGER IF EXISTS trg_models_lock_file_metadata ON models;
  CREATE TRIGGER trg_models_lock_file_metadata BEFORE UPDATE ON models
    FOR EACH ROW EXECUTE FUNCTION models_lock_file_metadata();

  -- Add status/error columns (won't fail if they already exist)
  ALTER TABLE models ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed'));
  ALTER TABLE models ADD COLUMN IF NOT EXISTS error TEXT;
`

async function ensureTables () {
  try {
    await pool.query(CREATE_TABLES_SQL)
    console.log('Tables verified successfully')
  } catch (err) {
    console.error(`FATAL: Failed to create tables. DB user: ${DB_USER}. Check permissions on the database.`)
    console.error(err.message)
    process.exit(1)
  }
}

async function bootstrapAdmin () {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.log('WARNING: ADMIN_USERNAME/ADMIN_PASSWORD not set. No admin will be created.')
    return
  }

  const result = await pool.query('SELECT COUNT(*) as count FROM users')
  if (parseInt(result.rows[0].count, 10) > 0) {
    console.log('Users table not empty, skipping admin bootstrap')
    return
  }

  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10)
  await pool.query(
    'INSERT INTO users (username, email, password_hash, is_admin) VALUES ($1, $2, $3, TRUE)',
    [ADMIN_USERNAME, ADMIN_EMAIL, passwordHash]
  )
  console.log(`Admin user '${ADMIN_USERNAME}' created successfully`)
}

// ── Storage ────────────────────────────────────────────────────

function ensureStorageDir () {
  fs.mkdirSync(MODEL_STORAGE_PATH, { recursive: true })
  fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true })
  console.log(`Model storage path: ${MODEL_STORAGE_PATH}`)
  console.log(`Upload temp directory: ${UPLOAD_TMP_DIR}`)
}

function sanitizeFilename (filename) {
  // Strip path components and quotes
  let name = path.basename(filename).replace(/['"]/g, '')
  if (!name) name = 'unknown'
  return name
}

function getFileExtension (filename) {
  const idx = filename.lastIndexOf('.')
  if (idx === -1) return ''
  return filename.slice(idx).toLowerCase()
}

function getFilePath (userId, modelId, filename) {
  return path.join(MODEL_STORAGE_PATH, userId, modelId, filename)
}

function deleteFile (userId, modelId, filename) {
  const filePath = getFilePath(userId, modelId, filename)
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      return true
    }
  } catch (_) { /* ignore */ }
  return false
}

async function openTemp (userId, modelId, originalFilename) {
  const storedFilename = `${crypto.randomUUID()}_${originalFilename}`
  const tempPath = path.join(UPLOAD_TMP_DIR, storedFilename)
  return { tempPath, storedFilename }
}

function commitTemp (tempPath, userId, modelId, storedFilename) {
  const modelDir = path.join(MODEL_STORAGE_PATH, userId, modelId)
  fs.mkdirSync(modelDir, { recursive: true })
  const finalPath = path.join(modelDir, storedFilename)
  fs.renameSync(tempPath, finalPath)
  return storedFilename
}

function deleteModelDir (userId, modelId) {
  const modelDir = path.join(MODEL_STORAGE_PATH, userId, modelId)
  if (!fs.existsSync(modelDir)) return
  const files = fs.readdirSync(modelDir)
  for (const file of files) {
    const filePath = path.join(modelDir, file)
    if (fs.statSync(filePath).isFile()) {
      fs.unlinkSync(filePath)
    }
  }
  fs.rmdirSync(modelDir)

  // Try to remove empty user dir
  const userDir = path.join(MODEL_STORAGE_PATH, userId)
  try {
    const remaining = fs.readdirSync(userDir)
    if (remaining.length === 0) fs.rmdirSync(userDir)
  } catch (_) { /* ignore */ }
}

// ── JWT Helpers ────────────────────────────────────────────────

function createAccessToken (userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET_KEY, {
    algorithm: JWT_ALGORITHM,
    expiresIn: `${JWT_EXPIRE_MINUTES}m`,
  })
}

function decodeAccessToken (token) {
  try {
    return jwt.verify(token, JWT_SECRET_KEY, { algorithms: [JWT_ALGORITHM] })
  } catch (_) {
    return null
  }
}

function createDownloadToken (userId, modelId) {
  return jwt.sign(
    {
      sub: userId,
      mid: String(modelId),
      typ: 'download',
    },
    JWT_SECRET_KEY,
    {
      algorithm: JWT_ALGORITHM,
      expiresIn: `${DOWNLOAD_TOKEN_EXPIRE_MINUTES}m`,
    }
  )
}

function decodeDownloadToken (token) {
  try {
    const payload = jwt.verify(token, JWT_SECRET_KEY, { algorithms: [JWT_ALGORITHM] })
    if (payload.typ !== 'download' || !payload.mid) return null
    return payload
  } catch (_) {
    return null
  }
}

// ── Auth Throttle ──────────────────────────────────────────────

const loginAttempts = new Map()
const THROTTLE_MAX = 5
const THROTTLE_WINDOW = 15 * 60 * 1000 // 15 minutes

function checkThrottle (username) {
  const now = Date.now()
  let attempts = loginAttempts.get(username) || []
  attempts = attempts.filter(t => now - t < THROTTLE_WINDOW)
  loginAttempts.set(username, attempts)

  if (attempts.length >= THROTTLE_MAX) {
    return false
  }
  return true
}

function recordAttempt (username) {
  let attempts = loginAttempts.get(username) || []
  attempts.push(Date.now())
  loginAttempts.set(username, attempts)
}

// ── Express App ────────────────────────────────────────────────

const app = express()
app.set('trust proxy', true)

// CORS
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (CORS_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin)
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

// JSON body parser
app.use(express.json())

// ── Auth Middleware ─────────────────────────────────────────────

function requireAuth (req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Missing or invalid authorization header' })
  }
  const token = authHeader.slice(7)
  const payload = decodeAccessToken(token)
  if (!payload || !payload.sub) {
    return res.status(401).json({ detail: 'Invalid or expired token' })
  }
  req.user = payload
  next()
}

// ── Health ─────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' })
})

// ── Auth Routes ────────────────────────────────────────────────

app.get('/api/auth/config', (req, res) => {
  res.json({ allow_registration: ALLOW_REGISTRATION })
})

app.post('/api/auth/register', async (req, res) => {
  if (!ALLOW_REGISTRATION) {
    return res.status(403).json({ detail: 'Registration is disabled' })
  }

  const { username, email, password } = req.body
  if (!username || !password) {
    return res.status(400).json({ detail: 'Username and password are required' })
  }

  // Check username
  const nameCheck = await pool.query('SELECT id FROM users WHERE username = $1', [username])
  if (nameCheck.rows.length > 0) {
    return res.status(400).json({ detail: 'Username already registered' })
  }

  // Check email
  if (email) {
    const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ detail: 'Email already registered' })
    }
  }

  // Create user
  const passwordHash = bcrypt.hashSync(password, 10)
  const result = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, is_admin, created_at',
    [username, email || null, passwordHash]
  )
  res.status(201).json(result.rows[0])
})

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body

  if (!checkThrottle(username)) {
    return res.status(429).json({ detail: 'Too many failed login attempts. Please try again later.' })
  }

  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username])
  const user = result.rows[0]

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordAttempt(username)
    return res.status(401).json({ detail: 'Incorrect username or password' })
  }

  const token = createAccessToken(user.id)
  res.json({
    access_token: token,
    token_type: 'bearer',
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      created_at: user.created_at,
    },
  })
})

// ── User Routes ────────────────────────────────────────────────

app.get('/api/users/me', requireAuth, async (req, res) => {
  const user = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.sub])
  if (user.rows.length === 0) {
    return res.status(401).json({ detail: 'User no longer exists' })
  }
  res.json({
    id: user.rows[0].id,
    username: user.rows[0].username,
    email: user.rows[0].email,
    is_admin: user.rows[0].is_admin,
    created_at: user.rows[0].created_at,
  })
})

app.get('/api/users/:user_id/models', requireAuth, async (req, res) => {
  const { user_id } = req.params
  const page = parseInt(req.query.page || '1', 10)
  const page_size = Math.min(parseInt(req.query.page_size || '20', 10), 100)

  // Check authorization
  if (user_id !== req.user.sub) {
    const currentUser = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.sub])
    if (currentUser.rows.length === 0 || !currentUser.rows[0].is_admin) {
      return res.status(403).json({ detail: 'Not authorized to view this user\'s models' })
    }
  }

  // Check user exists
  const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id])
  if (userCheck.rows.length === 0) {
    return res.status(404).json({ detail: 'User not found' })
  }

  // Count
  const countResult = await pool.query(
    'SELECT COUNT(*) as total FROM models WHERE owner_id = $1',
    [user_id]
  )
  const total = parseInt(countResult.rows[0].total, 10)

  // Fetch
  const result = await pool.query(
    'SELECT * FROM models WHERE owner_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [user_id, page_size, (page - 1) * page_size]
  )

  res.json({
    items: result.rows.map(rowToModelResponse),
    total,
    page,
    page_size,
  })
})

app.post('/api/users', requireAuth, async (req, res) => {
  // Admin only
  const currentUser = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.sub])
  if (currentUser.rows.length === 0 || !currentUser.rows[0].is_admin) {
    return res.status(403).json({ detail: 'Admin access required' })
  }

  const { username, email, password, is_admin } = req.body

  // Check username
  const nameCheck = await pool.query('SELECT id FROM users WHERE username = $1', [username])
  if (nameCheck.rows.length > 0) {
    return res.status(400).json({ detail: 'Username already registered' })
  }

  // Check email
  if (email) {
    const emailCheck = await pool.query('SELECT id FROM users WHERE email = $1', [email])
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ detail: 'Email already registered' })
    }
  }

  const passwordHash = bcrypt.hashSync(password, 10)
  const result = await pool.query(
    'INSERT INTO users (username, email, password_hash, is_admin) VALUES ($1, $2, $3, $4) RETURNING id, username, email, is_admin, created_at',
    [username, email || null, passwordHash, is_admin || false]
  )
  res.status(201).json(result.rows[0])
})

app.delete('/api/users/:user_id', requireAuth, async (req, res) => {
  const { user_id } = req.params

  // Check authorization (self or admin)
  const currentUser = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.sub])
  if (currentUser.rows.length === 0) {
    return res.status(401).json({ detail: 'Invalid token' })
  }
  if (user_id !== req.user.sub && !currentUser.rows[0].is_admin) {
    return res.status(403).json({ detail: 'Can only delete your own account or use admin account' })
  }

  // Check user exists
  const userCheck = await pool.query('SELECT id FROM users WHERE id = $1', [user_id])
  if (userCheck.rows.length === 0) {
    return res.status(404).json({ detail: 'User not found' })
  }

  // Delete owned models (files + DB)
  const modelsResult = await pool.query('SELECT id, filename FROM models WHERE owner_id = $1', [user_id])
  for (const model of modelsResult.rows) {
    if (model.filename) {
      deleteFile(user_id, model.id, model.filename)
    }
  }
  await pool.query('DELETE FROM models WHERE owner_id = $1', [user_id])

  await pool.query('DELETE FROM users WHERE id = $1', [user_id])
  res.sendStatus(204)
})

// ── Model Routes ───────────────────────────────────────────────

// Dynamic import for the model header parser (pure ESM module)
let parseModelHeader = null
async function loadParser () {
  if (!parseModelHeader) {
    const parser = await import('../frontend/src/lib/modelHeader.mjs')
    parseModelHeader = parser.parseModelHeader
  }
  return parseModelHeader
}

async function extractMetadataFromFile (filePath, filename) {
  try {
    const stat = fs.statSync(filePath)
    const fileSize = stat.size

    const readBytes = async (offset, length) => {
      const fd = await fs.promises.open(filePath, 'r')
      try {
        const buffer = Buffer.alloc(length)
        const { bytesRead } = await fd.read(buffer, 0, length, offset)
        await fd.close()
        return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
      } catch (err) {
        await fd.close().catch(() => {})
        throw err
      }
    }

    const parser = await loadParser()
    return await parseModelHeader(readBytes, fileSize, filename)
  } catch (err) {
    console.error('Metadata extraction error:', err.message)
    return {
      file_format: guessFileFormat(filename),
      architecture: null,
      parameter_count: null,
      quantization: null,
      context_length: null,
      chat_template: null,
      license: null,
      source_model_name: null,
      file_metadata: {},
      warnings: [`Extraction failed: ${err.message}`],
    }
  }
}

function guessFileFormat (filename) {
  const ext = getFileExtension(filename)
  const formatMap = {
    '.gguf': 'gguf',
    '.safetensors': 'safetensors',
    '.onnx': 'onnx',
    '.pt': 'pytorch',
    '.pth': 'pytorch',
    '.tar': 'archive',
    '.zip': 'archive',
    '.gz': 'archive',
    '.bin': 'bin',
  }
  return formatMap[ext] || 'unknown'
}

function rowToModelResponse (row) {
  return {
    id: row.id,
    owner_id: row.owner_id,
    name: row.name,
    description: row.description,
    version: row.version,
    tags: row.tags,
    framework: row.framework,
    size_bytes: row.size_bytes !== null && row.size_bytes !== undefined ? parseInt(row.size_bytes, 10) : null,
    filename: row.filename,
    original_filename: row.original_filename,
    content_type: row.content_type,
    // File-derived immutable metadata
    file_format: row.file_format,
    sha256: row.sha256,
    architecture: row.architecture,
    parameter_count: row.parameter_count !== null && row.parameter_count !== undefined ? parseInt(row.parameter_count, 10) : null,
    quantization: row.quantization,
    context_length: row.context_length,
    chat_template: row.chat_template,
    license: row.license,
    source_model_name: row.source_model_name,
    file_metadata: row.file_metadata,
    metadata_extracted_at: row.metadata_extracted_at,
    // Processing status
    status: row.status || 'ready',
    error: row.error || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

app.get('/api/models', requireAuth, async (req, res) => {
  const page = parseInt(req.query.page || '1', 10)
  const page_size = Math.min(parseInt(req.query.page_size || '20', 10), 100)
  const { search, framework } = req.query

  let whereClause = ''
  const params = []
  let paramIdx = 1

  if (search) {
    whereClause = `WHERE name ILIKE $${paramIdx} OR description ILIKE $${paramIdx}`
    params.push(`%${search}%`)
    paramIdx++
  }

  if (framework) {
    whereClause += (whereClause ? ' AND' : 'WHERE') + ` framework = $${paramIdx}`
    params.push(framework)
    paramIdx++
  }

  const countResult = await pool.query(
    `SELECT COUNT(*) as total FROM models ${whereClause}`,
    params
  )
  const total = parseInt(countResult.rows[0].total, 10)

  const result = await pool.query(
    `SELECT * FROM models ${whereClause} ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
    [...params, page_size, (page - 1) * page_size]
  )

  res.json({
    items: result.rows.map(rowToModelResponse),
    total,
    page,
    page_size,
  })
})

app.get('/api/models/search', requireAuth, async (req, res) => {
  const q = req.query.q
  if (!q) {
    return res.status(400).json({ detail: 'Search query "q" is required' })
  }

  const result = await pool.query(
    `SELECT * FROM models WHERE name ILIKE $1 OR description ILIKE $1 ORDER BY created_at DESC`,
    [`%${q}%`]
  )

  res.json({
    items: result.rows.map(rowToModelResponse),
    total: result.rows.length,
  })
})

app.get('/api/models/:model_id', requireAuth, async (req, res) => {
  const { model_id } = req.params
  const result = await pool.query('SELECT * FROM models WHERE id = $1', [model_id])

  if (result.rows.length === 0) {
    return res.status(404).json({ detail: 'Model not found' })
  }

  res.json(rowToModelResponse(result.rows[0]))
})

app.post('/api/models', requireAuth, async (req, res) => {
  const { name, description, version, tags, framework, ...extra } = req.body

  // Reject any locked/derived fields
  const lockedFields = ['sha256', 'file_format', 'architecture', 'parameter_count',
    'quantization', 'context_length', 'chat_template', 'license',
    'source_model_name', 'file_metadata', 'metadata_extracted_at']
  for (const field of lockedFields) {
    if (extra[field] !== undefined) {
      return res.status(400).json({ detail: `Field ${field} is derived from the file and cannot be set` })
    }
  }
  // Also reject framework (now derived from file)
  if (framework !== undefined) {
    return res.status(400).json({ detail: 'Field framework is derived from the file and cannot be set' })
  }

  const result = await pool.query(
    `INSERT INTO models (owner_id, name, description, version, tags, filename)
     VALUES ($1, $2, $3, $4, $5, '')
     RETURNING *`,
    [req.user.sub, name, description || null, version || null, tags || null]
  )

  res.status(201).json(rowToModelResponse(result.rows[0]))
})

app.put('/api/models/:model_id', requireAuth, async (req, res) => {
  const { model_id } = req.params
  const { name, description, version, tags, framework, ...extra } = req.body

  const result = await pool.query('SELECT * FROM models WHERE id = $1', [model_id])
  if (result.rows.length === 0) {
    return res.status(404).json({ detail: 'Model not found' })
  }

  const model = result.rows[0]
  if (model.owner_id !== req.user.sub) {
    return res.status(403).json({ detail: 'Not authorized to update this model' })
  }

  // Reject any locked/derived fields
  const lockedFields = ['sha256', 'file_format', 'architecture', 'parameter_count',
    'quantization', 'context_length', 'chat_template', 'license',
    'source_model_name', 'file_metadata', 'metadata_extracted_at']
  for (const field of lockedFields) {
    if (extra[field] !== undefined) {
      return res.status(400).json({ detail: `Field ${field} is derived from the file and cannot be set` })
    }
  }
  // Also reject framework (now derived from file)
  if (framework !== undefined) {
    return res.status(400).json({ detail: 'Field framework is derived from the file and cannot be set' })
  }

  const fields = []
  const values = []
  let idx = 1

  if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name) }
  if (description !== undefined) { fields.push(`description = $${idx++}`); values.push(description) }
  if (version !== undefined) { fields.push(`version = $${idx++}`); values.push(version) }
  if (tags !== undefined) { fields.push(`tags = $${idx++}`); values.push(tags) }

  fields.push(`updated_at = NOW()`)
  values.push(model_id)

  await pool.query(
    `UPDATE models SET ${fields.join(', ')} WHERE id = $${idx}`,
    values
  )

  const updated = await pool.query('SELECT * FROM models WHERE id = $1', [model_id])
  res.json(rowToModelResponse(updated.rows[0]))
})

app.delete('/api/models/:model_id', requireAuth, async (req, res) => {
  const { model_id } = req.params

  const result = await pool.query('SELECT * FROM models WHERE id = $1', [model_id])
  if (result.rows.length === 0) {
    return res.status(404).json({ detail: 'Model not found' })
  }

  const model = result.rows[0]
  if (model.owner_id !== req.user.sub) {
    return res.status(403).json({ detail: 'Not authorized to delete this model' })
  }

  if (model.filename) {
    deleteFile(model.owner_id, model_id, model.filename)
  }

  await pool.query('DELETE FROM models WHERE id = $1', [model_id])
  res.sendStatus(204)
})

// ── Upload Route (multipart via Busboy) ────────────────────────

// Estimate for processing time: header-only extraction is fast, ~200 MB/s conservative
const PROCESS_RATE_MB_PER_SEC = 200
function estimateProcessingTimeMb (sizeMb) {
  if (sizeMb <= 200) return 'under a minute'
  const seconds = Math.ceil(sizeMb / PROCESS_RATE_MB_PER_SEC)
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
}

app.post('/api/models/:model_id/upload', requireAuth, async (req, res) => {
  let tempPath = ''
  let createdModelId = null

  try {
    const { model_id } = req.params

    // Check model exists and belongs to user
    const modelResult = await pool.query(
      'SELECT * FROM models WHERE id = $1 AND owner_id = $2',
      [model_id, req.user.sub]
    )
    if (modelResult.rows.length === 0) {
      return res.status(404).json({ detail: 'Model not found' })
    }

    const model = modelResult.rows[0]

    // Check if file already uploaded (409)
    if (model.filename) {
      return res.status(409).json({ detail: 'File already uploaded; create a new model/version instead' })
    }

    // Ensure temp directory exists
    fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true })

    // Parse multipart via Busboy — stream directly to temp file
    const bb = busboy({ headers: req.headers })
    let byteCount = 0
    let originalFilename = 'unknown'
    let contentType = 'application/octet-stream'
    let storedFilename = ''
    let writeStream = null
    let errorSent = false
    let uploadDone = false
    let hash = crypto.createHash('sha256')

    const sendError = (status, detail) => {
      if (errorSent || uploadDone) return
      errorSent = true
      // Clean up temp file
      if (tempPath) {
        try { fs.unlinkSync(tempPath) } catch (_) { /* ignore */ }
      }
      res.status(status).json({ detail })
    }

    bb.on('file', async (fieldname, fileStream, info) => {
      try {
        if (fieldname !== 'file') {
          fileStream.resume() // drain
          return
        }

        originalFilename = sanitizeFilename(info.filename)
        contentType = info.contentType || 'application/octet-stream'

        const fileExt = getFileExtension(originalFilename)
        if (fileExt && !ALLOWED_EXTENSIONS.includes(fileExt)) {
          sendError(400, `File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`)
          fileStream.resume()
          return
        }

        // Create temp file and stream writer
        const temp = await openTemp(req.user.sub, model_id, originalFilename)
        tempPath = temp.tempPath
        storedFilename = temp.storedFilename
        writeStream = fs.createWriteStream(tempPath)

        fileStream.pipe(writeStream)

        fileStream.on('data', (chunk) => {
          byteCount += chunk.length
          hash.update(chunk)

          if (byteCount > MAX_UPLOAD_BYTES) {
            fileStream.destroy()
            writeStream.destroy()
            sendError(413, 'File too large. Maximum size: ' + MAX_UPLOAD_SIZE_MB + 'MB')
          }
        })

        fileStream.on('error', (err) => {
          if (writeStream) writeStream.destroy()
          sendError(500, 'Upload failed: ' + (err.message || 'Unknown error'))
        })

        writeStream.on('error', (err) => {
          sendError(500, 'Upload failed: ' + (err.message || 'Unknown error'))
        })
      } catch (err) {
        console.error('Busboy file handler error:', err)
        sendError(500, 'Upload failed: ' + (err.message || 'Unknown error'))
      }
    })

    bb.on('finish', async () => {
      if (uploadDone || errorSent) return

      if (byteCount === 0) {
        sendError(400, 'Empty file')
        return
      }

      try {
        // Wait for write stream to finish
        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve)
          writeStream.on('error', reject)
          writeStream.end()
        })

        // Compute SHA-256
        const sha256 = hash.digest('hex')

        // Commit temp file to final location
        const finalFilename = commitTemp(tempPath, req.user.sub, model_id, storedFilename)

        // Delete old file if model already had one
        if (model.filename) {
          deleteFile(req.user.sub, model_id, model.filename)
        }

        // Update status to 'processing' immediately
        await pool.query(
          'UPDATE models SET status = $1, error = NULL, updated_at = NOW() WHERE id = $2',
          ['processing', model_id]
        )

        // Respond 202 immediately
        res.status(202).json({
          id: model_id,
          status: 'processing',
          message: 'Upload received. Processing in background...',
          estimate: estimateProcessingTimeMb(byteCount / (1024 * 1024)),
        })
        uploadDone = true

        // Process in background (fire and forget)
        processUploadInBackground(model_id, req.user.sub, finalFilename, originalFilename, contentType, byteCount, sha256)
      } catch (err) {
        console.error('Upload processing error:', err)
        sendError(500, 'Upload failed: ' + (err.message || 'Unknown error'))
      }
    })

    bb.on('error', (err) => {
      console.error('Busboy error:', err)
      sendError(500, 'Upload failed: ' + (err.message || 'Unknown error'))
    })

    req.pipe(bb)
  } catch (err) {
    console.error('Upload route error:', err)
    // Clean up temp file if it exists
    if (tempPath) {
      try { fs.unlinkSync(tempPath) } catch (_) { /* ignore */ }
    }
    // Delete orphan model if it was created
    if (createdModelId) {
      try {
        await pool.query('DELETE FROM models WHERE id = $1', [createdModelId])
        // Also delete the model directory
        const modelDir = path.join(MODEL_STORAGE_PATH, req.user.sub, createdModelId)
        try { fs.rmSync(modelDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
      } catch (_) { /* ignore */ }
    }
    res.status(500).json({ detail: 'Upload failed: ' + (err.message || 'Unknown error') })
  }
})

// Background processing for upload finalization
async function processUploadInBackground (model_id, userId, finalFilename, originalFilename, contentType, sizeBytes, sha256) {
  const t0 = Date.now()
  try {
    console.log(`[Background] Starting processing for model ${model_id} (${originalFilename})`)

    // Extract metadata from file
    const t1 = Date.now()
    const filePath = getFilePath(userId, model_id, finalFilename)
    const extracted = await extractMetadataFromFile(filePath, originalFilename)
    console.log(`[Background] Metadata extraction: ${(Date.now() - t1)}ms`)

    // Single UPDATE for all fields
    const t2 = Date.now()
    await pool.query(
      `UPDATE models SET
        filename = $1, original_filename = $2, content_type = $3, size_bytes = $4,
        sha256 = $5, file_format = $6, architecture = $7, parameter_count = $8,
        quantization = $9, context_length = $10, chat_template = $11, license = $12,
        source_model_name = $13, file_metadata = $14, framework = $15,
        metadata_extracted_at = NOW(), status = 'ready', error = NULL, updated_at = NOW()
       WHERE id = $16`,
      [
        finalFilename, originalFilename, contentType, sizeBytes,
        sha256, extracted.file_format, extracted.architecture, extracted.parameter_count,
        extracted.quantization, extracted.context_length, extracted.chat_template, extracted.license,
        extracted.source_model_name, extracted.file_metadata || '{}', extracted.file_format,
        model_id,
      ]
    )
    console.log(`[Background] DB update: ${(Date.now() - t2)}ms`)
    console.log(`[Background] Total processing time: ${(Date.now() - t0)}ms`)
    console.log(`[Background] Upload processed successfully: ${model_id} (${originalFilename})`)
  } catch (err) {
    console.error(`[Background] Upload processing failed for model ${model_id} after ${(Date.now() - t0)}ms:`, err.message)
    // Mark as failed
    try {
      await pool.query(
        'UPDATE models SET status = $1, error = $2, updated_at = NOW() WHERE id = $3',
        ['failed', err.message || 'Unknown error', model_id]
      )
    } catch (updateErr) {
      console.error('[Background] Failed to update model status:', updateErr.message)
    }
  }
}

// ── Download Token Route ───────────────────────────────────────

app.post('/api/models/:model_id/download-token', requireAuth, async (req, res) => {
  const { model_id } = req.params

  const result = await pool.query('SELECT * FROM models WHERE id = $1', [model_id])
  if (result.rows.length === 0) {
    return res.status(404).json({ detail: 'Model not found' })
  }

  const model = result.rows[0]
  if (!model.filename) {
    return res.status(404).json({ detail: 'No file uploaded for this model' })
  }

  const token = createDownloadToken(req.user.sub, model_id)

  res.json({
    download_token: token,
    expires_in_minutes: DOWNLOAD_TOKEN_EXPIRE_MINUTES,
  })
})

// ── Download Route ─────────────────────────────────────────────

app.get('/api/models/:model_id/download', async (req, res) => {
  const { model_id } = req.params
  const { token } = req.query

  if (!token) {
    return res.status(401).json({ detail: 'Download token required' })
  }

  const payload = decodeDownloadToken(token)
  if (!payload) {
    return res.status(401).json({ detail: 'Invalid or expired download token' })
  }

  if (payload.mid !== model_id) {
    return res.status(403).json({ detail: 'Download token does not match this model' })
  }

  const result = await pool.query('SELECT * FROM models WHERE id = $1', [model_id])
  if (result.rows.length === 0) {
    return res.status(404).json({ detail: 'Model not found' })
  }

  const model = result.rows[0]
  if (!model.filename) {
    return res.status(404).json({ detail: 'No file uploaded for this model' })
  }

  // Check if model is ready (not still processing or failed)
  if (model.status !== 'ready') {
    const message = model.status === 'processing'
      ? 'Model is still being processed. Please wait a moment and try again.'
      : `Model upload failed: ${model.error || 'Unknown error'}`
    return res.status(409).json({ detail: message })
  }

  const filePath = getFilePath(model.owner_id, model_id, model.filename)
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ detail: 'File not found in storage' })
  }

  const stat = fs.statSync(filePath)
  const fileName = model.original_filename || model.filename
  const mediaType = model.content_type || 'application/octet-stream'

  // Range support
  const range = req.headers.range
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-')
    const start = parseInt(parts[0], 10)
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1
    const chunkSize = end - start + 1

    const file = fs.createReadStream(filePath, { start, end })
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mediaType,
      'Content-Disposition': `attachment; filename="${fileName}"`,
    })
    file.pipe(res)
    return
  }

  res.writeHead(200, {
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Content-Type': mediaType,
    'Content-Disposition': `attachment; filename="${fileName}"`,
  })
  fs.createReadStream(filePath).pipe(res)
})

// ── Admin Import Route ─────────────────────────────────────────

app.post('/api/admin/import', requireAuth, async (req, res) => {
  try {
    // Admin only
    const currentUser = await pool.query('SELECT is_admin FROM users WHERE id = $1', [req.user.sub])
    if (currentUser.rows.length === 0 || !currentUser.rows[0].is_admin) {
      return res.status(403).json({ detail: 'Admin access required' })
    }

    if (!IMPORT_DIR) {
      return res.status(501).json({ detail: 'IMPORT_DIR not configured' })
    }

    // Check if IMPORT_DIR exists
    let importDirStat
    try {
      importDirStat = fs.statSync(IMPORT_DIR)
    } catch (err) {
      return res.status(404).json({ detail: `IMPORT_DIR not found: ${IMPORT_DIR}` })
    }

    if (!importDirStat.isDirectory()) {
      return res.status(400).json({ detail: `IMPORT_DIR is not a directory: ${IMPORT_DIR}` })
    }

    // Scan directory
    let files
    try {
      files = fs.readdirSync(IMPORT_DIR)
    } catch (err) {
      return res.status(500).json({ detail: `Failed to read IMPORT_DIR: ${err.message}` })
    }

    const imported = []
    const skipped = []
    const failed = []

    // Get current time for 60-second recent modification check
    const now = Date.now()
    const recentCutoff = now - 60 * 1000

    for (const filename of files) {
      // Skip names starting with .
      if (filename.startsWith('.')) {
        skipped.push({ filename, reason: 'Hidden file' })
        continue
      }

      const filePath = path.join(IMPORT_DIR, filename)
      let fileStat
      try {
        fileStat = fs.lstatSync(filePath)
      } catch (err) {
        failed.push({ filename, reason: `Cannot stat: ${err.message}` })
        continue
      }

      // Only top-level regular files, no symlinks
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
        skipped.push({ filename, reason: 'Not a regular file' })
        continue
      }

      // Check extension
      const ext = getFileExtension(filename)
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        skipped.push({ filename, reason: `Unsupported extension: ${ext}` })
        continue
      }

      // Check recent modification (skip files modified in last 60 seconds)
      if (fileStat.mtimeMs > recentCutoff) {
        skipped.push({ filename, reason: 'Modified in last 60 seconds' })
        continue
      }

      // Check if file already registered (by original_filename and size_bytes)
      const existing = await pool.query(
        'SELECT id, original_filename, size_bytes FROM models WHERE original_filename = $1 AND size_bytes = $2',
        [filename, fileStat.size]
      )
      if (existing.rows.length > 0) {
        skipped.push({ filename, reason: 'Already registered' })
        continue
      }

      // Create model row
      let modelResult
      try {
        modelResult = await pool.query(
          `INSERT INTO models (owner_id, name, original_filename, size_bytes, framework, filename)
           VALUES ($1, $2, $3, $4, $5, '')
           RETURNING id`,
          [req.user.sub, path.basename(filename, ext), filename, fileStat.size, ext.replace('.', '')]
        )
      } catch (err) {
        failed.push({ filename, reason: `DB insert failed: ${err.message}` })
        continue
      }

      const modelId = modelResult.rows[0].id

      // Move file to storage (same layout as upload: MODEL_STORAGE_PATH/userId/modelId/filename)
      const userId = req.user.sub
      const modelDir = path.join(MODEL_STORAGE_PATH, userId, modelId)
      fs.mkdirSync(modelDir, { recursive: true })
      const finalPath = path.join(modelDir, filename)

      try {
        // Try rename first (fast, same filesystem)
        fs.renameSync(filePath, finalPath)
      } catch (err) {
        // Fallback: copy-then-delete (different filesystem)
        try {
          fs.copyFileSync(filePath, finalPath)
          // Verify size
          const destStat = fs.statSync(finalPath)
          if (destStat.size !== fileStat.size) {
            fs.unlinkSync(finalPath)
            failed.push({ filename, reason: 'Copy size mismatch' })
            await pool.query('DELETE FROM models WHERE id = $1', [modelId])
            continue
          }
          fs.unlinkSync(filePath)
        } catch (copyErr) {
          failed.push({ filename, reason: `Move failed: ${copyErr.message}` })
          await pool.query('DELETE FROM models WHERE id = $1', [modelId])
          continue
        }
      }

      // Update filename so downloads work
      await pool.query('UPDATE models SET filename = $1 WHERE id = $2', [filename, modelId])

      imported.push({ filename, modelId })
    }

    res.json({
      message: 'Import complete',
      import_dir: IMPORT_DIR,
      imported,
      skipped,
      failed,
    })
  } catch (err) {
    console.error('Import error:', err)
    res.status(500).json({ detail: `Import failed: ${err.message}` })
  }
})

// ── SPA Fallback ───────────────────────────────────────────────

const publicDir = path.join(__dirname, 'public')
app.use('/api', express.static(path.join(publicDir, 'api') || null)) // no static for /api

app.get('*', (req, res) => {
  const indexPath = path.join(publicDir, 'index.html')
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath)
  } else {
    res.status(404).json({ detail: 'Frontend not built. Run: npm run build' })
  }
})

// ── Startup Cleanup ────────────────────────────────────────────

async function cleanupStuckProcessingModels () {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000) // 30 minutes ago
    const result = await pool.query(
      `UPDATE models SET status = $1, error = $2, updated_at = NOW()
       WHERE status = 'processing' AND updated_at < $3
       RETURNING id, name`,
      ['failed', 'Interrupted by server restart; please re-upload.', cutoff]
    )
    if (result.rows.length > 0) {
      console.log(`Cleaned up ${result.rows.length} stuck processing model(s)`)
      for (const row of result.rows) {
        console.log(`  - ${row.name} (id: ${row.id})`)
      }
    }
  } catch (err) {
    console.error('WARNING: Failed to cleanup stuck processing models:', err.message)
  }
}

async function cleanupLeftoverTempFiles () {
  try {
    if (!fs.existsSync(UPLOAD_TMP_DIR)) return

    const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24 hours ago
    const files = fs.readdirSync(UPLOAD_TMP_DIR)

    let cleaned = 0
    for (const file of files) {
      const filePath = path.join(UPLOAD_TMP_DIR, file)
      try {
        const stat = fs.statSync(filePath)
        if (stat.isFile() && stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath)
          cleaned++
          console.log(`  - Deleted leftover temp file: ${file}`)
        }
      } catch (err) {
        console.warn(`  - Failed to stat temp file ${file}:`, err.message)
      }
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} leftover temp file(s) older than 24 hours`)
    }
  } catch (err) {
    console.error('WARNING: Failed to cleanup leftover temp files:', err.message)
  }
}

async function cleanupOrphanedModels () {
  try {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000 // 24 hours ago

    // Find models with no file, older than 24 hours (regardless of status)
    const result = await pool.query(
      `SELECT id, name, owner_id, filename
       FROM models
       WHERE (filename IS NULL OR filename = '')
       AND created_at < $1`,
      [new Date(cutoff)]
    )

    let cleaned = 0
    for (const model of result.rows) {
      // Delete file if it exists
      if (model.filename) {
        deleteFile(model.owner_id, model.id, model.filename)
      }

      // Delete model record
      await pool.query('DELETE FROM models WHERE id = $1', [model.id])
      cleaned++
      console.log(`  - Deleted orphaned model: ${model.name} (id: ${model.id})`)
    }

    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} orphaned model(s) older than 24 hours`)
    }
  } catch (err) {
    console.error('WARNING: Failed to cleanup orphaned models:', err.message)
  }
}

// ── Start ──────────────────────────────────────────────────────

async function start () {
  ensureStorageDir()
  await ensureTables()
  await bootstrapAdmin()

  // Run startup cleanup
  console.log('Running startup cleanup...')
  await cleanupStuckProcessingModels()
  await cleanupLeftoverTempFiles()
  await cleanupOrphanedModels()

  // Log IMPORT_DIR status
  if (IMPORT_DIR) {
    try {
      fs.statSync(IMPORT_DIR)
      console.log(`Import directory configured: ${IMPORT_DIR} (exists)`)
    } catch (err) {
      console.warn(`Import directory configured but not found: ${IMPORT_DIR}`)
    }
  } else {
    console.log('Import feature disabled (IMPORT_DIR not set)')
  }

  const port = parseInt(process.env.PORT || '3000', 10)
  app.listen(port, () => {
    console.log(`LLM Instruct Models API listening on port ${port}`)
  })
}

start().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
