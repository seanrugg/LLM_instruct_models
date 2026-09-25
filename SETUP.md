# Setup Guide

## Prerequisites

- Docker and Docker Compose v2 on the server
- SSH access to the server
- Domain with subdomain configured (e.g., `llm.cucorn.com`)

## Production Setup (Plesk/IONOS)

### 1. Clone the Repository

```bash
ssh your_username@llm.cucorn.com
cd /var/www/vhosts/cucorn.com/subdomains/llm
mkdir -p llm-instruct-models
cd llm-instruct-models
git clone <your-repo-url> .
```

### 2. Prepare Model Storage

```bash
sudo mkdir -p /opt/llm-models
sudo chown 10001:10001 /opt/llm-models
sudo chmod 755 /opt/llm-models
```

The backend container runs as UID/GID 10001 (non-root). The bind mount must be writable by that user.

### 3. Configure Environment

```bash
cp .env.example .env
nano .env
```

**Required changes:**

1. **DB_PASSWORD** — generate with: `openssl rand -hex 16`
2. **DATABASE_URL** — the password here **must match** DB_PASSWORD. Use `host=db` (Docker service name), not `localhost`.
3. **JWT_SECRET_KEY** — generate with: `openssl rand -hex 32`. Must be ≥32 characters.
4. **ADMIN_USERNAME/PASSWORD/EMAIL** — required when `ALLOW_REGISTRATION=false` to create the first admin.

Example `.env`:

```env
DB_USER=llm_user
DB_PASSWORD=your_generated_password
DATABASE_URL=postgresql+asyncpg://llm_user:your_generated_password@db:5432/llm_models

JWT_SECRET_KEY=your_64_char_hex_string
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60

MODEL_STORAGE_PATH=/opt/llm-models
MAX_UPLOAD_SIZE_MB=50000

CORS_ORIGINS=https://llm.cucorn.com

ALLOW_REGISTRATION=false

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_admin_password
ADMIN_EMAIL=admin@cucorn.com

DOWNLOAD_TOKEN_EXPIRE_MINUTES=5
```

### 4. Build and Start

```bash
docker compose up -d --build
```

Verify:

```bash
docker compose ps
# Expected: llm-db, llm-backend, llm-frontend all running

curl http://127.0.0.1:8080/health
# Expected: {"status":"healthy"}
```

### 5. Configure Plesk nginx

1. **Turn off Proxy mode**: Domains → llm.cucorn.com → Apache & Nginx Settings → Proxy mode: **Off**
2. **Add directives**: Domains → llm.cucorn.com → Apache & Nginx Settings → Additional Nginx Directives:

```nginx
client_max_body_size 0;
proxy_request_buffering off;
proxy_read_timeout 3600s;
proxy_send_timeout 3600s;

location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 6. Let's Encrypt SSL

Domains → llm.cucorn.com → SSL/TLS Certificates → Add Let's Encrypt Certificate.

### 7. Run Smoke Test

```bash
./scripts/smoke_test.sh https://llm.cucorn.com admin your_admin_password
```

## Dev Setup

```bash
# Start dev environment
docker compose -f docker-compose.dev.yml up -d

# Backend: http://127.0.0.1:8000
# Frontend: http://127.0.0.1:5173
# DB: localhost:5432
```

## First Admin Creation

With `ALLOW_REGISTRATION=false`, the first admin is created from `ADMIN_*` env vars on first startup. The admin is created only if the users table is empty.

If you need to create additional admins:
1. Log in as the first admin
2. Use `POST /api/users` (admin only) to create new users with `is_admin=true`

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DB_USER` | Yes | `llm_user` | PostgreSQL username |
| `DB_PASSWORD` | Yes | — | PostgreSQL password |
| `DATABASE_URL` | Yes | — | `postgresql+asyncpg://user:pass@db:5432/llm_models` |
| `JWT_SECRET_KEY` | Yes | — | ≥32 chars |
| `MODEL_STORAGE_PATH` | No | `/opt/llm-models` | Bind-mount path |
| `ALLOW_REGISTRATION` | No | `false` | Registration gate |
| `ADMIN_USERNAME` | See note | — | First admin username |
| `ADMIN_PASSWORD` | See note | — | First admin password |
| `ADMIN_EMAIL` | See note | — | First admin email |

**Note:** `ADMIN_*` vars required when `ALLOW_REGISTRATION=false`.

## Troubleshooting

### Backend won't start

Check JWT secret:
```bash
docker compose logs backend | grep "JWT_SECRET_KEY"
```

The app refuses to start if the secret is the default or <32 characters (when DEBUG=false).

### Frontend can't connect to backend

Restart frontend to refresh nginx DNS resolution:
```bash
docker compose restart frontend
```

### Database errors

Check DB container:
```bash
docker compose logs db
docker exec llm-db pg_isready -U llm_user
```

### Permission issues on /opt/llm-models

```bash
sudo chown 1001:1001 /opt/llm-models
sudo chmod 755 /opt/llm-models
```

## Update Application

```bash
cd /var/www/vhosts/cucorn.com/subdomains/llm/llm-instruct-models
git pull
docker compose up -d --build
```
