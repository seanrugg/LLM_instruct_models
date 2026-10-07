# CLAUDE.md

Persistent project memory for this repo. **Read this before making any changes.**

## 1. Project Overview

A **self-hosted LLM weight registry with immutable file-derived metadata.**

- A web app for hosting and managing LLM instruct models (GGUF, safetensors, ONNX, PyTorch, etc.).
- Users upload model files; the app extracts metadata **from the file itself** (architecture, quantization, parameter count, context length, chat template, license, etc.).
- Once extracted, those file-derived columns are **locked** by a PostgreSQL trigger and **cannot be altered afterward**.
- Deploys on **Plesk** (Phusion Passenger + Node.js) for production; **Docker Compose** for local development.

## 2. Tech Stack

| Layer | Choice |
|-------|--------|
| Production backend | Node.js (Phusion Passenger / Plesk) — `plesk-node/server.js` |
| Dev backend | Python / FastAPI — `backend/` (same API contract as production) |
| Frontend | React + Vite (ESM) |
| Database | **PostgreSQL 16** — local dev port: **`55432`** (not the default 5432) |
| SQL access | `pg` (raw SQL, no ORM) |
| Auth | JWT (HS256), 7-day expiry |
| File storage | Local filesystem (`/models/` on Plesk) |

> Always point local tooling and tests at PostgreSQL on **port 55432**.

## 3. Strict Coding Rules

These are non-negotiable and apply to every task in this repo.

- **No Patching** — Always **rewrite the whole file**. Never provide or apply partial snippets, in-place diff fragments, or "change line X to Y" instructions. When a file must change, produce the **complete new file contents**.
- **Verification** — After any change, **show the diff and the test output**, then **wait for explicit approval** before committing or pushing. Do **not** commit or push on your own initiative.
- **Environment** — Use the project virtualenv at **`.venv-test/`** for **all** Python tasks. **Never** install packages globally.
- **Shell State** — Acknowledge that **each Bash call is a fresh shell**. Do **not** assume environment variables, `cd` state, an activated venv, or shell functions persist across Bash calls. Re-source and re-activate everything (including the venv) within each command.

## 4. The Production Gate

Production approval is **blocked** until **all** of the following pass. Treat this as the release checklist:

- [ ] **Parser tests pass** — `scripts/test-metadata.mjs` reports **100% pass** for **both GGUF and safetensors**.
- [ ] **Real-world file verification** — Metadata extraction verified against at least one **real-world** model file (not only the generated fixtures).
- [ ] **DB idempotency** — Re-uploading the same file (matched by SHA-256) does not duplicate data; state is stable across repeated runs and across server restarts.
- [ ] **Locked-field enforcement** — Attempting to change an immutable (file-derived) field returns **400** on update, and a duplicate/conflicting upload (same SHA-256) returns **409**; direct SQL mutation of locked columns is rejected by the trigger.
- [ ] **`vite build` succeeds** — A clean production `vite build` completes with no errors.

> Do **not** deploy to Plesk until every box above is checked.

---

## Key File Locations

| File | Purpose |
|------|---------|
| `plesk-node/server.js` | Production Node.js backend |
| `backend/main.py` | Dev FastAPI backend |
| `frontend/src/lib/modelHeader.mjs` | Pure ESM model header parser (runs in browser **and** server) |
| `frontend/src/components/UploadModel.jsx` | Upload flow component |
| `frontend/src/components/ModelDetail.jsx` | Model detail page |
| `frontend/src/api/client.js` | API client with auth interceptor |
| `scripts/test-metadata.mjs` | Integration test script (GGUF + safetensors) |
| `scripts/generate_test_fixtures.py` | Python fixture generator |
| `.venv-test/` | Python venv for gguf/safetensors packages |
| `project_state.md` | Detailed project state / handoff notes |

## Current Status (as of 2026-10-01)

- **Critical open bug:** the **GGUF parser fails to extract KV pairs** (error: *"Offset is outside the bounds of the DataView"*); the **safetensors parser passes** (4/4). Suspected cause: a wrong per-type byte-size skip table for array elements in `frontend/src/lib/modelHeader.mjs` (e.g. `FLOAT32` should be 4 bytes, `BOOL`/`UINT8`/`INT8` should be 1 byte), and possibly the string-length / array-count prefix width.
- The **immutability trigger** and DB schema are in place; full integration + real-file verification is still outstanding.
- Nothing has cleared **The Production Gate** yet.
