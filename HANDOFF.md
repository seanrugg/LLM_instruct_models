# Handoff — LLM Instruct Models Repository

## Metadata

- **Date:** 2026-09-25
- **Claude model/version:** Opus 4.6 (via Claude Code)
- **Repo:** https://github.com/seanrugg/LLM_instruct_models
- **Final commit on `main`:** `04bfdb7` (Batch 8: smoke test script; drop local test suite)
- **App version:** 0.2.0

## Files Created or Changed

| File | Summary |
|------|---------|
| `backend/app/main.py` | Lifespan handler, JWT validation, admin bootstrap, tmp dir creation |
| `backend/app/core/config.py` | Settings with env_file, validators, DB_USER/DB_PASSWORD fields |
| `backend/app/core/database.py` | Async engine, session factory, init_db, get_db |
| `backend/app/core/security.py` | Password hashing (bcrypt), JWT creation/verification, download tokens |
| `backend/app/api/auth.py` | Login (with throttle), register (with gate), logout, config endpoint |
| `backend/app/api/models.py` | CRUD, streaming upload, download tokens, file response |
| `backend/app/api/users.py` | Admin user management, self-delete |
| `backend/app/api/deps.py` | get_current_user, get_current_admin dependencies |
| `backend/app/storage/storage.py` | StorageBackend: get_file_path, open_temp, commit_temp, delete_model_dir |
| `backend/app/schemas.py` | Pydantic schemas for all request/response models |
| `backend/app/models/models.py` | User and Model SQLAlchemy models |
| `backend/Dockerfile` | Non-root user (UID/GID 10001), uvicorn with --proxy-headers |
| `backend/.env.example` | Environment variable template |
| `frontend/Dockerfile` | Multi-stage build: node:20-alpine → nginx:alpine |
| `frontend/nginx.conf` | SPA fallback, API proxy, caching headers, large file support |
| `docker-compose.yml` | Production: PostgreSQL, backend, nginx frontend on 127.0.0.1:8080 |
| `docker-compose.dev.yml` | Development: PostgreSQL, hot-reload backend, Vite dev server |
| `scripts/smoke_test.sh` | Post-deploy validation script (curl-based) |
| `.gitignore` | Python, Node, database, environment, IDE, OS files |
| `README.md` | Project overview, architecture, quick start, env vars |
| `SETUP.md` | Step-by-step setup guide for production and dev |
| `DEPLOY_PLESK.md` | Plesk/IONOS deployment guide |
| `docs/PRE_DEPLOY_TASKS.md` | 9-batch deployment task list (source of truth) |

## Current Architecture

### Containers

| Container | Image/Build | Port | Purpose |
|-----------|-------------|------|---------|
| `llm-db` | postgres:15-alpine | 5432 (internal) | PostgreSQL database |
| `llm-backend` | ./backend | 8000 (internal) | FastAPI application |
| `llm-frontend` | ./frontend | 80 (internal) | nginx serving React SPA |

### Network Flow

```
Client → Plesk nginx (443/SSL)
         ↓ proxy to http://127.0.0.1:8080
         Frontend nginx container
         ├─ /api/* → proxy to http://backend:8000
         ├─ /docs, /openapi.json → proxy to http://backend:8000
         └─ /* → serve static files (SPA fallback to /index.html)
```

### Authentication Model

- **JWT HTTPBearer** — tokens in `Authorization: Bearer <token>` header
- **Login throttle** — 5 attempts per 15 minutes → 429
- **Registration gate** — `ALLOW_REGISTRATION=false` requires admin to create users
- **Admin bootstrap** — first admin created from `ADMIN_*` env vars on startup (only if users table is empty)
- **Download tokens** — short-lived (5 min), model-scoped JWTs. Not session JWTs.

### Storage Layout

```
/opt/llm-models/          (host bind mount, chown 10001:10001)
├── {user_id}/
│   └── {model_id}/
│       └── {stored_filename}
└── .tmp/                  (upload temp directory, created on startup)
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_USER` | Yes | `llm_user` | PostgreSQL username |
| `DB_PASSWORD` | Yes | — | PostgreSQL password (must match DATABASE_URL) |
| `DATABASE_URL` | Yes | — | `postgresql+asyncpg://user:pass@db:5432/llm_models` |
| `JWT_SECRET_KEY` | Yes | — | ≥32 chars. Refuses to start with default. |
| `JWT_ALGORITHM` | No | `HS256` | JWT algorithm |
| `JWT_EXPIRE_MINUTES` | No | `60` | Token expiry in minutes |
| `MODEL_STORAGE_PATH` | No | `/opt/llm-models` | Host bind mount path |
| `MAX_UPLOAD_SIZE_MB` | No | `50000` | 50 GB default |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated origins |
| `ALLOW_REGISTRATION` | No | `false` | Registration gate |
| `ADMIN_USERNAME` | See note | — | First admin username |
| `ADMIN_PASSWORD` | See note | — | First admin password |
| `ADMIN_EMAIL` | See note | — | First admin email |
| `DOWNLOAD_TOKEN_EXPIRE_MINUTES` | No | `5` | Download token TTL |
| `DEBUG` | No | `false` | Debug mode |

**Note:** `ADMIN_*` vars required when `ALLOW_REGISTRATION=false` to create the first admin.

## Test and Smoke-Test Results

- **Automated tests:** Dropped (no local Docker validation on personal server)
- **Smoke test script:** `scripts/smoke_test.sh <base_url> <admin_user> <admin_pass>`
- **Post-deploy:** Run smoke test via Claude in Chrome against `https://llm.cucorn.com`
- **Large file upload:** One manual upload >2 GB from Claude in Chrome (catches BigInteger, memory, temp-dir issues)

## Known Issues and Next Steps

### Known Issues (in priority order)

1. **Missing auth header returns 403 not 401** — FastAPI/HTTPBearer behavior. Frontend should handle 403 as "not authenticated".
2. **Frontend may need restart after backend restart** — nginx caches the backend container IP. Fix: `docker compose restart frontend`.
3. **No automated tests** — Only smoke_test.sh available. pytest suite was dropped (no local Docker validation).
4. **No per-user storage quotas** — Planned future work.
5. **No S3 storage backend** — Local filesystem only. Planned future work.
6. **No Alembic migrations** — `create_all` is sufficient for fresh deploy, but future schema changes will need them.

### Next Steps (future work)

- Alembic migrations for schema changes
- S3 storage backend
- Per-user storage quotas
- Drag-and-drop upload UI
- Resumable/chunked uploads for unreliable connections
- Audit logging for uploads/downloads
- API keys for programmatic access
- Email notifications for downloads

## Immutable Decisions (D1–D5)

- **D1**: PostgreSQL in Docker only. No MySQL/MariaDB, no Plesk-managed DB.
- **D2**: JWT HTTPBearer auth. Admin bootstrap from env vars.
- **D3**: Registration gate controlled by `ALLOW_REGISTRATION`.
- **D5**: Download tokens (short-lived, model-scoped JWTs), not session JWTs in URLs.

## Exact Deployment Commands for Claude in Chrome

```bash
# 1. SSH to server
ssh your_username@llm.cucorn.com

# 2. Navigate to app directory
cd /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models

# 3. Prepare model storage
sudo mkdir -p /opt/llm-models
sudo chown 10001:10001 /opt/llm-models

# 4. Create .env
cp .env.example .env
# Edit .env: set DB_PASSWORD, JWT_SECRET_KEY, ADMIN_PASSWORD

# 5. Build and start
docker compose up -d --build

# 6. Verify
docker compose ps
curl http://127.0.0.1:8080/health

# 7. Configure Plesk nginx (turn off Proxy mode, add directives)
# See DEPLOY_PLESK.md Step 8

# 8. Let's Encrypt SSL
# See DEPLOY_PLESK.md Step 9

# 9. Run smoke test
./scripts/smoke_test.sh https://llm.cucorn.com admin your_admin_password

# 10. Upload large file (>2 GB) for validation
# In Chrome: https://llm.cucorn.com → upload a file >2 GB
```
