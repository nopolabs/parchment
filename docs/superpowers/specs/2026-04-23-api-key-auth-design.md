# API Key Authentication for /parchment/issue

**Date:** 2026-04-23
**Status:** Approved

## Problem

`POST /parchment/issue` is open to any caller. Anyone can issue certificates and trigger emails to arbitrary addresses using the Resend API quota.

## Scope

Add per-environment API key authentication to `POST /parchment/issue`. Two clients — mtw4 (mastertimewaster.com) and bbpp (bigbeautifulpeaceprize.com) — each get a catch-all Pages Function that proxies all `/parchment/*` traffic. The function adds an auth header on `POST /parchment/issue` only; all other paths pass through unauthenticated. No changes to browser-side JavaScript in either client.

Endpoints NOT affected by auth: `GET /parchment/render`, `GET /parchment/health`.

## Routing change (required)

Parchment currently owns `mastertimewaster.com/parchment/*` and `bigbeautifulpeaceprize.com/parchment/*` as Cloudflare **Worker Routes**. Worker Routes take priority over Pages Functions, so a Pages Function at `/parchment/issue` would be shadowed and never invoked.

**Resolution:** Remove both domain routes from parchment's `wrangler.toml`. Parchment becomes `workers.dev`-only. The Pages Function on each client site becomes the domain-level entry point for all `/parchment/*` traffic, proxying to parchment's `workers.dev` URL.

## Architecture

```
Browser
  └─ POST /parchment/issue  (relative URL, unchanged)
       └─ Pages Function: functions/parchment/[[path]].ts  (catch-all)
            ├─ POST /parchment/issue → fetch(workers.dev URL, { Authorization: Bearer <key> })
            └─ all other paths     → fetch(workers.dev URL)  [transparent proxy, no auth]
                 └─ Parchment Worker: validates key on /issue → handles request
```

## Pages Function (identical for both clients)

File: `functions/parchment/[[path]].ts`  (Cloudflare Pages catch-all syntax)

```typescript
interface Env {
  PARCHMENT_BASE_URL: string;  // e.g. https://parchment-worker-mtw.<account>.workers.dev
  PARCHMENT_API_KEY: string;
}

export async function onRequest(context: EventContext<Env, string, unknown>) {
  const { request, env, params } = context;
  const path = (params.path as string[] | undefined)?.join('/') ?? '';
  const targetUrl = `${env.PARCHMENT_BASE_URL}/parchment/${path}`;

  const isIssue = path === 'issue' && request.method === 'POST';

  const headers = new Headers(request.headers);
  if (isIssue) {
    headers.set('Authorization', `Bearer ${env.PARCHMENT_API_KEY}`);
  }

  return fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
  });
}
```

### Pages secrets (per client)

| Secret | Value |
|--------|-------|
| `PARCHMENT_API_KEY` | The key for this environment (hex, 64 chars) |
| `PARCHMENT_BASE_URL` | `https://parchment-worker-<env>.<account>.workers.dev` |

Set via CF dashboard → Pages project → Settings → Environment variables, or:
```bash
wrangler pages secret put PARCHMENT_API_KEY --project-name <project>
wrangler pages secret put PARCHMENT_BASE_URL --project-name <project>
```

## Parchment Worker Changes

### 1. Remove domain routes from `wrangler.toml`

Remove the `[[env.mtw.routes]]` and `[[env.bbpp.routes]]` sections entirely. Parchment is then accessible only via `workers.dev` — no change to the worker's logic for render/health/issue routing.

### 2. Auth guard in `src/index.ts`

Added at the top of the `POST /parchment/issue` handler, before parameter parsing:

```typescript
const authHeader = request.headers.get('Authorization');
if (!authHeader || authHeader !== `Bearer ${env.ISSUE_API_KEY}`) {
  return jsonError(401, { error: 'unauthorized' });
}
```

### 3. New Wrangler secret (per environment)

```bash
wrangler secret put ISSUE_API_KEY --env mtw
wrangler secret put ISSUE_API_KEY --env bbpp
```

Each environment gets an independent key. Rotating one has no effect on the other.

### Key generation

```bash
openssl rand -hex 32
```

Produces 64 hex characters (256 bits of entropy). Safe in all shell, config, and HTTP header contexts — no quoting issues.

## Client-specific notes

### mtw4 (Cloudflare Pages with Functions)
- Already has a `functions/` directory — add `functions/parchment/[[path]].ts` alongside existing functions.
- No changes to `src/certificate.liquid` or any other browser-side JS.

### bbpp (Cloudflare Pages, static only)
- Add a `functions/` directory (new) with `functions/parchment/[[path]].ts`.
- No changes to `src/index.html` or any other browser-side JS.
- CF Pages automatically activates Functions when the `functions/` directory is present.

## Deployment order

1. **Parchment first:** Set `ISSUE_API_KEY` secret, deploy updated worker (routes removed, auth guard added). The `workers.dev` endpoint is now protected. **Note:** domain routes are gone at this point — `/parchment/*` on both domains will 404 until client deploys in steps 2–3. Keep this window short.
2. **mtw4:** Set Pages secrets (`PARCHMENT_API_KEY`, `PARCHMENT_BASE_URL`), deploy with new Pages Function. mastertimewaster.com/parchment/* restored.
3. **bbpp:** Set Pages secrets, deploy with new Pages Function. bigbeautifulpeaceprize.com/parchment/* restored.

## Three implementation plans

Per the agreed scope, implementation plans will be written separately for:
- `parchment` — remove domain routes, add auth guard, set Wrangler secret
- `mtw4` — add catch-all Pages Function, set Pages secrets
- `bbpp` — add `functions/` directory with catch-all Pages Function, set Pages secrets
