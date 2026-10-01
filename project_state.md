# Project State: LLM Instruct Models

## Overview

A web application for hosting and managing LLM instruct models (GGUF, safetensors, ONNX, PyTorch, etc.). Users can upload model files, view metadata, and manage model listings. The app deploys on Plesk (Phusion Passenger + Node.js) without Docker for the production runtime, with Docker Compose for development.

## Architecture

### Tech Stack
- **Frontend**: React + Vite (ESM), deployed via Plesk Node build
- **Backend (production)**: Node.js (Phusion Passenger) at `plesk-node/server.js`
- **Backend (dev)**: Python/FastAPI at `backend/`
- **Database**: PostgreSQL 16
- **ORM**: `pg` (raw SQL, no ORM)
- **Auth**: JWT (HS256), 7-day expiry
- **File storage**: Local filesystem (`/models/` on Plesk)

### Key Architectural Decisions

1. **Dual backend**: Python/FastAPI for dev, Node.js for Plesk production. Same API contract.
2. **Pure ESM parser**: `frontend/src/lib/modelHeader.mjs` — runs in browser AND server. No native deps.
3. **Immutable file-derived metadata**: Columns extracted from the file itself (architecture, quantization, parameter count) are locked after first extraction via PostgreSQL trigger.
4. **SHA-256 streaming**: Computed during upload via Node.js `crypto.createHash('sha256')` with stream updates.
5. **Dynamic import for ESM on Plesk**: `await import('../frontend/src/lib/modelHeader.mjs')` from CommonJS `server.js`. Resolves correctly because app root is `/llm-app/plesk-node`.
6. **Dollar-quoting for trigger SQL**: `CREATE FUNCTION ... AS $ ... $` to avoid pg driver `$1`, `$2` parameter placeholder conflicts.
7. **Format detection**: Magic bytes (GGUF: `GGUF`, safetensors: 8-byte LE uint64 + JSON `{`/`[`) + extension fallback.

## Completed Work

### Batch 1-10 (Core App)
- [x] Database schema (models, uploads, versions tables)
- [x] Auth (register, login, JWT)
- [x] Model CRUD (create, update, delete, list, get)
- [x] File upload (streaming, SHA-256, format detection)
- [x] Model detail page with file metadata
- [x] Plesk deployment (DEPLOY_PLESK.md, DEPLOY_PLESK_NODE.md)
- [x] Smoke test script
- [x] Documentation (README, SETUP, HANDOFF, DEPLOY guides)

### Batch 11 (File-Derived Immutable Metadata)
- [x] JWT expiresIn fix (string with 'm' suffix)
- [x] 401 interceptor fix for upload flow
- [x] Database schema: immutable columns + trigger
- [x] Pure ESM model header parser (GGUF v2/v3, safetensors)
- [x] Server upload: SHA-256 streaming + metadata extraction
- [x] Create/update allowlist enforcement (reject locked fields)
- [x] Python fixture generator (reference writers: gguf, safetensors)
- [x] Integration test script (test-metadata.mjs)
- [x] Redesigned upload flow (file-first, auto-populate, progress)
- [x] Model detail page: verified-from-file panel

## Pending Bugs

### 1. GGUF Parser KV Extraction Fails (CRITICAL)
**Status**: Identified, not yet fixed.
**Symptom**: Safetensors parser works (4/4 tests pass). GGUF parser detects format correctly but fails to extract any KV pair values — all fields return null with warning "GGUF parse error: Offset is outside the bounds of the DataView".
**Root cause suspected**: The per-type byte-size skip table for array elements uses wrong sizes (default case uses 8 bytes; FLOAT32 should be 4, BOOL should be 1, UINT8/INT8 should be 1, etc.). String lengths and array counts may also be read as uint32 instead of uint64 in GGUF v2/v3.
**Debugging progress**:
- Reference reader (Python gguf package) confirms fixture is valid: 12 KV pairs, 2 tensors, version 3.
- Manual byte-level parse confirms file structure is correct.
- Parser step-by-step trace shows it reads magic, version (3), tensor_count (2), kv_count (12) correctly, but fails on first KV pair key read — the key content is garbled (`general.architec` with garbage bytes appended), suggesting offset calculation is wrong.
- The `value_type` read returns 1701999988 (0x65544C4C = "LLTe" in ASCII), confirming the offset is completely wrong after reading the key.

**Fix needed in `frontend/src/lib/modelHeader.mjs`**:
- Review array element skip sizes: UINT8=1, INT8=1, UINT16=2, INT16=2, UINT32=4, INT32=4, FLOAT32=4, BOOL=1, UINT64=8, INT64=8, FLOAT64=8; STRING is variable (4-byte LE length prefix + bytes).
- Verify string length prefix is read as uint32 (correct for v2/v3 GGUF).
- Add debug logging to trace offset after each KV pair read.

### 2. Gitignore Missing .fixtures-debug/
**Status**: Fixed in latest commit (added to .gitignore).

## Immediate Next Steps

### Priority 1: Fix GGUF Parser
1. Compare parser offset trace vs reference reader byte layout
2. Fix per-type byte-size skip table for array elements
3. Verify string length read is correct (uint32 LE)
4. Re-run `scripts/test-metadata.mjs` — expect all GGUF assertions to pass
5. If parser is too broken, consider rewriting the KV extraction loop with explicit offset tracking

### Priority 2: Immutability Tests
Once GGUF parser is fixed:
1. Run full `scripts/test-metadata.mjs` — expect 100% pass
2. Test immutability trigger:
   - Upload a GGUF file → verify metadata_extracted_at is set
   - PUT update a locked field (architecture) → expect 400
   - Second upload of same file (by SHA-256) → expect 409
   - Direct SQL UPDATE on locked columns → expect trigger error
   - Server restart → verify metadata persists

### Priority 3: Mark Tasks Complete
- [ ] Mark task #13 (Redesign upload flow) complete
- [ ] Mark task #15 (Update model detail page) complete
- [ ] Mark task #17 (test-metadata.mjs) complete (after GGUF fix)
- [ ] Mark task #8 (verification) complete (after all tests pass)

### Priority 4: Deployment
- [ ] Deploy to Plesk production
- [ ] Run smoke test against production
- [ ] Final handoff documentation update

## Key File Locations

| File | Purpose |
|------|---------|
| `plesk-node/server.js` | Production Node.js backend |
| `backend/main.py` | Dev FastAPI backend |
| `frontend/src/lib/modelHeader.mjs` | Pure ESM model header parser |
| `frontend/src/components/UploadModel.jsx` | Upload flow component |
| `frontend/src/components/ModelDetail.jsx` | Model detail page |
| `frontend/src/api/client.js` | API client with auth interceptor |
| `scripts/test-metadata.mjs` | Integration test script |
| `scripts/generate_test_fixtures.py` | Python fixture generator |
| `.venv-test/` | Python venv for gguf/safetensors packages |
| `docs/DEPLOY_PLESK.md` | Plesk deployment guide |
| `docs/DEPLOY_PLESK_NODE.md` | Plesk Node.js deployment guide |

## Debugging Reference

### GGUF Format Spec (v2/v3)
- Magic: `GGUF` (4 bytes)
- Version: uint32 LE (2 or 3)
- tensor_count: uint64 LE
- kv_count: uint64 LE
- KV pairs: key_len (uint32) + key (bytes) + value_type (uint32) + value
- Value types: UINT8(0), INT8(1), UINT16(2), INT16(3), UINT32(4), INT32(5), FLOAT32(6), BOOL(7), STRING(8), ARRAY(9), UINT64(10), INT64(11), FLOAT64(12)
- STRING value: uint32 LE length + UTF-8 bytes
- ARRAY value: element_type (uint32) + count (uint64) + elements

### Safetensors Format
- Header length: uint64 LE (8 bytes)
- Header: JSON with tensor names as keys, `__metadata__` for metadata
- Tensor data: raw bytes after header (aligned to 8 bytes)

### PostgreSQL Trigger Pattern
```sql
CREATE OR REPLACE FUNCTION models_lock_file_metadata() RETURNS trigger AS $
BEGIN
  IF OLD.metadata_extracted_at IS NOT NULL AND (
     NEW.file_format IS DISTINCT FROM OLD.file_format OR
     NEW.architecture IS DISTINCT FROM OLD.architecture OR
     NEW.parameter_count IS DISTINCT FROM OLD.parameter_count OR
     NEW.quantization IS DISTINCT FROM OLD.quantization OR
     NEW.context_length IS DISTINCT FROM OLD.context_length OR
     NEW.chat_template IS DISTINCT FROM OLD.chat_template OR
     NEW.license IS DISTINCT FROM OLD.license OR
     NEW.source_model_name IS DISTINCT FROM OLD.source_model_name
  ) THEN
    RAISE EXCEPTION 'file-derived metadata is immutable';
  END IF;
  RETURN NEW;
END $ LANGUAGE plpgsql;
```
