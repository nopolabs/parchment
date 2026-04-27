#!/usr/bin/env bash
# scripts/cloudflare-setup.sh
#
# One-time Cloudflare infrastructure setup for parchment (shared backend).
# Run manually: bash scripts/cloudflare-setup.sh
# Requires: wrangler authenticated via `npx wrangler login`
# Safe to re-run: existing resources are detected and skipped.

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RESET='\033[0m'

echo -e "${BOLD}parchment — Cloudflare setup (shared backend)${RESET}"
echo "----------------------------------------------"

WRANGLER="npx wrangler"

echo "Checking wrangler authentication..."
if ! $WRANGLER whoami &>/dev/null; then
  echo "ERROR: wrangler is not authenticated. Run: npx wrangler login"
  exit 1
fi
echo -e "${GREEN}✓ wrangler authenticated${RESET}"

# ── R2 Bucket ─────────────────────────────────────────────────────────────────
create_r2_bucket() {
  local BUCKET_NAME="$1"
  if $WRANGLER r2 bucket list 2>/dev/null | grep -qE "name:[[:space:]]*${BUCKET_NAME}[[:space:]]*$"; then
    echo -e "${YELLOW}⚠ R2 bucket '${BUCKET_NAME}' already exists — skipping${RESET}"
  else
    echo "Creating R2 bucket: ${BUCKET_NAME}..."
    $WRANGLER r2 bucket create "${BUCKET_NAME}"
    echo -e "${GREEN}✓ Created R2 bucket: ${BUCKET_NAME}${RESET}"
  fi
}

create_r2_bucket "parchment"

# ── D1 Database ───────────────────────────────────────────────────────────────
ensure_d1_database() {
  local DB_NAME="$1"
  if $WRANGLER d1 list 2>/dev/null | grep -q "${DB_NAME}"; then
    echo -e "${YELLOW}⚠ D1 database '${DB_NAME}' already exists — skipping creation${RESET}" >&2
  else
    echo "Creating D1 database: ${DB_NAME}..." >&2
    $WRANGLER d1 create "${DB_NAME}" >&2
    echo -e "${GREEN}✓ Created D1 database: ${DB_NAME}${RESET}" >&2
  fi
  local DB_ID
  DB_ID=$($WRANGLER d1 list 2>/dev/null | grep "${DB_NAME}" | awk -F'│' '{gsub(/ /,"",$2); print $2}')
  if [[ -z "${DB_ID}" ]]; then
    echo "ERROR: failed to extract D1 database ID for '${DB_NAME}'. Cannot patch wrangler.toml." >&2
    exit 1
  fi
  echo "${DB_ID}"
}

DB_ID=$(ensure_d1_database "parchment-log")

# Patch wrangler.toml with real database ID (skip if already patched on re-run)
if grep -q "REPLACE_WITH_DB_ID" wrangler.toml 2>/dev/null; then
  sed -i '' "s/REPLACE_WITH_DB_ID/${DB_ID}/" wrangler.toml
  echo -e "${GREEN}✓ wrangler.toml patched with D1 database ID: ${DB_ID}${RESET}"
else
  echo -e "${YELLOW}⚠ wrangler.toml already contains a database ID — skipping patch${RESET}"
fi

# ── Apply D1 migration ────────────────────────────────────────────────────────
echo ""
echo "Applying D1 migration..."
$WRANGLER d1 execute parchment-log --remote --file migrations/0001_create_certificates.sql
echo -e "${GREEN}✓ Migration applied${RESET}"

# ── Queue ─────────────────────────────────────────────────────────────────────
create_queue() {
  local QUEUE_NAME="$1"
  if $WRANGLER queues list 2>/dev/null | grep -q "${QUEUE_NAME}"; then
    echo -e "${YELLOW}⚠ Queue '${QUEUE_NAME}' already exists — skipping${RESET}"
  else
    echo "Creating Queue: ${QUEUE_NAME}..."
    $WRANGLER queues create "${QUEUE_NAME}"
    echo -e "${GREEN}✓ Created Queue: ${QUEUE_NAME}${RESET}"
  fi
}

create_queue "parchment-queue"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Setup complete.${RESET}"
echo ""
echo "Next steps:"
echo "  1. npm run types          # regenerate worker-configuration.d.ts"
echo "  2. npm run typecheck      # verify types pass"
echo "  3. Set secrets:"
echo "       npx wrangler secret put RESEND_API_KEY"
echo "       npx wrangler secret put MTW_ISSUE_API_KEY"
echo "       npx wrangler secret put BBPP_ISSUE_API_KEY"
echo "  4. npm run deploy"
echo "  5. Update PARCHMENT_BASE_URL on each Pages site"
