#!/usr/bin/env bash
# scripts/cloudflare-setup.sh
#
# One-time Cloudflare infrastructure setup for parchment.
# Run manually: bash scripts/cloudflare-setup.sh
# Requires: wrangler authenticated via `wrangler login`
# Safe to re-run: existing resources are detected and skipped.

set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RESET='\033[0m'

echo -e "${BOLD}parchment — Cloudflare setup${RESET}"
echo "-------------------------------"

# ── Verify wrangler is authenticated ─────────────────────────────────────────
echo "Checking wrangler authentication..."
if ! wrangler whoami &>/dev/null; then
  echo "ERROR: wrangler is not authenticated. Run: wrangler login"
  exit 1
fi
echo -e "${GREEN}✓ wrangler authenticated${RESET}"

# ── R2 Buckets ────────────────────────────────────────────────────────────────
create_r2_bucket() {
  local BUCKET_NAME="$1"
  if wrangler r2 bucket list 2>/dev/null | grep -q "^${BUCKET_NAME}"; then
    echo -e "${YELLOW}⚠ R2 bucket '${BUCKET_NAME}' already exists — skipping${RESET}"
  else
    echo "Creating R2 bucket: ${BUCKET_NAME}..."
    wrangler r2 bucket create "${BUCKET_NAME}"
    echo -e "${GREEN}✓ Created R2 bucket: ${BUCKET_NAME}${RESET}"
  fi
}

create_r2_bucket "parchment-mtw"
create_r2_bucket "parchment-bbpp"

# ── Verification ──────────────────────────────────────────────────────────────
echo ""
echo "Verifying R2 buckets exist..."
wrangler r2 bucket list | grep "parchment-" || {
  echo "ERROR: R2 buckets not found after creation. Check wrangler output above."
  exit 1
}

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}Setup complete.${RESET}"
echo ""
echo "Next steps:"
echo "  1. npm run types          # generate worker-configuration.d.ts"
echo "  2. npm run dev            # test locally"
echo "  3. npm run deploy:mtw     # deploy MTW environment"
echo "  4. npm run deploy:bbpp    # deploy BBPP environment"
