# Bug: Upload fails with "Session expired" immediately after login

**Site:** https://llm.cucorn.com (Plesk Node.js deployment, `plesk-node/`)
**Build:** commit `f77a1cd` (previously `fb5d7b9`)
**Found:** 2026-10-08
**Severity:** High. Uploads are blocked; the rest of the UI loads.

## Symptoms

1. Log in as `sean-llm-admin`. Login succeeds.
2. Go to Upload and try to upload a file.
3. A toast says "Session expired. Please log in again." and the app returns to `/login`.
4. Logging in again and retrying right away fails the same way.
5. **Reproduced in a second browser with a fresh session**, so this is not a stale or cached token.

## New evidence

- The browser console on `/login` after the failure shows:
  `GET https://llm.cucorn.com/api/users/me → 401`
  An ordinary authenticated call is being rejected, not only the upload request.
- Minor UX issue: the header shows **Browse** and **Upload** links while logged out. Upload should be hidden or protected when there is no session.

## Context

- `f77a1cd` was frontend-only (UI/UX: dark mode, skeletons, toasts). No backend, environment or dependency changes.
- The build (`npm run build`, Vite 5.4.21) succeeded, and the app was restarted from Plesk. `/health` returns healthy.
- Environment (unchanged): `JWT_ALGORITHM=HS256`, `JWT_EXPIRE_MINUTES=60`, `DOWNLOAD_TOKEN_EXPIRE_MINUTES=5`, `MAX_UPLOAD_SIZE_MB=50000`, `CORS_ORIGINS=https://llm.cucorn.com`.
- **Uploads were never confirmed working on `fb5d7b9`.** This may be a latent backend bug rather than a regression from the frontend change.

## Leads, most likely first

1. **Token lifetime unit bug in `plesk-node/server.js`.** The jsonwebtoken library's `expiresIn` option takes **seconds** when given a number; a bare numeric string means milliseconds. If the code passes `JWT_EXPIRE_MINUTES` (60) directly:
   - session tokens expire in 60 seconds, not 60 minutes
   - download tokens expire in 5 seconds

   This fits "expires almost immediately" and would reproduce on every browser. The fix is `expiresIn: JWT_EXPIRE_MINUTES * 60` (or `` `${n}m` ``).
2. **Token storage key mismatch after the refactor.** Login writes the token under one key, and the API layer reads another, so no `Authorization` header is sent and the server returns 401.
3. **The `/api/users/me` handler or auth middleware rejects valid tokens.** For example, it looks the user up by the wrong claim (`sub` as id vs username) and returns 401 "user not found".
4. **The error handler maps every failure to "Session expired".** A 400, 413, 500 or network error would also show as session expiry and hide the real error. This should be fixed regardless of the root cause.
5. **The proxy strips `Authorization`.** This is less likely, since login and page loads work, but confirm the header reaches `/api/users/me`.

## Browser checks (about 2 minutes, in DevTools right after logging in)

1. In the Console, run `Object.keys(localStorage)` and note the key names.
2. Decode the token timestamps **locally**. Don't paste the token into any website.
   ```js
   const t = localStorage.getItem('<token key from step 1>');
   const p = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
   console.log(p.exp - p.iat, p);
   ```
   `p.exp - p.iat` should be **3600**. If it is **60**, lead 1 is confirmed.
3. In the Network tab, find the `/api/users/me` request. Check whether `Authorization: Bearer …` is present and what the response body says.
4. In the Network tab, check the upload sequence:
   - `POST /api/models` (create the entry): status
   - `POST /api/models/:id/upload`: status and response body

   Delete any empty model entries left behind by failed attempts.

## Tasks for Claude Code

Read the code first and make **no changes** until the cause is confirmed.

1. In `plesk-node/server.js`, show every `jwt.sign` call and the `expiresIn` value for session and download tokens, including the units.
2. Show the `/api/users/me` handler and the auth middleware: how the token is read, which claim identifies the user, and every path that returns 401.
3. Diff `fb5d7b9..f77a1cd` for `frontend/src/api/`, the auth context and the upload component. Report:
   - the storage key written at login vs the key read for requests
   - how the `Authorization` header is attached to the upload request
   - any manual `Content-Type: multipart/form-data` header, which drops the boundary
4. Show the handler that produces "Session expired" and which status codes or errors trigger it.

Report the root cause with evidence and propose the smallest fix. The fix should include:
- treating only a 401 as session expiry, and showing other errors as they are
- hiding or protecting the Upload link when logged out

Wait for go-ahead before changing anything.

---

# Issue 2: Files placed on the server don't appear in the UI

**Severity:** Medium (feature gap, not a crash).

## What happens

Two GGUF files were uploaded through Plesk File Manager into
`llm.cucorn.com/llm_files/` (domain home directory):

- `ember-1A-q8_0.gguf` (1.7 GB)
- `ember-1B-q8_0.gguf` (1.7 GB)

Neither appears in the app's model list.

## Why

The app lists models from the **PostgreSQL `models` table**, not from the
filesystem. A file only "exists" to the app once a database row points to it,
and only the upload endpoint creates that row. The app also stores files under
`MODEL_STORAGE_PATH` (default `~/llm-storage/<user>/<model>/`), not
`llm_files/`. So files copied in any other way are invisible.

## Expected behavior

Any supported model file added to the server should be visible in the UI.

## Requested feature: server-side import

Uploading multi-GB files through the browser is the slowest and least reliable
path, so the app should also support files placed on the server directly.

1. **New env var `IMPORT_DIR`**, the folder to scan. Document the value for
   this server, which should be the domain's `llm_files` folder (resolve the
   absolute path from the home directory; don't hardcode it). If it's unset,
   the feature is off.
2. **Admin-only `POST /api/admin/import`**:
   - Scans `IMPORT_DIR` for files with an allowed extension.
   - Skips files already registered.
   - For each new file: creates a model row owned by the calling admin, with
     `name` = filename without extension, `original_filename`, `size_bytes`
     (BIGINT), and `framework` inferred from the extension
     (`.gguf` → `gguf`).
   - Moves the file into the normal storage layout with `fs.rename`, falling
     back to copy-then-delete if `IMPORT_DIR` is on a different filesystem.
     Never delete the source until the copy is verified by size.
   - Returns a summary: imported, skipped, and failed, with reasons.
   - Ignores partially written files: skip files modified in the last 60
     seconds.
3. **UI:** an admin-only **"Import from server folder"** button on the model
   list that calls the endpoint and shows the summary in a toast.
4. **Docs:** add an "Adding large models via File Manager" section to
   `DEPLOY_PLESK_NODE.md`: upload to `llm_files` → click Import in the app.
5. **Startup scan: not required.** Keep import explicit so files are never
   registered while still uploading.

## Acceptance

- After the fix and redeploy, clicking Import registers both ember files.
- Both show in the model list with the correct name and size (1.7 GB).
- Both download successfully and byte-for-byte match the source.
- Clicking Import again reports both as skipped, with no duplicates.

Do issue 1 (session/auth) first. Import depends on a working admin login.

---

**Redeploy after the fix** (`DEPLOY_PLESK_NODE.md` update routine):
1. Git → Pull updates / Deploy.
2. If `server.js` changed, click **Restart App**. NPM install isn't needed unless dependencies change.
3. If the frontend changed, run **Run script → build**, then Restart App.
