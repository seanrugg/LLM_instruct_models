# Deploy to Plesk (IONOS) — Node.js Option

Deploy the LLM Instruct Models Repository to `llm.cucorn.com` using Plesk's Node.js extension (Phusion Passenger). No Docker required.

## Architecture

```
Internet → Plesk nginx (443) → Phusion Passenger (node server.js on $PORT, default 3000)
                                 ├─ /api/* → Express API (PostgreSQL on localhost)
                                 └─ /* → serve plesk-node/public/ (React SPA)

Database: Plesk-managed PostgreSQL (localhost:5432)
User data: ~/llm-storage (default, configurable via MODEL_STORAGE_PATH)
Node: 20+
Passenger manages the port via $PORT env var; do not hard-code 8080.
```

## Prerequisites

- Domain: `cucorn.com`, subdomain: `llm.cucorn.com` (configured in Plesk)
- Plesk Node.js extension enabled
- Plesk PostgreSQL extension enabled (or add a database manually)
- Node.js 20+ available on the server

## Step 1: Clone the repository

In Plesk UI: **Git → Clone a Repository**

- URL: `https://github.com/seanrugg/LLM_instruct_models.git`
- Path: `/llm-app`
- Click **Clone**

## Step 2: Add a PostgreSQL database in Plesk

In Plesk UI: **Databases → Add Database**

- Name: `llm_models`
- Database server: **Local**
- Create a new user: check the box
  - Username: `llm_user`
  - Password: generate with Plesk's password generator (or `openssl rand -hex 16`)
- Grant all privileges to the user on this database
- Click **OK**

> Use the exact database name and username Plesk shows after creation; Plesk may add a prefix (e.g. `u12345_llm_models`). Record both the name and username — you'll need them in Step 3.

## Step 3: Configure environment variables

In Plesk UI: **Domains → llm.cucorn.com → Node.js**

Set these environment variables:

| Variable | Value |
|----------|-------|
| `DB_USER` | *(the username from Step 2)* |
| `DB_PASSWORD` | *(the password from Step 2)* |
| `DB_NAME` | *(the database name from Step 2)* |
| `DATABASE_URL` | *(leave empty unless you need a custom connection string)* |
| `JWT_SECRET_KEY` | *(generate with `openssl rand -hex 32`)* |
| `JWT_ALGORITHM` | `HS256` |
| `JWT_EXPIRE_MINUTES` | `60` |
| `MAX_UPLOAD_SIZE_MB` | `50000` |
| `CORS_ORIGINS` | `https://llm.cucorn.com` |
| `ALLOW_REGISTRATION` | `false` |
| `ADMIN_USERNAME` | *(your admin username)* |
| `ADMIN_PASSWORD` | *(your admin password)* |
| `ADMIN_EMAIL` | `admin@cucorn.com` |
| `DOWNLOAD_TOKEN_EXPIRE_MINUTES` | `5` |
| `DEBUG` | `false` |

**Important notes:**
- `DB_PASSWORD` must match the password set in Step 2.
- `DATABASE_URL` overrides `DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_HOST`/`DB_PORT` if set.
- `JWT_SECRET_KEY` must be at least 32 characters. The app refuses to start with a shorter key (when `DEBUG=false`).
- With `ALLOW_REGISTRATION=false`, the first admin is created from `ADMIN_*` vars at startup.
- `MODEL_STORAGE_PATH` is optional; defaults to `~/llm-storage` if not set.

## Step 4: Configure the Node.js application

In Plesk UI: **Domains → llm.cucorn.com → Node.js**

> Labels may differ slightly by Plesk version; match by function.

1. **Node version:** Select **20.x** (or higher)
2. **Application mode:** Select **Production**
3. **Application Root:** `/llm-app/plesk-node`
4. **Document Root:** `/llm-app/plesk-node/public`
5. **Application Startup File:** `server.js`

> **Note:** If Plesk won't save the Document Root because the folder doesn't exist yet, create `plesk-node/public` with Plesk's File Manager first (empty folder is fine — the build script populates it).

6. **Custom environment variables** — add these one per line (`KEY=VALUE`):

```
DB_USER=<username from Step 2>
DB_PASSWORD=<password from Step 2>
DB_NAME=<database name from Step 2>
JWT_SECRET_KEY=<openssl rand -hex 32>
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=60
MAX_UPLOAD_SIZE_MB=50000
CORS_ORIGINS=https://llm.cucorn.com
ALLOW_REGISTRATION=false
ADMIN_USERNAME=<your admin username>
ADMIN_PASSWORD=<your admin password>
ADMIN_EMAIL=admin@cucorn.com
DOWNLOAD_TOKEN_EXPIRE_MINUTES=5
DEBUG=false
```

> `DATABASE_URL` overrides the individual DB_* variables if set. `MODEL_STORAGE_PATH` is optional and defaults to `~/llm-storage`. `JWT_SECRET_KEY` must be at least 32 characters.

7. Click **Save** (or **Apply**)

Then, in order:

8. Click **NPM install**
9. Click **Run script** (runs `build` — installs Node deps and builds the React frontend)
10. Click **Enable Node.js** (or **Restart App**)

## Step 5: Verify the app started

Check the Plesk Node.js panel for a green status. Open in a browser:

- `https://llm.cucorn.com/health` — should return `{"status":"healthy"}`
- `https://llm.cucorn.com/` — should show the React login page

Check startup logs for admin bootstrap confirmation:

- In Plesk UI: **Domains → llm.cucorn.com → Node.js → Logs**
- Look for: `"Admin user '...' created successfully"`

## Step 6: Configure Apache & nginx

### 6.1 Additional nginx directives

In Plesk UI: **Domains → llm.cucorn.com → Apache & Nginx Settings → Additional Nginx Directives**:

```nginx
client_max_body_size 0;
passenger_request_buffering off;
```

Click **Apply** or **Save**.

**Do NOT add** a `location /api/` block — Passenger handles routing to the Node.js app. Adding a competing `/api/` block in Plesk nginx will conflict.

### 6.2 Apache request body limit

In Plesk UI: **Domains → llm.cucorn.com → Apache & Nginx Settings → Additional Apache Directives**:

For **HTTP** (port 80):
```
LimitRequestBody 0
```

For **HTTPS** (port 443):
```
LimitRequestBody 0
```

Click **Apply** or **Save**.

This removes the Apache request body size limit (default 1 GiB on Apache 2.4.53+), allowing large file uploads to reach the Node.js app. Without this, uploads over ~1 GiB will return 413 from Apache before reaching the app.

### 6.2 Proxy mode

Leave Plesk's **Proxy mode** at its default (On). Passenger manages its own upstream.

## Step 7: Let's Encrypt SSL

In Plesk UI: **Domains → llm.cucorn.com → SSL/TLS Certificates → Add Let's Encrypt Certificate**:

- Domain: `llm.cucorn.com`
- SSL/TLS Streaming: **On**
- Auto-renew: **Enabled**

Click **OK**. Plesk obtains and installs the certificate automatically.

### Enable HTTP → HTTPS redirect

After adding Let's Encrypt, in Plesk UI: **Domains → llm.cucorn.com → Hosting Settings → enable Permanent SEO-safe 301 redirect from HTTP to HTTPS**.

## Step 8: Browser acceptance test

1. Open `https://llm.cucorn.com` in Chrome
2. Log in with the admin credentials from Step 3
3. Create a model, upload a file
4. Upload a file **larger than 2 GB** — this catches:
   - BigInteger serialization (PostgreSQL `BIGINT`)
   - Memory pressure during streaming upload
   - Temp-dir permissions on `~/llm-storage/.tmp`

## Step 9: Adding large models via File Manager

For large model files (e.g., 1.7 GB GGUF files), uploading through the browser is slow and unreliable. Use the server-side import feature instead:

1. **Set `IMPORT_DIR`** in the Plesk Node.js tile's environment variables:
   ```
   IMPORT_DIR=llm.cucorn.com/llm_files
   ```
   The resolved absolute path is shown in the app's startup log and in the import result.

2. **Upload files via Plesk File Manager** to the `llm_files` directory in your domain's root (`llm.cucorn.com/llm_files/`).

3. **Click "Import from Server"** in the app's model list (admin-only button).

4. The app scans `IMPORT_DIR` for files with allowed extensions (`.gguf`, `.pt`, `.pth`, `.safetensors`, `.onnx`, `.tar`, `.zip`, `.gz`, `.bin`), skipping:
   - Hidden files (starting with `.`)
   - Non-regular files (directories, symlinks)
   - Files with unsupported extensions
   - Files modified in the last 60 seconds (partially uploaded)
   - Files already registered (matched by `original_filename` and `size_bytes`)

5. For each eligible file:
   - Creates a model row with `name` = filename without extension
   - Moves the file from `IMPORT_DIR` to the app's storage layout (`~/llm-storage/<user>/<model-id>/<filename>`)
   - The move is a fast `fs.rename` (same filesystem), with a copy-then-delete fallback if on different filesystems

**Note:** Imported files are **moved out** of `llm_files` into app storage. They are no longer in the import directory after successful import.

## Step 10: Update routine

In Plesk UI: **Git → Pull updates** (pulls latest code into `/llm-app`).

Then in **Domains → llm.cucorn.com → Node.js**:

1. Click **NPM install**
2. Click **Run script** (runs `build` — rebuilds the React frontend)
3. Click **Restart**

## Troubleshooting

### App won't start — check JWT secret

The app refuses to start if `JWT_SECRET_KEY` is under 32 characters (when `DEBUG=false`). Check the Plesk Node.js logs for the error:

```
FATAL: JWT_SECRET_KEY is too short (...)
```

### 413 Payload Too Large

Plesk nginx body size limit. Verify:
1. Additional Nginx Directives has `client_max_body_size 0;`
2. No competing `client_max_body_size` in Plesk's default config

### 502 Bad Gateway

Passenger can't reach the Node.js app. Check in a browser:
- `https://llm.cucorn.com/health`

In Plesk UI: **Domains → llm.cucorn.com → Node.js → Restart**.

### Database connection errors

If the app won't start with a database error, verify the password in Plesk's environment variables matches the database password set in Step 2.

### Tables not created / admin not bootstrapped

The app creates tables and the admin user on first startup. Check logs:
```
Admin user '...' created successfully
Tables verified successfully
```

If missing, check that `ADMIN_USERNAME` and `ADMIN_PASSWORD` are set in Plesk environment variables and that `ALLOW_REGISTRATION=false`.

## Notes

### Subscription disk quota

The Node.js option stores files in `~/llm-storage` (or `MODEL_STORAGE_PATH`). This counts against your Plesk subscription disk quota.

### Excluding from Plesk backups

Plesk's built-in backups may include `~/llm-storage`. If you use Plesk backups, exclude the storage directory:

In Plesk UI: **Tools & Settings → Backup Manager → Storage Settings** or add an exclusion to your backup plan for `~/llm-storage`.

For the Docker Compose deployment option, see [DEPLOY_PLESK.md](./DEPLOY_PLESK.md).
