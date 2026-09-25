# Pre-Deployment Task List — LLM_instruct_models

**Repo:** github.com/seanrugg/LLM_instruct_models
**Target:** https://llm.cucorn.com (Plesk / IONOS, Docker)
**Owner:** Sean (architecture and approvals) · Claude Code (implementation)
**Status:** Backend does not start (missing ORM module). Auth is stubbed. Deployment is blocked until every **REQUIRED** item below is done on `main` and the acceptance tests in Batch 8 pass.

---

## How to work this list

1. Work directly on `main`. The current `main` is known to be broken and insecure, so it is not worth preserving as a separate branch; git history is the record of the old state. Do not create feature branches.
2. Work in the batch order below. Each batch ends in **one commit** on `main` with a functional commit message (what changed and why, not just file names).
3. **Stop after each batch.** Post a short delivery note: files changed, a one-line summary for each, and any risks or downstream effects. Wait for Sean to confirm, then `git push origin main` before starting the next batch.
4. `main` is **not deployable** until Batch 8 passes. Nothing may be deployed to llm.cucorn.com from an intermediate commit.
5. Before editing any file, read its current contents. Don't work from assumptions about existing code. If something in the codebase is unclear, ask.
6. Flag risks proactively. That includes schema changes, new dependencies, new env vars, and anything that changes how Claude in Chrome must deploy.
7. When all batches are done, write `HANDOFF.md` (spec at the end of this file), commit it to `main`, and push.

## Decisions already made (do not revisit unless Sean changes them)

| # | Decision | Default |
|---|----------|---------|
| D1 | Production database | **PostgreSQL 15 in Docker Compose.** SQLite stays for local dev only. Drop MySQL from docs; the `database.py` MySQL branch may remain. |
| D2 | Access model | **Private repository.** Every `/api/models/*` and `/api/users/*` endpoint requires a valid JWT. Only `/api/auth/*`, `/health`, and `/` are public. |
| D3 | First user / registration | **Admin is seeded from env vars on startup if the users table is empty.** Public registration is **off by default** in production (`ALLOW_REGISTRATION=false`). |
| D4 | Frontend serving | **Production build (`vite build`) served by an nginx container.** That nginx also proxies `/api/` to the backend over the Docker network. Only one port is exposed to the host: `127.0.0.1:8080`. Plesk proxies everything to it. |
| D5 | Downloads | **Short-lived, model-scoped download tokens.** Never put the main session JWT in a URL. |

---

## Batch 1 — Restore the missing ORM layer (REQUIRED, blocker)

**Problem:** `.gitignore` has `models/` (unanchored). It matches every directory named `models` at any depth, so `backend/app/models/` was never committed. `auth.py`, `models.py`, and `users.py` all import `app.models.models` and crash on startup.

- [ ] **1.1** In `.gitignore`, change `models/` → `/models/` and `!models/.gitkeep` → `!/models/.gitkeep`. Also add `/backend/models/` and `/backend/data/` (local dev storage and SQLite).
- [ ] **1.2** Check whether `backend/app/models/models.py` and `__init__.py` already exist on local disk; they were written but ignored. If they exist, review them against 1.3 and fix any gaps rather than rewriting from scratch.
- [ ] **1.3** Ensure `backend/app/models/__init__.py` exports `User` and `Model`, and `backend/app/models/models.py` defines:
  - **User:** `id` (SQLAlchemy 2.0 `Uuid`, PK, default `uuid.uuid4`), `username` (String(50), unique, indexed, not null), `email` (String(255), unique, nullable), `password_hash` (String(255), not null), `is_admin` (Boolean, default False, not null), `created_at` (timezone-aware DateTime, server default now).
  - **Model:** `id` (Uuid PK), `owner_id` (Uuid FK → users.id, `ondelete="CASCADE"`, indexed, not null), `name` (String(255), not null), `description` (Text), `version` (String(50)), `tags` (JSON), `framework` (String(50)), `size_bytes` (**BigInteger**, because files exceed 2 GB), `filename` (String(512), not null, default `""`), `original_filename` (String(512)), `content_type` (String(255)), `created_at`, `updated_at` (with `onupdate`).
  - Relationship `User.models` ↔ `Model.owner` with `cascade="all, delete-orphan"`.
  - Use `Uuid` / `JSON` generic types so the same model works on SQLite and PostgreSQL.
- [ ] **1.4** Import `app.models` inside `init_db()` (or in `main.py` before `create_all`) so the tables register on `Base.metadata`.
- [ ] **1.5** Delete the empty stray package `backend/app/api/routes/`.
- [ ] **1.6** Verify: `git check-ignore -v backend/app/models/models.py` returns nothing. Run `git status --ignored` and confirm no other source files are being silently ignored. Run `uvicorn app.main:app` locally and confirm it starts and creates both tables.

## Batch 2 — Configuration and secrets (REQUIRED)

- [ ] **2.1** Rewrite `backend/app/core/config.py` using `model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)`. Add these settings:
  - `CORS_ORIGINS` — comma-separated string parsed to a list. Default `http://localhost:5173`.
  - `ALLOW_REGISTRATION: bool = False`
  - `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `ADMIN_EMAIL` — all `Optional[str]`
  - `DOWNLOAD_TOKEN_EXPIRE_MINUTES: int = 5`
  - `UPLOAD_TMP_DIR: Optional[str]` — defaults to `<MODEL_STORAGE_PATH>/.tmp`
- [ ] **2.2** Startup guard: if `DEBUG` is false and `JWT_SECRET_KEY` is still a default or shorter than 32 chars, refuse to start and log a clear error.
- [ ] **2.3** `main.py`: use `settings.CORS_ORIGINS` instead of the hard-coded list. Replace the deprecated `@app.on_event("startup")` with a `lifespan` handler.
- [ ] **2.4** Add a committed `.env.example` listing every variable with safe placeholder values and a comment for each. `.env` stays ignored.

## Batch 3 — Real authentication and first-user bootstrap (REQUIRED)

- [ ] **3.1** Create `backend/app/api/deps.py` with one shared dependency, `get_current_user`. It should:
  - Read `Authorization: Bearer <token>` via FastAPI's `HTTPBearer` (so Swagger `/docs` gets an Authorize button).
  - Decode the JWT and load the `User` from the database.
  - Return 401 on a missing, invalid, or expired token, or if the user no longer exists.
  - Also add `get_current_admin`, which returns 403 if the user is not an admin.
- [ ] **3.2** Remove the stub `get_current_user` (`Depends(lambda: None)`) from `api/models.py`. Remove `get_current_user_id(authorization: str)` from `api/users.py`, because it reads a query param, not the header. Use `deps.py` everywhere.
- [ ] **3.3** Per D2, require auth on **all** endpoints in `models.py` and `users.py`, including list, search, get, and download.
- [ ] **3.4** Admin bootstrap: on startup, after `create_all`, if the users table is empty **and** `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set, create that user with `is_admin=True` and log that it happened (never log the password). If the table is empty and no admin vars are set, log a prominent warning.
- [ ] **3.5** Registration gate: `POST /api/auth/register` returns 403 `"Registration is disabled"` when `ALLOW_REGISTRATION` is false. Add public `GET /api/auth/config` returning `{"allow_registration": bool}`.
- [ ] **3.6** Admin-only `POST /api/users` so the admin can create accounts when registration is off.
- [ ] **3.7** Fix `GET /api/users/me` to return the real user from the database. Currently it returns `created_at=None`, which fails response validation.
- [ ] **3.8** Add `is_admin` to `UserResponse`.
- [ ] **3.9** `DELETE /api/users/{id}`: allow self or admin. Before deleting the database rows, delete each owned model's file from storage.
- [ ] **3.10** Basic login throttling: after 5 failed attempts for a username within 15 minutes, return 429. An in-memory dict is acceptable for a single-instance deployment; note the limitation in the delivery notes.

## Batch 4 — Routing and proxy correctness (REQUIRED)

- [ ] **4.1** Change the collection routes in `api/models.py` from `"/"` to `""` for `list_models` and `create_model`. The URLs become exactly `/api/models`, which matches the frontend's calls and avoids the 307 redirect. Behind the proxy, that redirect becomes an `http://` URL and the browser blocks it as mixed content.
- [ ] **4.2** Backend Dockerfile CMD: add `--proxy-headers --forwarded-allow-ips="*"`. This is safe because the backend is only reachable on the internal Docker network.
- [ ] **4.3** Route order: confirm `/search` is declared before `/{model_id}`. It currently is; keep it that way.

## Batch 5 — Large-file upload and download (REQUIRED)

This app exists for multi-GB model files. Right now, both upload and download load the entire file into RAM.

- [ ] **5.1** Rewrite `upload_model_file` to stream:
  - Read `UploadFile` in chunks of about 8 MB.
  - Write to a temp file in `UPLOAD_TMP_DIR`, which must be on the same volume as the model storage so the final move is an atomic rename rather than a 50 GB copy.
  - Count bytes as you go. Abort with 413 and delete the partial file as soon as the total exceeds `MAX_UPLOAD_SIZE_MB`.
  - On success, `os.replace()` the temp file into the model directory.
  - If the model already had a file, delete the old one after the new one is in place.
  - Set `size_bytes` from the byte count.
  - Run blocking file I/O in a threadpool (`run_in_threadpool` or `aiofiles`) so large uploads don't block the event loop.
- [ ] **5.2** Set `TMPDIR` for the backend container to a directory on the model volume. python-multipart spools uploads to temp storage first, and the container's `/tmp` is too small for 50 GB files.
- [ ] **5.3** Add `StorageBackend` methods: `get_file_path()`, `open_temp()` / `commit_temp()`, and `delete_model_dir()`. Stop creating directories on read paths; `_get_model_path` currently calls `mkdir` even for `get` and `exists`.
- [ ] **5.4** Download, per D5:
  - `POST /api/models/{id}/download-token` (auth required) returns a JWT with claims `{"sub": user_id, "mid": model_id, "typ": "download"}` that expires in `DOWNLOAD_TOKEN_EXPIRE_MINUTES`.
  - `GET /api/models/{id}/download?token=...` accepts **only** a token whose `typ` is `download` and whose `mid` matches. Serve with `FileResponse(path, filename=original_filename, media_type=...)`, never `Response(content=bytes)`.
  - Confirm range requests work so large downloads can resume. If the pinned Starlette version doesn't support them, note it.
- [ ] **5.5** Sanitize `original_filename` before building the stored name and the `Content-Disposition` header: strip path components and quotes.

## Batch 6 — Frontend fixes (REQUIRED)

- [ ] **6.1** `api/client.js`: `modelAPI.upload(id, file, config)` must pass the caller's `onUploadProgress` through to axios. Right now it's ignored and the progress bar never moves. Set `timeout: 0` for uploads.
- [ ] **6.2** Download flow in `ModelDetail.jsx`: call `download-token`, then set `window.location.href` to the `/download?token=` URL. Remove `modelAPI.download` building a URL with the session JWT.
- [ ] **6.3** Auth state: `App.jsx` reads `localStorage` at render time, so after login the routes can stay stale until a manual refresh. Add a small `AuthContext` (token, user, login, logout) and a `ProtectedRoute` wrapper. Login and logout should update the context so the UI changes immediately.
- [ ] **6.4** On app load, fetch `/api/auth/config`. Hide the Register link and route when registration is disabled. Show "Contact the administrator for an account" instead.
- [ ] **6.5** `ModelList.jsx`: search currently fires on every keystroke (it's in the `useEffect` deps) *and* on submit. Keep a separate `query` state that is committed only on submit.
- [ ] **6.6** Show the backend's upload error messages (413, 400) clearly in `UploadModel.jsx`. Warn before leaving the page while an upload is in progress (`beforeunload`).
- [ ] **6.7** Remove "or drag and drop (coming soon)" unless drag-and-drop is implemented.
- [ ] **6.8** Commit `package-lock.json`. Pin `vite` to an exact 5.4.x version.

## Batch 7 — Production containers and compose (REQUIRED)

- [ ] **7.1** `frontend/Dockerfile`: multi-stage build.
  - Stage 1: `node:20-alpine`, `npm ci`, `npm run build`.
  - Stage 2: `nginx:alpine` serving `/usr/share/nginx/html`.
- [ ] **7.2** Add `frontend/nginx.conf` with:
  - SPA fallback: `try_files $uri /index.html`.
  - `location /api/` proxying to `http://backend:8000` (no trailing slash, so the `/api` prefix is preserved).
  - Also proxy `/docs` and `/openapi.json` to the backend.
  - `client_max_body_size 0;`, `proxy_request_buffering off;`, `proxy_buffering off;`, `proxy_read_timeout 3600s;`, `proxy_send_timeout 3600s;`.
  - Forward `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` (pass through `$http_x_forwarded_proto` from Plesk).
  - Long cache headers for `/assets/`; `no-cache` for `index.html`.
- [ ] **7.3** Rename the current dev compose file to `docker-compose.dev.yml`. Fix its SQLite path so the database lives on a volume (`/app/data/llm_models.db`); right now it's lost on every rebuild.
- [ ] **7.4** Create `docker-compose.prod.yml` with three services:
  - **db:** `postgres:15-alpine`, named volume, credentials from `.env`, healthcheck using `pg_isready`, no host ports.
  - **backend:** built from `./backend`, **no source bind mounts**, `env_file: .env`, model storage bind-mounted from `/opt/llm-models`, `depends_on: db: condition: service_healthy`, no host ports, `restart: unless-stopped`.
  - **frontend:** built from `./frontend`, ports `"127.0.0.1:8080:80"` only, `depends_on: backend`.
  - Remove the obsolete `version:` key.
- [ ] **7.5** Backend Dockerfile: drop `build-essential` if nothing needs it. Run as a non-root user and document the UID so Sean can `chown` `/opt/llm-models`. Add `HEALTHCHECK` hitting `/health`.
- [ ] **7.6** Confirm `frontend/public/` exists, or remove any mount or copy that references it.

## Batch 8 — Tests and acceptance (REQUIRED before deployment)

- [ ] **8.1** Add `backend/requirements-dev.txt` (`pytest`, `pytest-asyncio`) and `backend/tests/` using `httpx.AsyncClient` against a temporary SQLite database and a temporary storage dir. Cover:
  - The app imports and starts; tables are created.
  - Admin bootstrap creates exactly one admin, and only when the table is empty.
  - Register returns 403 when disabled and 201 when enabled.
  - Login succeeds with correct credentials, returns 401 on a bad password, and returns 429 after repeated failures.
  - Every model and user endpoint returns 401 without a token.
  - Create model → upload a small `.gguf` → metadata shows the correct `size_bytes` → download-token → download bytes match.
  - Upload over the limit returns 413 and leaves no partial file behind.
  - A disallowed extension returns 400.
  - A download token for model A is rejected for model B, and the session JWT is rejected as a download token.
  - A non-owner gets 403 on update, delete, and upload.
  - Deleting a model removes its file. Deleting a user removes their models and files.
  - `POST /api/models` returns 201 with no redirect.
- [ ] **8.2** Add `scripts/smoke_test.sh <base_url> <admin_user> <admin_pass>`. It uses curl and exits non-zero on the first failure. Steps: health → login → create → upload a 1 MB dummy `.gguf` → list → download-token → download and compare checksum → delete. Claude in Chrome will run this against `https://llm.cucorn.com` after deployment.
- [ ] **8.3** Run locally: `docker compose -f docker-compose.prod.yml up --build` with a test `.env`, then `./scripts/smoke_test.sh http://127.0.0.1:8080 ...`. Also run one manual upload of a file **larger than 2 GB**; it catches the BigInteger, memory, and temp-dir issues. Report the results in the delivery note.

## Batch 9 — Documentation (REQUIRED)

- [ ] **9.1** Rewrite `DEPLOY_PLESK.md` to match the new architecture. It must:
  - Have single, correctly numbered steps (the current file has duplicate "Step 6" and "Step 8").
  - Cover PostgreSQL in Docker only.
  - Include `mkdir -p /opt/llm-models && chown <uid> /opt/llm-models`.
  - Explain creating `.env` from `.env.example` and generating a JWT secret with `openssl rand -hex 32`.
  - Use `docker compose -f docker-compose.prod.yml up -d --build`.
  - Configure Plesk nginx with a **single** upstream, `http://127.0.0.1:8080`, including `client_max_body_size 0; proxy_request_buffering off; proxy_read_timeout 3600s;` and the `X-Forwarded-Proto $scheme` header. Explain that Plesk's **Proxy mode** (Apache & nginx Settings) must be turned off before a custom `location /` will save without a "duplicate location" error.
  - Drop the Apache variant. Its `ProxyPass .../` strips the `/api` prefix and would break every call.
  - Cover Let's Encrypt via Plesk.
  - Replace the SQLite backup section with `pg_dump` from the db container, plus a note about backing up `/opt/llm-models`.
  - Remove the "Initialize Database" step that starts a second uvicorn on the same port; tables and the admin are created automatically.
  - End with running `scripts/smoke_test.sh` against the live URL.
  - Add troubleshooting entries for 413 (Plesk or nginx body size), 502 (backend not healthy, check `docker compose logs backend`), and mixed-content errors.
- [ ] **9.2** Update `README.md` and `SETUP.md`: new compose file names, env vars table (including `ALLOW_REGISTRATION` and the `ADMIN_*` vars), how the first admin is created, and dev vs prod differences.
- [ ] **9.3** Security notes in README: JWT stored in localStorage (acceptable for now, listed as a known limitation), single-instance login throttle, no per-user storage quotas yet.

## Out of scope for this pass (list in HANDOFF.md as future work)

Alembic migrations (`create_all` is sufficient for a fresh deploy, but any future schema change will need them), S3 storage backend, per-user quotas, drag-and-drop upload, resumable/chunked uploads for very unreliable connections, audit logging, API keys for programmatic access.

---

## HANDOFF.md spec (write at the end)

- Date, Claude model/version, repo, and the final commit hash on `main` that was tested.
- App version (bump `APP_VERSION` to `0.2.0`).
- Files created or changed, with a one-line summary for each.
- Current architecture: containers, ports, the request path Plesk → frontend nginx → backend, the auth model, the storage layout, and the full env var list.
- Test and smoke-test results, including the >2 GB upload.
- Known issues and next steps, in priority order.
- Immutable decisions D1–D5.
- Exact deployment commands for Claude in Chrome to follow.
