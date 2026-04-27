#!/usr/bin/env bash
# Migrate R2 objects from parchment-mtw and parchment-bbpp into the shared parchment bucket.
# Run once from ~/dev/parchment: bash scripts/migrate-r2.sh
set -euo pipefail

WRANGLER="npx wrangler"
DEST="parchment"
TMPFILE=$(mktemp /tmp/r2-migrate-XXXXXX.png)
trap 'rm -f "$TMPFILE"' EXIT

copy_object() {
  local src_bucket="$1"
  local key="$2"
  echo "  $src_bucket/$key → $DEST/$key"
  $WRANGLER r2 object get "${src_bucket}/${key}" --file="$TMPFILE" --remote 2>/dev/null
  $WRANGLER r2 object put "${DEST}/${key}" --file="$TMPFILE" --content-type="image/png" --remote 2>/dev/null
}

echo "Migrating mtw objects..."
while IFS= read -r key; do
  copy_object "parchment-mtw" "$key"
done < <($WRANGLER d1 execute parchment-log --remote \
  --command="SELECT r2_key FROM certificates WHERE site_id='mtw';" \
  --json 2>/dev/null | python3 -c "
import sys, json
rows = json.load(sys.stdin)[0]['results']
for r in rows: print(r['r2_key'])
")

echo "Migrating bbpp objects..."
while IFS= read -r key; do
  copy_object "parchment-bbpp" "$key"
done < <($WRANGLER d1 execute parchment-log --remote \
  --command="SELECT r2_key FROM certificates WHERE site_id='bbpp';" \
  --json 2>/dev/null | python3 -c "
import sys, json
rows = json.load(sys.stdin)[0]['results']
for r in rows: print(r['r2_key'])
")

echo "Done."
