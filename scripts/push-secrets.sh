#!/usr/bin/env bash
# Push worker secrets from the untracked .env to Cloudflare.
#
# .env is the source of truth (back it up in a password manager);
# Cloudflare's encrypted variables are a write-only mirror. Worker secrets
# take effect immediately — pushing a rolled ISSUE_API_KEY breaks any client
# still holding the old value until that client is updated and redeployed.
#
# Run manually: bash scripts/push-secrets.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env ]; then
  echo "Error: .env not found. Copy .env.example to .env and fill in real values." >&2
  exit 1
fi
set -a
# shellcheck source=/dev/null
source .env
set +a

# Add one entry here (and in src/secrets-env.d.ts, src/config.ts, and
# .env.example) whenever a new site's ISSUE_API_KEY is added.
SECRETS=(RESEND_API_KEY MTW_ISSUE_API_KEY BBPP_ISSUE_API_KEY)

for NAME in "${SECRETS[@]}"; do
  if [ -z "${!NAME:-}" ]; then
    echo "Error: ${NAME} is not set in .env" >&2
    exit 1
  fi
done

for NAME in "${SECRETS[@]}"; do
  echo "Pushing ${NAME}..."
  printf '%s' "${!NAME}" | npx wrangler secret put "${NAME}"
done

echo "✓ All worker secrets pushed (effective immediately)."
