# LLM Instruct Models Repository

A self-hosted model repository for managing, uploading, and downloading large language model weights and checkpoints.

## Architecture

```
Internet → Plesk nginx (443) → proxy to http://127.0.0.1:8080
                                 ├─ /api/* → frontend nginx → backend:8000
                                 ├─ /docs, /openapi.json → backend:8000
                                 └─ /* → frontend nginx (SPA fallback)

Containers: llm-db (PostgreSQL 15), llm-backend (FastAPI), llm-frontend (nginx)
User data: /opt/llm-models (bind-mounted, chown 10001:10001)
UID/GID: 10001 (non-root backend)
```

## Features

- **User Authentication** — JWT tokens with HTTPBearer, admin bootstrap from env vars
- **Registration Gate** — `ALLOW_REGISTRATION=false` requires admin to create users
- **Model Upload** — Streaming uploads with 8 MB chunks, atomic rename, up to 50 GB
- **Model Download** — Short-lived download tokens (model-scoped JWTs), not session JWTs
- **Model Management** — Names, descriptions, versions, tags, frameworks, search
- **Pagination** — Efficient browsing of large model libraries
- **Docker Compose** — Three containers: PostgreSQL, FastAPI backend, nginx frontend

## Tech Stack

### Backend
- **Framework:** FastAPI (Python 3.10+)
- **Database:** PostgreSQL 15 (in Docker)
- **ORM:** SQLAlchemy 2.0 (async)
- **Authentication:** JWT with bcrypt password hashing
- **Storage:** Local filesystem with `/opt/llm-models` bind mount

### Frontend
- **Framework:** React 18
- **Build Tool:** Vite
- **Routing:** React Router
- **HTTP Client:** Axios
- **Serving:** nginx (alpine)

## Quick Start (Production)

```bash
# Clone the repository
git clone <your-repo-url>
cd LLM_instruct_models

# Prepare model storage (backend runs as UID 10001)
sudo mkdir -p /opt/llm-models
sudo chown 10001:10001 /opt/llm-models

# Create .env from example
cp .env.example .env
# Edit .env: set DB_PASSWORD, JWT_SECRET_KEY, ADMIN_PASSWORD

# Build and start
docker compose up -d --build

# Verify
docker compose ps
curl http://127.0.0.1:8080/health
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_USER` | Yes | `llm_user` | PostgreSQL username |
| `DB_PASSWORD` | Yes | — | PostgreSQL password (must match DATABASE_URL) |
| `DATABASE_URL` | Yes | — | `postgresql+asyncpg://user:pass@db:5432/llm_models` |
| `JWT_SECRET_KEY` | Yes | — | ≥32 chars. Refuses to start with default. |
| `JWT_ALGORITHM` | No | `HS256` | JWT algorithm |
| `JWT_EXPIRE_MINUTES` | No | `60` | Token expiry |
| `MODEL_STORAGE_PATH` | No | `/opt/llm-models` | Bind-mount path |
| `MAX_UPLOAD_SIZE_MB` | No | `50000` | 50 GB default |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Comma-separated origins |
| `ALLOW_REGISTRATION` | No | `false` | Registration gate |
| `ADMIN_USERNAME` | See note | — | First admin username |
| `ADMIN_PASSWORD` | See note | — | First admin password |
| `ADMIN_EMAIL` | See note | — | First admin email |
| `DOWNLOAD_TOKEN_EXPIRE_MINUTES` | No | `5` | Download token TTL |
| `DEBUG` | No | `false` | Debug mode |

**Note:** With `ALLOW_REGISTRATION=false`, `ADMIN_*` vars are required to create the first admin user. The admin is bootstrapped on startup only if the users table is empty.

## Project Structure

```
LLM_instruct_models/
├── backend/
│   ├── app/
│   │   ├── api/           # API routes (auth, models, users)
│   │   ├── core/          # Config, security, database
│   │   ├── models/        # SQLAlchemy models
│   │   ├── schemas/       # Pydantic schemas
│   │   ├── storage/       # Storage backend
│   │   └── main.py        # FastAPI application
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/           # API client
│   │   ├── components/    # React components
│   │   ├── context/       # Auth context
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── scripts/
│   └── smoke_test.sh      # Post-deploy validation
├── docker-compose.yml       # Production compose
├── docker-compose.dev.yml   # Development compose
├── .env.example
└── DEPLOY_PLESK.md
```

## Development

### Dev environment

```bash
# Start dev environment (PostgreSQL, hot-reload backend, Vite dev server)
docker compose -f docker-compose.dev.yml up -d
```

- Backend: http://127.0.0.1:8000 (hot-reload)
- Frontend: http://127.0.0.1:5173 (Vite dev server)
- DB: localhost:5432

### Manual setup

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

## API Documentation

Interactive docs at `http://127.0.0.1:8000/docs` (dev) or proxied via Plesk (prod).

### Key Endpoints

- `POST /api/auth/register` — Register (if allowed)
- `POST /api/auth/login` — Login, returns JWT
- `GET /api/auth/config` — Returns `{"allow_registration": bool}`
- `GET /api/models` — List models (paginated)
- `GET /api/models/search?q=...` — Search models
- `POST /api/models` — Create model metadata
- `POST /api/models/{id}/upload` — Upload model file (streaming)
- `POST /api/models/{id}/download-token` — Generate download token
- `GET /api/models/{id}/download?token=...` — Download model
- `DELETE /api/models/{id}` — Delete model

## Security Notes

- **JWT stored in localStorage** — acceptable for now, listed as a known limitation
- **Single-instance login throttle** — 5 attempts per 15 minutes → 429
- **No per-user storage quotas** — planned future work
- **Non-root backend** — runs as UID 10001
- **Download tokens** — short-lived, model-scoped JWTs (not session JWTs)

## Known Issues

- Missing auth header returns **403** not 401 (FastAPI/HTTPBearer behavior)
- Frontend may need a restart after backend restart (nginx caches backend IP)
- No automated tests (smoke test script available for post-deploy)

## Deployment

See [DEPLOY_PLESK.md](./DEPLOY_PLESK.md) for the full Plesk/IONOS deployment guide.

## License

MIT
