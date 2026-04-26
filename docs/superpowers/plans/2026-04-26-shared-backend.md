# Shared Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate two isolated Cloudflare deployments (MTW + BBPP) into one shared worker, R2 bucket, D1 database, and queue so that adding a new certificate requires no new infrastructure.

**Architecture:** A single `parchment-worker` reads `X-Site-ID` from incoming request headers (injected by each Pages Function) to determine which site config to load. All site configs ship bundled in the worker. Per-site API keys (`MTW_ISSUE_API_KEY`, `BBPP_ISSUE_API_KEY`) are secrets on the single worker, looked up by a helper keyed on siteId.

**Tech Stack:** Cloudflare Workers (TypeScript strict), Cloudflare Pages Functions, Wrangler 4.x, R2, D1, Queues, Resend.

**Spec:** `docs/superpowers/specs/2026-04-26-shared-backend-design.md`

---

## File Map

| File | Change |
|---|---|
| `~/dev/mtw4/functions/parchment/[[path]].ts` | Add `X-Site-ID: 'mtw'` header to all forwarded requests |
| `~/dev/bbpp/functions/parchment/[[path]].ts` | Add `X-Site-ID: 'bbpp'` header to all forwarded requests |
| `src/config.ts` | `getConfig(siteId)` replaces `getConfig(env)`; add `getIssueApiKey()` |
| `src/secrets-env.d.ts` | **New** — declaration merge extending `Env` with secret fields |
| `src/index.ts` | Read `X-Site-ID` header; use `getIssueApiKey()`; pass `siteId` into `IssueMessage` |
| `src/queue.ts` | Add `siteId` to `IssueMessage`; call `getConfig(siteId)` per message |
| `wrangler.toml` | Collapse two `[env.*]` sections to single top-level bindings |
| `package.json` | Replace `deploy:mtw`/`deploy:bbpp` with single `deploy`; update `dev`, `build`, `types` |
| `scripts/cloudflare-setup.sh` | Replace per-site resource creation with shared resource creation |
| `scripts/migrate-r2.sh` | **New, temporary** — one-time R2 copy script (created and deleted in Task 11) |
| `CLAUDE.md` | Update architecture description and daily commands |

---

## Task 1: Add X-Site-ID header to mtw4 Pages Function

**Files:**
- Modify: `~/dev/mtw4/functions/parchment/[[path]].ts`

- [ ] **Step 1: Edit the Pages Function**

Replace the entire file with:

```typescript
interface Env {
  PARCHMENT_BASE_URL: string;
  PARCHMENT_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}

export async function onRequest(context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}): Promise<Response> {
  const { request, env, params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '');
  const targetUrl = `${env.PARCHMENT_BASE_URL}/parchment/${path}`;
  const isIssue = path === 'issue' && request.method === 'POST';

  if (isIssue) {
    const bodyText = await request.text();
    const formData = new URLSearchParams(bodyText);
    const token = formData.get('cf-turnstile-response') ?? '';

    const verifyRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: request.headers.get('CF-Connecting-IP') ?? '',
        }),
      }
    );
    const result = await verifyRes.json() as { success: boolean };
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${env.PARCHMENT_API_KEY}`,
        'X-Site-ID': 'mtw',
      },
      body: bodyText,
    });
  }

  return fetch(targetUrl, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-Site-ID': 'mtw',
    },
    body: request.body,
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/dev/mtw4
git add functions/parchment/\[\[path\]\].ts
git commit -m "feat: add X-Site-ID header to parchment proxy"
```

---

## Task 2: Add X-Site-ID header to bbpp Pages Function

**Files:**
- Modify: `~/dev/bbpp/functions/parchment/[[path]].ts`

- [ ] **Step 1: Edit the Pages Function**

Replace the entire file with the same content as Task 1 but with `'X-Site-ID': 'bbpp'` in both fetch calls (the issue path and the transparent proxy path):

```typescript
interface Env {
  PARCHMENT_BASE_URL: string;
  PARCHMENT_API_KEY: string;
  TURNSTILE_SECRET_KEY: string;
}

export async function onRequest(context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[]>;
}): Promise<Response> {
  const { request, env, params } = context;
  const path = Array.isArray(params.path) ? params.path.join('/') : (params.path ?? '');
  const targetUrl = `${env.PARCHMENT_BASE_URL}/parchment/${path}`;
  const isIssue = path === 'issue' && request.method === 'POST';

  if (isIssue) {
    const bodyText = await request.text();
    const formData = new URLSearchParams(bodyText);
    const token = formData.get('cf-turnstile-response') ?? '';

    const verifyRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: token,
          remoteip: request.headers.get('CF-Connecting-IP') ?? '',
        }),
      }
    );
    const result = await verifyRes.json() as { success: boolean };
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${env.PARCHMENT_API_KEY}`,
        'X-Site-ID': 'bbpp',
      },
      body: bodyText,
    });
  }

  return fetch(targetUrl, {
    method: request.method,
    headers: {
      ...Object.fromEntries(request.headers),
      'X-Site-ID': 'bbpp',
    },
    body: request.body,
  });
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/dev/bbpp
git add functions/parchment/\[\[path\]\].ts
git commit -m "feat: add X-Site-ID header to parchment proxy"
```

---

## Task 3: Update src/config.ts

**Files:**
- Modify: `~/dev/parchment/src/config.ts`

- [ ] **Step 1: Replace the file**

```typescript
import mtwConfig  from '../config/mtw.json';
import bbppConfig from '../config/bbpp.json';

export interface Palette {
  background: string;
  border:     string;
  titleText:  string;
  bodyText:   string;
  accent:     string;
  nameText:   string;
}

export interface FontConfig {
  titleFamily: string;
  bodyFamily:  string;
}

export interface SiteConfig {
  siteId:              string;
  siteName:            string;
  certificateTitle:    string;
  recipientLabel:      string;
  achievementLabel:    string;
  achievementSubtitle: string;
  palette:             Palette;
  fonts:               FontConfig;
  sealAssetUrl:        string;
  r2KeyPrefix:         string;
  fromEmail:           string;
}

export function getConfig(siteId: string): SiteConfig {
  switch (siteId) {
    case 'mtw':  return mtwConfig  as SiteConfig;
    case 'bbpp': return bbppConfig as SiteConfig;
    default:
      throw new Error(`Unknown site: "${siteId}". Expected "mtw" or "bbpp".`);
  }
}

// Returns the ISSUE_API_KEY secret for the given site.
// Update this map whenever a new site is added.
export function getIssueApiKey(siteId: string, env: Env): string | undefined {
  const map: Record<string, string | undefined> = {
    mtw:  env.MTW_ISSUE_API_KEY,
    bbpp: env.BBPP_ISSUE_API_KEY,
  };
  return map[siteId];
}
```

- [ ] **Step 2: Run typecheck — expect failure** (Env not yet updated)

```bash
cd ~/dev/parchment
npm run typecheck 2>&1 | head -30
```

Expected: errors about `MTW_ISSUE_API_KEY` and `BBPP_ISSUE_API_KEY` not existing on `Env`. This is expected — Task 4 fixes it.

---

## Task 4: Add secrets-env.d.ts

**Files:**
- Create: `~/dev/parchment/src/secrets-env.d.ts`

- [ ] **Step 1: Create the file**

```typescript
// Extends the wrangler-generated Env with secrets that wrangler cannot introspect.
// Add one entry here whenever a new site's ISSUE_API_KEY secret is added.
interface Env {
  RESEND_API_KEY:      string;
  MTW_ISSUE_API_KEY:   string;
  BBPP_ISSUE_API_KEY:  string;
}
```

- [ ] **Step 2: Run typecheck — expect partial pass**

```bash
cd ~/dev/parchment
npm run typecheck 2>&1 | head -30
```

Expected: errors in `src/index.ts` and `src/queue.ts` because they still call `getConfig(env)` (old signature). Tasks 5 and 6 fix those.

---

## Task 5: Update src/index.ts

**Files:**
- Modify: `~/dev/parchment/src/index.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { getConfig, getIssueApiKey }               from './config.ts';
import { buildCacheKey, getCached, putCached }      from './r2.ts';
import { renderCertificate, ALL_FONTS }             from './render.ts';
import { handleQueue, type IssueMessage }           from './queue.ts';
import { hasRecentCertificate }                     from './db.ts';

function jsonError(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url    = new URL(request.url);
    const method = request.method;

    const siteId = request.headers.get('X-Site-ID') ?? '';
    let config;
    try {
      config = getConfig(siteId);
    } catch {
      return jsonError(400, { error: `unknown site: "${siteId}"` });
    }

    // ── GET /parchment/health ─────────────────────────────────────────────────
    if (url.pathname === '/parchment/health') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });
      return Response.json({ status: 'ok', siteId });
    }

    // ── GET /parchment/render — preview certificate ───────────────────────────
    if (url.pathname === '/parchment/render') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });

      const name        = url.searchParams.get('name') ?? '';
      const achievement = url.searchParams.get('achievement');

      if (!name) {
        return jsonError(400, { error: 'name parameter is required' });
      }
      if (name.length > 100) {
        return jsonError(400, { error: 'name must be 100 characters or fewer' });
      }
      if (achievement !== null && achievement.length > 200) {
        return jsonError(400, { error: 'achievement must be 200 characters or fewer' });
      }

      const ach           = achievement ?? config.achievementSubtitle;
      const previewPrefix = `previews/${config.siteId}/`;
      const key           = buildCacheKey(previewPrefix, name, ach);

      const cached = await getCached(env.PARCHMENT, key);
      if (cached !== null) {
        return new Response(cached, {
          status:  200,
          headers: {
            'Content-Type':      'image/png',
            'Cache-Control':     'public, max-age=31536000, immutable',
            'X-Parchment-Cache': 'HIT',
            'X-Parchment-Key':   key,
          },
        });
      }

      try {
        const png = await renderCertificate(config, name, ach, 'PREVIEW', ALL_FONTS);
        await putCached(env.PARCHMENT, key, png);
        return new Response(png, {
          status:  200,
          headers: {
            'Content-Type':      'image/png',
            'Cache-Control':     'public, max-age=31536000, immutable',
            'X-Parchment-Cache': 'MISS',
            'X-Parchment-Key':   key,
          },
        });
      } catch (err) {
        console.error('parchment: render error', err);
        return jsonError(500, { error: 'render failed', detail: String(err) });
      }
    }

    // ── POST /parchment/issue — queue official certificate issuance ───────────
    if (url.pathname === '/parchment/issue') {
      if (method !== 'POST') return jsonError(405, { error: 'method not allowed' });

      const apiKey     = getIssueApiKey(siteId, env);
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !apiKey || authHeader !== `Bearer ${apiKey}`) {
        return jsonError(401, { error: 'unauthorized' });
      }

      let name: string;
      let achievement: string | null;
      let email: string;

      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = await request.json<Record<string, string>>();
        name        = body['name']        ?? '';
        achievement = body['achievement'] ?? null;
        email       = body['email']       ?? '';
      } else {
        const form  = await request.formData();
        name        = (form.get('name')        as string | null) ?? '';
        achievement = (form.get('achievement') as string | null);
        email       = (form.get('email')       as string | null) ?? '';
      }

      if (!name) {
        return jsonError(400, { error: 'name parameter is required' });
      }
      if (name.length > 100) {
        return jsonError(400, { error: 'name must be 100 characters or fewer' });
      }
      if (achievement !== null && achievement.length > 200) {
        return jsonError(400, { error: 'achievement must be 200 characters or fewer' });
      }
      if (!email) {
        return jsonError(400, { error: 'email parameter is required' });
      }

      if (await hasRecentCertificate(env.PARCHMENT_LOG, config.siteId, email)) {
        return jsonError(429, { error: 'A certificate has already been issued to this email today' });
      }

      const ach = achievement ?? config.achievementSubtitle;
      const msg: IssueMessage = { siteId, name, achievement: ach, email };
      await env.PARCHMENT_QUEUE.send(msg);

      return Response.json({ status: 'queued' }, { status: 202 });
    }

    return jsonError(404, { error: 'not found' });
  },

  queue: handleQueue,
};
```

- [ ] **Step 2: Run typecheck — expect one remaining error in queue.ts**

```bash
cd ~/dev/parchment
npm run typecheck 2>&1 | head -30
```

Expected: one error in `src/queue.ts` about `getConfig(env)`. Task 6 fixes it.

---

## Task 6: Update src/queue.ts

**Files:**
- Modify: `~/dev/parchment/src/queue.ts`

- [ ] **Step 1: Replace the file**

```typescript
import { getConfig }                            from './config.ts';
import { buildCacheKey, getCached, putCached }  from './r2.ts';
import { renderCertificate, ALL_FONTS }         from './render.ts';
import { findCertificate, insertCertificate }   from './db.ts';
import { sendCertificateEmail }                 from './email.ts';

export interface IssueMessage {
  siteId:      string;
  name:        string;
  achievement: string;
  email:       string;
}

export async function handleQueue(
  batch: MessageBatch<IssueMessage>,
  env:   Env,
): Promise<void> {
  for (const msg of batch.messages) {
    const { siteId, name, achievement, email } = msg.body;
    const config = getConfig(siteId);
    const ach    = achievement || config.achievementSubtitle;
    const r2Key  = buildCacheKey(config.r2KeyPrefix, name, ach);

    try {
      const existing = await findCertificate(env.PARCHMENT_LOG, r2Key);
      const serial   = existing
        ? existing.serial
        : await insertCertificate(env.PARCHMENT_LOG, config.siteId, name, ach, r2Key, email);

      let png = await getCached(env.PARCHMENT, r2Key);
      if (!png) {
        png = await renderCertificate(config, name, ach, serial, ALL_FONTS);
        await putCached(env.PARCHMENT, r2Key, png);
      }

      try {
        await sendCertificateEmail(email, config.fromEmail, config.siteName, png, env.RESEND_API_KEY);
      } catch (emailErr) {
        console.warn('parchment: email failed for', email, emailErr);
      }

      msg.ack();
    } catch (err) {
      console.error('parchment: queue processing error', err);
      msg.retry();
    }
  }
}
```

- [ ] **Step 2: Run typecheck and lint — both must pass**

```bash
cd ~/dev/parchment
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/dev/parchment
git add src/config.ts src/secrets-env.d.ts src/index.ts src/queue.ts
git commit -m "feat: shared worker — site identity from X-Site-ID header"
```

---

## Task 7: Update wrangler.toml and package.json

**Files:**
- Modify: `~/dev/parchment/wrangler.toml`
- Modify: `~/dev/parchment/package.json`

- [ ] **Step 1: Replace wrangler.toml**

```toml
name            = "parchment-worker"
main            = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[rules]]
type  = "Data"
globs = ["**/*.ttf"]
fallthrough = true

[[r2_buckets]]
binding     = "PARCHMENT"
bucket_name = "parchment"

[[d1_databases]]
binding       = "PARCHMENT_LOG"
database_name = "parchment-log"
database_id   = "REPLACE_WITH_DB_ID"

[[queues.producers]]
queue   = "parchment-queue"
binding = "PARCHMENT_QUEUE"

[[queues.consumers]]
queue             = "parchment-queue"
max_batch_size    = 10
max_batch_timeout = 30
```

Note: `REPLACE_WITH_DB_ID` is a placeholder that `scripts/cloudflare-setup.sh` will patch in Task 9.

- [ ] **Step 2: Update package.json scripts**

Replace the `scripts` block in `package.json`:

```json
"scripts": {
  "dev": "wrangler dev",
  "build": "wrangler deploy --dry-run --outdir dist",
  "deploy": "wrangler deploy",
  "types": "wrangler types",
  "lint": "eslint src --ext .ts",
  "typecheck": "tsc --noEmit",
  "fonts": "bash scripts/download-fonts.sh",
  "setup:cf": "bash scripts/cloudflare-setup.sh"
},
```

- [ ] **Step 3: Run typecheck — expect error about missing Env bindings**

```bash
cd ~/dev/parchment
npm run typecheck 2>&1 | head -20
```

Expected: TypeScript errors because `worker-configuration.d.ts` still reflects the old environment bindings. This resolves after running `npm run types` in Task 10 (after infra exists). This is expected — do not fix now.

- [ ] **Step 4: Commit**

```bash
cd ~/dev/parchment
git add wrangler.toml package.json
git commit -m "chore: collapse wrangler.toml to single shared environment"
```

---

## Task 8: Update cloudflare-setup.sh

**Files:**
- Modify: `~/dev/parchment/scripts/cloudflare-setup.sh`

- [ ] **Step 1: Replace the file**

```bash
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
  if $WRANGLER r2 bucket list 2>/dev/null | grep -q "name:.*${BUCKET_NAME}"; then
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
    echo -e "${YELLOW}⚠ D1 database '${DB_NAME}' already exists — skipping creation${RESET}"
  else
    echo "Creating D1 database: ${DB_NAME}..."
    $WRANGLER d1 create "${DB_NAME}"
    echo -e "${GREEN}✓ Created D1 database: ${DB_NAME}${RESET}"
  fi
  local DB_ID
  DB_ID=$($WRANGLER d1 list 2>/dev/null | grep "${DB_NAME}" | awk -F'│' '{gsub(/ /,"",$2); print $2}')
  echo "${DB_ID}"
}

DB_ID=$(ensure_d1_database "parchment-log")

# Patch wrangler.toml with real database ID
sed -i '' "s/REPLACE_WITH_DB_ID/${DB_ID}/" wrangler.toml 2>/dev/null || true
echo -e "${GREEN}✓ wrangler.toml updated with D1 database ID: ${DB_ID}${RESET}"

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
```

- [ ] **Step 2: Commit**

```bash
cd ~/dev/parchment
git add scripts/cloudflare-setup.sh
git commit -m "chore: update cloudflare-setup.sh for shared backend"
```

---

## Task 9: Create shared Cloudflare infrastructure

This task runs the updated setup script to create the shared R2 bucket, D1 database, and queue. This is a manual operator step — do not automate.

- [ ] **Step 1: Run setup script**

```bash
cd ~/dev/parchment
bash scripts/cloudflare-setup.sh
```

Expected output:
```
parchment — Cloudflare setup (shared backend)
----------------------------------------------
✓ wrangler authenticated
✓ Created R2 bucket: parchment        (or "already exists" if re-running)
✓ Created D1 database: parchment-log  (or "already exists")
✓ wrangler.toml updated with D1 database ID: <uuid>
✓ Migration applied
✓ Created Queue: parchment-queue      (or "already exists")
Setup complete.
```

- [ ] **Step 2: Verify wrangler.toml was patched**

```bash
grep "database_id" wrangler.toml
```

Expected: `database_id   = "<real-uuid>"` — not `REPLACE_WITH_DB_ID`.

- [ ] **Step 3: Regenerate types**

```bash
cd ~/dev/parchment
npm run types
```

Expected: regenerates `worker-configuration.d.ts` with bindings from the new wrangler.toml.

- [ ] **Step 4: Run typecheck and lint — both must pass**

```bash
cd ~/dev/parchment
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 5: Commit wrangler.toml with real DB ID**

```bash
cd ~/dev/parchment
git add wrangler.toml worker-configuration.d.ts
git commit -m "chore: update wrangler.toml with shared D1 database ID"
```

---

## Task 10: Migrate D1 data

Exports certificate records from both old databases and imports them into the new shared `parchment-log` database.

- [ ] **Step 1: Export data from old databases**

```bash
cd ~/dev/parchment
npx wrangler d1 export parchment-log-mtw  --remote --output=scripts/mtw-data.sql  --no-schema
npx wrangler d1 export parchment-log-bbpp --remote --output=scripts/bbpp-data.sql --no-schema
```

If `--no-schema` is not supported by your wrangler version, strip the `CREATE TABLE` statement manually:
```bash
grep -v "^CREATE TABLE" scripts/mtw-data.sql  > scripts/mtw-data-clean.sql
grep -v "^CREATE TABLE" scripts/bbpp-data.sql > scripts/bbpp-data-clean.sql
```

- [ ] **Step 2: Import into shared database**

```bash
npx wrangler d1 execute parchment-log --remote --file=scripts/mtw-data.sql
npx wrangler d1 execute parchment-log --remote --file=scripts/bbpp-data.sql
```

(Use the `-clean.sql` variants if you stripped the schema in Step 1.)

- [ ] **Step 3: Verify row counts match**

Run these three queries and confirm the sum of the old counts equals the new total:

```bash
npx wrangler d1 execute parchment-log-mtw  --remote --command "SELECT COUNT(*) as count FROM certificates"
npx wrangler d1 execute parchment-log-bbpp --remote --command "SELECT COUNT(*) as count FROM certificates"
npx wrangler d1 execute parchment-log      --remote --command "SELECT COUNT(*) as count FROM certificates"
```

Expected: `count(parchment-log)` = `count(mtw)` + `count(bbpp)`.

- [ ] **Step 4: Delete export files (they contain PII)**

```bash
rm -f scripts/mtw-data.sql scripts/bbpp-data.sql scripts/mtw-data-clean.sql scripts/bbpp-data-clean.sql
```

---

## Task 11: Migrate R2 objects

R2 objects are PNG cache entries. Issued cert PNGs (`certs/` prefix) are worth migrating since they avoid regeneration. Preview PNGs (`previews/` prefix) are expendable — skip them if this step is tedious.

The approach uses D1 as the source of truth for which `certs/` keys exist.

- [ ] **Step 1: Create migration script**

Create `scripts/migrate-r2.sh`:

```bash
#!/usr/bin/env bash
# Copies issued cert PNGs from old per-site R2 buckets to the shared bucket.
# Run once during migration. Safe to re-run (put is idempotent).
set -euo pipefail

WRANGLER="npx wrangler"
TMP="/tmp/parchment-r2-migration"
mkdir -p "$TMP"

copy_cert_objects() {
  local SRC_BUCKET="$1"
  local DB_NAME="$2"

  echo "Fetching cert keys from ${DB_NAME}..."
  local KEYS
  KEYS=$($WRANGLER d1 execute "$DB_NAME" --remote \
    --command "SELECT r2_key FROM certificates" --json \
    | python3 -c "import sys,json; [print(r['r2_key']) for r in json.load(sys.stdin)[0]['results']]")

  local COUNT=0
  while IFS= read -r KEY; do
    [ -z "$KEY" ] && continue
    local TMPFILE="${TMP}/obj.png"
    echo "  Copying: ${KEY}"
    $WRANGLER r2 object get "${SRC_BUCKET}/${KEY}" --file="$TMPFILE" 2>/dev/null || {
      echo "  WARN: not found in ${SRC_BUCKET}: ${KEY}"
      continue
    }
    $WRANGLER r2 object put "parchment/${KEY}" --file="$TMPFILE"
    COUNT=$((COUNT + 1))
  done <<< "$KEYS"

  echo "  Copied ${COUNT} objects from ${SRC_BUCKET}"
}

copy_cert_objects "parchment-mtw"  "parchment-log-mtw"
copy_cert_objects "parchment-bbpp" "parchment-log-bbpp"

rm -rf "$TMP"
echo "R2 migration complete."
```

- [ ] **Step 2: Run it**

```bash
bash scripts/migrate-r2.sh
```

Expected: output listing each copied key, then "R2 migration complete."

- [ ] **Step 3: Delete the migration script**

```bash
rm scripts/migrate-r2.sh
```

---

## Task 12: Deploy shared worker and set secrets

- [ ] **Step 1: Set secrets on the shared worker**

```bash
cd ~/dev/parchment
npx wrangler secret put RESEND_API_KEY
# (paste shared Resend API key when prompted)

npx wrangler secret put MTW_ISSUE_API_KEY
# (paste MTW issue API key when prompted — same value previously set on parchment-worker-mtw)

npx wrangler secret put BBPP_ISSUE_API_KEY
# (paste BBPP issue API key when prompted — same value previously set on parchment-worker-bbpp)
```

- [ ] **Step 2: Deploy**

```bash
cd ~/dev/parchment
npm run deploy
```

Expected: wrangler outputs the new worker URL, e.g.:
```
Deployed parchment-worker triggers:
  https://parchment-worker.<your-subdomain>.workers.dev
```

Note the URL — you need it in Task 13.

- [ ] **Step 3: Smoke test the shared worker directly**

Replace `<worker-url>` with the URL from Step 2:

```bash
curl -s https://<worker-url>/parchment/health -H "X-Site-ID: mtw"
# Expected: {"status":"ok","siteId":"mtw"}

curl -s https://<worker-url>/parchment/health -H "X-Site-ID: bbpp"
# Expected: {"status":"ok","siteId":"bbpp"}

curl -s https://<worker-url>/parchment/health
# Expected: {"error":"unknown site: \"\""}  (status 400)

curl -s "https://<worker-url>/parchment/render?name=Test+User" -H "X-Site-ID: mtw" --output /tmp/mtw-preview.png
file /tmp/mtw-preview.png
# Expected: PNG image data, 1200 x 850
```

---

## Task 13: Cut over Pages sites and verify

- [ ] **Step 1: Update PARCHMENT_BASE_URL on mtw4**

In the Cloudflare dashboard (or via wrangler pages), update the `PARCHMENT_BASE_URL` environment variable for the `mtw4` Pages project to the shared worker URL from Task 12.

Or via CLI:
```bash
npx wrangler pages secret put PARCHMENT_BASE_URL --project-name=mtw4
# paste: https://parchment-worker.<your-subdomain>.workers.dev
```

Trigger a new Pages deployment for mtw4 so the new env var takes effect.

- [ ] **Step 2: Verify mtw4 routes through shared worker**

```bash
curl -s https://mastertimewaster.com/parchment/health
# Expected: {"status":"ok","siteId":"mtw"}

curl -s "https://mastertimewaster.com/parchment/render?name=Test+User" --output /tmp/mtw-live.png
file /tmp/mtw-live.png
# Expected: PNG image data, 1200 x 850
```

- [ ] **Step 3: Update PARCHMENT_BASE_URL on bbpp**

```bash
npx wrangler pages secret put PARCHMENT_BASE_URL --project-name=bbpp
# paste same shared worker URL
```

Trigger a new Pages deployment for bbpp.

- [ ] **Step 4: Verify bbpp routes through shared worker**

```bash
curl -s https://bigbeautifulpeaceprize.com/parchment/health
# Expected: {"status":"ok","siteId":"bbpp"}

curl -s "https://bigbeautifulpeaceprize.com/parchment/render?name=Test+User" --output /tmp/bbpp-live.png
file /tmp/bbpp-live.png
# Expected: PNG image data, 1200 x 850
```

---

## Task 14: Tear down old infrastructure

Only run this task after both sites are verified in Task 13.

- [ ] **Step 1: Delete old workers**

```bash
npx wrangler delete parchment-worker-mtw
npx wrangler delete parchment-worker-bbpp
```

- [ ] **Step 2: Delete old queues**

```bash
npx wrangler queues delete parchment-queue-mtw
npx wrangler queues delete parchment-queue-bbpp
```

- [ ] **Step 3: Delete old D1 databases**

```bash
npx wrangler d1 delete parchment-log-mtw
npx wrangler d1 delete parchment-log-bbpp
```

- [ ] **Step 4: Delete old R2 buckets**

```bash
npx wrangler r2 bucket delete parchment-mtw
npx wrangler r2 bucket delete parchment-bbpp
```

Note: if these buckets still contain objects, wrangler may refuse to delete them. Use the Cloudflare dashboard to empty them first, or use `wrangler r2 object delete` per key.

---

## Task 15: Update CLAUDE.md

**Files:**
- Modify: `~/dev/parchment/CLAUDE.md`

- [ ] **Step 1: Update the infrastructure sections**

Replace the First-time setup section's Step 2 references (R2 buckets, databases, queues) to describe the single shared resources.

Replace the Daily commands section:
```markdown
## Daily commands

\`\`\`bash
npm run dev           # local dev on localhost:8787 (pass X-Site-ID: mtw or bbpp header)
npm run lint          # ESLint — must pass before committing
npm run typecheck     # tsc --noEmit — must pass before committing
npm run deploy        # deploy parchment-worker to Cloudflare
\`\`\`
```

Replace the Architecture preamble to remove the two-environment description:
```markdown
# parchment

Cloudflare Worker that renders award certificate PNGs on demand.
Single shared deployment serving all certificate sites (mtw, bbpp, ...).
Site identity is determined by the `X-Site-ID` request header injected by each Pages Function.
```

Update the Secrets section:
```markdown
### Step 3 — Secrets (one-time, run manually)

\`\`\`bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put MTW_ISSUE_API_KEY
npx wrangler secret put BBPP_ISSUE_API_KEY
\`\`\`
```

Update the `src/config.ts` architecture line:
```markdown
- src/config.ts   SiteConfig type + loader (getConfig(siteId)), getIssueApiKey(siteId, env)
```

- [ ] **Step 2: Run typecheck and lint one final time**

```bash
cd ~/dev/parchment
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/dev/parchment
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for shared backend"
```

---

## Adding a New Certificate (Post-Migration Reference)

1. Add `config/xyz.json` with site branding (copy from `config/mtw.json` as template)
2. Add a case to `getConfig()` in `src/config.ts`
3. Add a key to the `map` in `getIssueApiKey()` in `src/config.ts`
4. Add `XYZ_ISSUE_API_KEY: string;` to `src/secrets-env.d.ts`
5. Set the secret: `npx wrangler secret put XYZ_ISSUE_API_KEY`
6. `npm run deploy`
7. Create new Pages site; set `PARCHMENT_BASE_URL` to shared worker URL and `PARCHMENT_API_KEY` to the XYZ key
8. Hardcode `'X-Site-ID': 'xyz'` in the new Pages Function
