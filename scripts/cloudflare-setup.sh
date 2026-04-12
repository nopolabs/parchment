#!/usr/bin/env bash
# scripts/cloudflare-setup.sh
#
# One-time Cloudflare infrastructure setup for parchment.
# Run manually: bash scripts/cloudflare-setup.sh
# Requires: $WRANGLER authenticated via `$WRANGLER login`
# Safe to re-run: existing resources are detected and skipped.

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RESET='\033[0m'

echo -e "${BOLD}parchment — Cloudflare setup${RESET}"
echo "-------------------------------"

# ── Verify $WRANGLER is authenticated ─────────────────────────────────────────
WRANGLER="npx wrangler"

echo "Checking $WRANGLER authentication..."
if ! $WRANGLER whoami &>/dev/null; then
  echo "ERROR: $WRANGLER is not authenticated. Run: npx $WRANGLER login"
  exit 1
fi
echo -e "${GREEN}✓ $WRANGLER authenticated${RESET}"

# ── R2 Buckets ────────────────────────────────────────────────────────────────
create_r2_bucket() {
  local BUCKET_NAME="$1"
  if $WRANGLER r2 bucket list 2>/dev/null | grep -q "name:.*${BUCKET_NAME}"; then
    echo -e "${YELLOW}⚠ R2 bucket '${BUCKET_NAME}' already exists — skipping${RESET}"
  else
    echo "Creating R2 bucket: ${BUCKET_NAME}..."
    $WRANGLER r2 bucket create "${BUCKET_NAME}"
    echo -e "${GREEN}✓ Created R2 bucket: ${BUCKET_NAME}${RESET}"
  fi
}

create_r2_bucket "parchment-mtw"
create_r2_bucket "parchment-bbpp"

# ── D1 Databases ──────────────────────────────────────────────────────────────
ensure_d1_database() {
  local DB_NAME="$1"
  if $WRANGLER d1 list 2>/dev/null | grep -q "${DB_NAME}"; then
    echo -e "${YELLOW}⚠ D1 database '${DB_NAME}' already exists — skipping creation${RESET}"
  else
    echo "Creating D1 database: ${DB_NAME}..."
    $WRANGLER d1 create "${DB_NAME}"
    echo -e "${GREEN}✓ Created D1 database: ${DB_NAME}${RESET}"
  fi
  # Extract UUID from table output: │ <uuid> │ <name> │ ...
  local DB_ID
  DB_ID=$($WRANGLER d1 list 2>/dev/null | grep "${DB_NAME}" | awk -F'│' '{gsub(/ /,"",$2); print $2}')
  echo "${DB_ID}"
}

MTW_DB_ID=$(ensure_d1_database "parchment-log-mtw")
BBPP_DB_ID=$(ensure_d1_database "parchment-log-bbpp")

# Patch wrangler.toml with real database IDs
sed -i '' "s/REPLACE_WITH_MTW_DB_ID/${MTW_DB_ID}/" wrangler.toml  2>/dev/null || true
sed -i '' "s/REPLACE_WITH_BBPP_DB_ID/${BBPP_DB_ID}/" wrangler.toml 2>/dev/null || true
echo -e "${GREEN}✓ wrangler.toml updated with D1 database IDs${RESET}"

# ── Apply D1 migrations ───────────────────────────────────────────────────────
echo ""
echo "Applying D1 migrations..."
$WRANGLER d1 execute parchment-log-mtw  --remote --file migrations/0001_create_certificates.sql
$WRANGLER d1 execute parchment-log-bbpp --remote --file migrations/0001_create_certificates.sql
echo -e "${GREEN}✓ Migrations applied${RESET}"

# ── Queues ────────────────────────────────────────────────────────────────────
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

create_queue "parchment-queue-mtw"
create_queue "parchment-queue-bbpp"

# ── Verification ──────────────────────────────────────────────────────────────
echo ""
echo "Verifying R2 buckets exist..."
$WRANGLER r2 bucket list | grep "name:.*parchment-" || {
  echo "ERROR: R2 buckets not found after creation. Check $WRANGLER output above."
  exit 1
}

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Setup complete.${RESET}"
echo ""
echo "Next steps:"
echo "  1. Update wrangler.toml with D1 database IDs (see above)"
echo "  2. npm run types          # regenerate worker-configuration.d.ts"
echo "  3. npm run dev            # test locally"
echo "  4. npm run deploy:mtw     # deploy MTW environment"
echo "  5. npm run deploy:bbpp    # deploy BBPP environment"
