# Deploy to Plesk (IONOS)

Deploy the LLM Instruct Models Repository to `llm.cucorn.com` on Plesk.

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

## Prerequisites

- SSH access to your Plesk server (requires `root` or `sudo` for some steps)
- Domain: `cucorn.com`, subdomain: `llm.cucorn.com` (configured in Plesk)
- Docker and Docker Compose v2 on the server (Plesk Docker extension)
- `openssl` for JWT secret generation

## Step 1: Connect via SSH

```bash
ssh your_username@llm.cucorn.com
```

## Step 2: Create application directory

Install to `/opt/llm-instruct-models` (keeps `.env` out of the web root):

```bash
sudo mkdir -p /opt
cd /opt
git clone https://github.com/seanrugg/LLM_instruct_models.git llm-instruct-models
cd llm-instruct-models
```

## Step 3: Prepare the model storage directory

```bash
# The backend container runs as UID/GID 10001 (non-root).
# The bind mount on /opt/llm-models must be writable by that user.
sudo mkdir -p /opt/llm-models
sudo chown 10001:10001 /opt/llm-models
sudo chmod 755 /opt/llm-models
```

## Step 4: Clone the repository

```bash
git clone https://github.com/seanrugg/LLM_instruct_models.git .
# Or if using private repo with SSH:
# git clone git@github.com:seanrugg/LLM_instruct_models.git .
```

## Step 5: Create `.env` from `.env.example`

```bash
cp .env.example .env
nano .env
```

Generate a secure JWT secret:

```bash
openssl rand -hex 32
```

Paste the output as `JWT_SECRET_KEY`. The password in `DATABASE_URL` **must match** `DB_PASSWORD` (the POSTGRES_PASSWORD set on the db container).

Example `.env` (production):

```env
APP_NAME=LLM Instruct Models Repository
APP_VERSION=0.2.0
DEBUG=false

DB_USER=llm_user
DB_PASSWORD=your_strong_password_here
DATABASE_URL=postgresql+asyncpg://llm_user:your_strong_password_here@db:5432/llm_models

JWT_SECRET_KEY=your_64_char_hex_string_here
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60

MODEL_STORAGE_PATH=/opt/llm-models
MAX_UPLOAD_SIZE_MB=50000

CORS_ORIGINS=https://llm.cucorn.com

ALLOW_REGISTRATION=false

ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_admin_password_here
ADMIN_EMAIL=admin@cucorn.com

DOWNLOAD_TOKEN_EXPIRE_MINUTES=5
```

**Important notes:**
- `DB_PASSWORD` and the password in `DATABASE_URL` must be identical.
- `DATABASE_URL` uses `host=db` (the Docker Compose service name), not `localhost`.
- With `ALLOW_REGISTRATION=false`, the first admin is created from `ADMIN_*` vars at startup.
- `JWT_SECRET_KEY` must be at least 32 characters. The app refuses to start with the default.

## Step 6: Verify Docker Compose version

```bash
docker compose version
# Should output: Docker Compose version v2.x.x
```

If you get `docker-compose` (hyphen), you have the legacy v1. Install the v2 plugin:
```bash
sudo apt-get install docker-compose-plugin
```

## Step 7: Build and start containers

```bash
cd /opt/llm-instruct-models
docker compose up -d --build
```

Verify all three containers are healthy:

```bash
docker compose ps
# Expected: llm-db, llm-backend, llm-frontend all running (status: healthy/running)
```

Check backend logs for admin bootstrap confirmation:

```bash
docker compose logs backend | grep "Admin user created"
```

### Fix file permissions (if needed)

```bash
sudo chown -R 10001:10001 /opt/llm-instruct-models
```
```

## Step 8: Configure Plesk nginx

### 8.1 Turn off Proxy mode (required for custom location blocks)

In Plesk UI: **Domains → llm.cucorn.com → Apache & Nginx Settings** → set **Proxy mode** to **Off**. Save. This is required; otherwise Plesk will reject a custom `location /` block with a "duplicate location" error.

### 8.2 Add custom nginx directives

In Plesk UI: **Domains → llm.cucorn.com → Apache & Nginx Settings → Additional Nginx Directives**:

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

**Do NOT add** a `location /api/` block here — the frontend container already proxies `/api/` to the backend. Adding a second `/api/` block in Plesk nginx will conflict.

Click **Apply** or **Save**.

### 8.3 Do NOT use the Apache variant

Apache's `ProxyPass /api/ ...` strips the `/api` prefix and breaks every API call. Nginx only.

## Step 9: Let's Encrypt SSL

In Plesk UI: **Domains → llm.cucorn.com → SSL/TLS Certificates → Add Let's Encrypt Certificate**:

- Domain: `llm.cucorn.com`
- SSL/TLS Streaming: **On**
- Auto-renew: **Enabled**

Click **OK**. Plesk obtains and installs the certificate automatically.

### Enable HTTP → HTTPS redirect

After adding Let's Encrypt, in Plesk UI: **Domains → llm.cucorn.com → Hosting Settings** → enable **Permanent SEO-safe 301 redirect from HTTP to HTTPS**.

## Step 10: Run the smoke test

```bash
cd /opt/llm-instruct-models
./scripts/smoke_test.sh https://llm.cucorn.com admin your_admin_password_here
```

Expected: all steps pass. If any step fails, the script exits non-zero with the failure details.

## Step 11: Upload a large file (validation)

In Chrome on `https://llm.cucorn.com`, upload a file **larger than 2 GB**. This catches:
- BigInteger serialization (PostgreSQL `BIGINT`)
- Memory pressure during streaming upload
- Temp-dir permissions on `/opt/llm-models/.tmp`

## Step 12: Backup

### Database (PostgreSQL)

```bash
# One-time backup
docker exec llm-db pg_dump -U llm_user llm_models > /opt/backups/llm-db-$(date +%Y%m%d).sql

# Daily via cron (add with `crontab -e`)
0 2 * * * docker exec llm-db pg_dump -U llm_user llm_models > /opt/backups/llm-db-$(date +\%Y\%m\%d).sql
```

### Model files

```bash
# Back up /opt/llm-models (the bind mount on the host)
tar -czf /opt/backups/llm-models-$(date +%Y%m%d).tar.gz -C / opt/llm-models
```

## Troubleshooting

### 413 Payload Too Large

Plesk or nginx body size limit. Verify:
1. Plesk Additional Nginx Directives has `client_max_body_size 0;`
2. No competing `client_max_body_size` in Plesk's default config
3. Container nginx.conf has `client_max_body_size 0;` in `/api/`

### 502 Bad Gateway

Backend not healthy. Check:
```bash
docker compose logs backend
docker compose ps
curl http://127.0.0.1:8080/health
```

If backend is down: `docker compose restart backend`.

### Mixed Content Errors

Ensure `CORS_ORIGINS` in `.env` is `https://llm.cucorn.com` (with https). Ensure Plesk redirects HTTP → HTTPS.

### Frontend needs restart after backend restart

nginx caches the backend container IP. If the backend container restarts (e.g., after a deploy), the frontend nginx may still point at the old IP. Fix:

```bash
# Restart frontend to refresh DNS resolution
docker compose restart frontend
```

Or restart both:
```bash
docker compose restart frontend backend
```

### Tables not created / admin not bootstrapped

The app creates tables and the admin user on first startup automatically. If they're missing:
```bash
docker compose logs backend | grep -E "Admin user created|Tables created"
```

If still missing, check that `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set in `.env` and that `ALLOW_REGISTRATION=false`.

## Immutable Decisions (from PRE_DEPLOY_TASKS.md)

- **D1**: PostgreSQL in Docker only. No MySQL/MariaDB, no Plesk-managed DB.
- **D2**: JWT HTTPBearer auth. Admin bootstrap from env vars.
- **D3**: Registration gate controlled by `ALLOW_REGISTRATION`.
- **D5**: Download tokens (short-lived, model-scoped JWTs), not session JWTs in URLs.
