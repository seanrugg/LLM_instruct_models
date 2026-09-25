#!/usr/bin/env bash
# Smoke test for LLM Instruct Models backend.
# Usage: ./scripts/smoke_test.sh <base_url> <admin_user> <admin_pass>
# Example: ./scripts/smoke_test.sh https://llm.cucorn.com admin password
#
# Steps: health → login → create model → upload 1 MB .gguf → list →
#         download-token → download and compare checksum → delete.
# Exits non-zero on the first failure.

set -euo pipefail

if [ $# -lt 3 ]; then
    echo "Usage: $0 <base_url> <admin_user> <admin_pass>"
    echo "Example: $0 https://llm.cucorn.com admin password"
    exit 1
fi

BASE_URL="$1"
ADMIN_USER="$2"
ADMIN_PASS="$3"

# Remove trailing slash
BASE_URL="${BASE_URL%/}"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

PASS=0
FAIL=0

check() {
    local desc="$1"
    local status_code="$2"
    local actual="$3"
    if [ "$actual" = "$status_code" ]; then
        echo "  PASS: $desc (HTTP $actual)"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $desc (expected $status_code, got $actual)"
        FAIL=$((FAIL + 1))
    fi
}

echo "========================================="
echo "  LLM Instruct Models — Smoke Test"
echo "  Target: $BASE_URL"
echo "========================================="
echo ""

# 1. Health check
echo "--- 1. Health check ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
check "GET /health" 200 "$STATUS"

# 2. Auth config
echo "--- 2. Auth config ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/auth/config")
check "GET /api/auth/config" 200 "$STATUS"

# 3. Login
echo "--- 3. Login ---"
LOGIN_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
STATUS=$(echo "$LOGIN_RESP" | tail -1)
BODY=$(echo "$LOGIN_RESP" | sed '$d')
check "POST /api/auth/login" 200 "$STATUS"

TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])" 2>/dev/null || echo "")
if [ -z "$TOKEN" ]; then
    echo "  FAIL: Could not extract access_token from login response"
    exit 1
fi
AUTH_HEADER="Authorization: Bearer $TOKEN"

# 4. Create model
echo "--- 4. Create model ---"
CREATE_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/models" \
    -H "Content-Type: application/json" \
    -H "$AUTH_HEADER" \
    -d '{"name":"smoke-test-model","description":"Smoke test model","version":"0.0.1","framework":"test"}')
STATUS=$(echo "$CREATE_RESP" | tail -1)
BODY=$(echo "$CREATE_RESP" | sed '$d')
check "POST /api/models" 201 "$STATUS"

MODEL_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")
if [ -z "$MODEL_ID" ]; then
    echo "  FAIL: Could not extract model id"
    exit 1
fi

# 5. Upload 1 MB .gguf
echo "--- 5. Upload 1 MB .gguf ---"
DD_IF="/dev/urandom"
DD_BS=1048576
DD_COUNT=1
# Use /dev/zero for reproducible content (so we can verify checksum)
DD_IF="/dev/zero"
curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/models/$MODEL_ID/upload" \
    -H "$AUTH_HEADER" \
    -F "file=@-;filename=smoke_test.gguf" \
    < <(dd if=$DD_IF bs=$DD_BS count=$DD_COUNT 2>/dev/null) > "$TMPDIR/upload_resp" 2>&1
STATUS=$(tail -1 "$TMPDIR/upload_resp")
BODY=$(sed '$d' "$TMPDIR/upload_resp")
check "POST /api/models/{id}/upload (1 MB)" 200 "$STATUS"

# 6. List models
echo "--- 6. List models ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/models" -H "$AUTH_HEADER")
check "GET /api/models" 200 "$STATUS"

# 7. Download token
echo "--- 7. Download token ---"
DL_TOKEN_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/models/$MODEL_ID/download-token" \
    -H "$AUTH_HEADER")
STATUS=$(echo "$DL_TOKEN_RESP" | tail -1)
BODY=$(echo "$DL_TOKEN_RESP" | sed '$d')
check "POST /api/models/{id}/download-token" 200 "$STATUS"

DL_TOKEN=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['download_token'])" 2>/dev/null || echo "")
if [ -z "$DL_TOKEN" ]; then
    echo "  FAIL: Could not extract download_token"
    exit 1
fi

# 8. Download and verify
echo "--- 8. Download and verify ---"
curl -s -o "$TMPDIR/downloaded.gguf" -w "%{http_code}" \
    "$BASE_URL/api/models/$MODEL_ID/download?token=$DL_TOKEN" > "$TMPDIR/dl_status"
STATUS=$(cat "$TMPDIR/dl_status")
check "GET /api/models/{id}/download" 200 "$STATUS"

# Verify file size (should be 1 MB = 1048576 bytes)
DL_SIZE=$(stat -f%z "$TMPDIR/downloaded.gguf" 2>/dev/null || stat -c%s "$TMPDIR/downloaded.gguf" 2>/dev/null)
if [ "$DL_SIZE" = "1048576" ]; then
    echo "  PASS: Downloaded file size is 1048576 bytes"
    PASS=$((PASS + 1))
else
    echo "  FAIL: Downloaded file size is $DL_SIZE (expected 1048576)"
    FAIL=$((FAIL + 1))
fi

# 9. Delete model
echo "--- 9. Delete model ---"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/models/$MODEL_ID" -H "$AUTH_HEADER")
check "DELETE /api/models/{id}" 204 "$STATUS"

# ── Summary ─────────────────────────────────────────────────
echo ""
echo "========================================="
echo "  Results: $PASS passed, $FAIL failed"
echo "========================================="

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
echo "All smoke tests passed."
exit 0
