# API Key Auth + Turnstile for /parchment/issue

**Date:** 2026-04-23
**Status:** Approved

## Problem

`POST /parchment/issue` is open to any caller. Anyone can issue certificates and trigger emails to arbitrary addresses using the Resend API quota.

## Scope

Protect `POST /parchment/issue` with two complementary layers:

1. **Cloudflare Turnstile** — verifies each submission comes from a real browser on the correct domain. Stops scripted/bulk abuse at the Pages Function layer before the request reaches parchment.
2. **API key (`ISSUE_API_KEY`)** — parchment requires a valid `Authorization: Bearer` header. Stops direct calls to the `workers.dev` endpoint that bypass the Pages Function entirely.

Two clients — mtw4 (mastertimewaster.com) and bbpp (bigbeautifulpeaceprize.com) — each get a catch-all Pages Function that owns all `/parchment/*` traffic on the domain. Changes to browser-side JavaScript are minimal: add the Turnstile widget and include the token in the POST body.

Endpoints NOT affected by auth: `GET /parchment/render`, `GET /parchment/health`.

## Routing change (required)

Parchment currently owns `mastertimewaster.com/parchment/*` and `bigbeautifulpeaceprize.com/parchment/*` as Cloudflare **Worker Routes**. Worker Routes take priority over Pages Functions, so the Pages Function proxy would be shadowed and never invoked.

**Resolution:** Remove both domain routes from parchment's `wrangler.toml`. Parchment becomes `workers.dev`-only. The Pages Function on each client site becomes the domain-level entry point for all `/parchment/*` traffic.

## Architecture

```
Browser (real user, has Turnstile token)
  └─ POST /parchment/issue  (relative URL, unchanged)
       └─ Pages Function: functions/parchment/[[path]].ts
            ├─ verify Turnstile token  → 403 if invalid
            └─ fetch(workers.dev URL, { Authorization: Bearer <key> })
                 └─ Parchment Worker: validates API key → 401 if missing/wrong → queues issuance

Attacker (script, no browser)
  └─ POST mastertimewaster.com/parchment/issue  → Turnstile verify fails → 403
  └─ POST parchment-worker-mtw.<account>.workers.dev/parchment/issue → 401 (no API key)
```

## Cloudflare Turnstile setup (one-time, manual)

Create two Turnstile widgets in the Cloudflare dashboard (one per domain):
- **Widget 1:** mastertimewaster.com → produces `TURNSTILE_SITE_KEY_MTW` + `TURNSTILE_SECRET_KEY_MTW`
- **Widget 2:** bigbeautifulpeaceprize.com → produces `TURNSTILE_SITE_KEY_BBPP` + `TURNSTILE_SECRET_KEY_BBPP`

Widget type: **Managed** (invisible for real users, challenges suspicious ones).

The site key is public and goes in the page HTML. The secret key is a Pages Function secret used for server-side verification.

## Client changes (browser side)

Both clients use JavaScript `fetch()`, not a native form submit. Turnstile's auto-injection of `cf-turnstile-response` only works with native form submits, so the token must be read explicitly.

### HTML addition (both clients)

In the certificate form, add the Turnstile widget and its script:

```html
<!-- In <head> or before </body> -->
<script src="https://challenges.cloudflare.com/turnstile/v1/api.js" async defer></script>

<!-- Inside the form, near the submit button -->
<div class="cf-turnstile" data-sitekey="<TURNSTILE_SITE_KEY>" data-theme="light"></div>
```

### JS change (both clients)

Before the `fetch()` call, read the Turnstile token and append it to the POST body:

```javascript
// existing code builds URLSearchParams as `body`
body.set('cf-turnstile-response', turnstile.getResponse());

fetch('/parchment/issue', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: body.toString(),
});
```

If `turnstile.getResponse()` returns an empty string (widget not yet resolved), the Pages Function will reject the request — handle this in the UI by disabling the submit button until Turnstile fires its success callback.

## Pages Function (identical for both clients)

File: `functions/parchment/[[path]].ts`

The function handles all `/parchment/*` requests:
- For `POST /parchment/issue`: verify Turnstile token, then proxy with API key header.
- For all other paths: transparent proxy, no auth.

```typescript
interface Env {
  PARCHMENT_BASE_URL: string;      // https://parchment-worker-<env>.<account>.workers.dev
  PARCHMENT_API_KEY: string;       // API key for parchment's ISSUE_API_KEY
  TURNSTILE_SECRET_KEY: string;    // Turnstile secret for server-side verification
}

export async function onRequest(context: EventContext<Env, string, unknown>) {
  const { request, env, params } = context;
  const path = (params.path as string[] | undefined)?.join('/') ?? '';
  const targetUrl = `${env.PARCHMENT_BASE_URL}/parchment/${path}`;
  const isIssue = path === 'issue' && request.method === 'POST';

  if (isIssue) {
    // Buffer the body so we can read the Turnstile token and still forward it.
    const bodyText = await request.text();
    const formData = new URLSearchParams(bodyText);
    const token = formData.get('cf-turnstile-response') ?? '';

    const verifyRes = await fetch(
      'https://challenges.cloudflare.com/turnstile/v1/siteverify',
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
    const { success } = await verifyRes.json<{ success: boolean }>();
    if (!success) {
      return new Response(JSON.stringify({ error: 'verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Forward the full body (parchment ignores cf-turnstile-response).
    return fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Bearer ${env.PARCHMENT_API_KEY}`,
      },
      body: bodyText,
    });
  }

  // All other paths: transparent proxy.
  return fetch(targetUrl, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
}
```

### Pages secrets (per client)

| Secret | Value |
|--------|-------|
| `PARCHMENT_API_KEY` | The key matching this environment's `ISSUE_API_KEY` (hex, 64 chars) |
| `PARCHMENT_BASE_URL` | `https://parchment-worker-<env>.<account>.workers.dev` |
| `TURNSTILE_SECRET_KEY` | From Cloudflare Turnstile dashboard for this domain |

```bash
wrangler pages secret put PARCHMENT_API_KEY    --project-name <project>
wrangler pages secret put PARCHMENT_BASE_URL   --project-name <project>
wrangler pages secret put TURNSTILE_SECRET_KEY --project-name <project>
```

The Turnstile site key is public — hardcode it in the HTML template.

## Parchment Worker changes

### 1. Remove domain routes from `wrangler.toml`

Remove the `[[env.mtw.routes]]` and `[[env.bbpp.routes]]` sections entirely. Parchment is then only reachable via `workers.dev`.

### 2. Auth guard in `src/index.ts`

At the top of the `POST /parchment/issue` handler, before parameter parsing:

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

Each environment gets an independent key generated with:

```bash
openssl rand -hex 32
```

## Client-specific notes

### mtw4 (Cloudflare Pages with Functions)
- Already has a `functions/` directory — add `functions/parchment/[[path]].ts`.
- Edit `src/certificate.liquid`: add Turnstile script tag, widget `<div>`, and token read in the fetch JS.
- Hardcode the mtw Turnstile site key in the template.

### bbpp (Cloudflare Pages, static only)
- Add a `functions/` directory (new) with `functions/parchment/[[path]].ts`.
- Edit `src/index.html`: add Turnstile script tag, widget `<div>`, and token read in the fetch JS.
- Hardcode the bbpp Turnstile site key in the HTML.
- CF Pages automatically activates Functions when the `functions/` directory is present.

## Deployment order

1. **Cloudflare dashboard:** Create two Turnstile widgets, note site keys and secret keys.
2. **Parchment:** Set `ISSUE_API_KEY` secrets, remove domain routes, deploy. Workers.dev endpoint is now protected. Domain endpoints 404 briefly — keep window short.
3. **mtw4:** Set Pages secrets, deploy with Turnstile widget + Pages Function. mastertimewaster.com/parchment/* restored.
4. **bbpp:** Set Pages secrets, deploy with Turnstile widget + Pages Function. bigbeautifulpeaceprize.com/parchment/* restored.

## Three implementation plans

Per the agreed scope, implementation plans will be written separately for:
- `parchment` — remove domain routes, add auth guard, set Wrangler secret
- `mtw4` — Turnstile widget in template, Pages Function, Pages secrets
- `bbpp` — Turnstile widget in HTML, new `functions/` directory, Pages Function, Pages secrets
