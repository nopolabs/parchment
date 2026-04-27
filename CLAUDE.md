# parchment

Single shared Cloudflare Worker that renders award certificate PNGs on demand.
Serves multiple sites — currently `mtw` (mastertimewaster.com) and `bbpp` (bigbeautifulpeaceprize.com).
Site identity is passed by each Pages Function via the `X-Site-ID` request header.
Adding a new site requires no new Cloudflare infrastructure — only a new config file and Pages Function.

## Tech Stack
- Cloudflare Workers, TypeScript strict mode
- Satori (SVG layout), @resvg/resvg-wasm (SVG → PNG)
- Cloudflare R2 (PNG cache) — single shared bucket `parchment`
- Cloudflare D1 (certificate log + serial numbers) — single shared database `parchment-log`
- Cloudflare Queues (async certificate issuance) — single shared queue `parchment-queue`
- Resend (email delivery)
- Wrangler 4.x

## First-time setup

### Step 1 — Install dependencies and download fonts

```bash
npm install
npm run fonts       # downloads TTF files into assets/fonts/ (gitignored)
npm run types       # generates worker-configuration.d.ts from wrangler.toml
```

### Step 2 — Cloudflare infrastructure (one-time, run manually)

All Cloudflare setup is collected in `scripts/cloudflare-setup.sh`. Review it, then run:

```bash
bash scripts/cloudflare-setup.sh
```

This script requires `wrangler` to be authenticated (`npx wrangler login`). It is safe to re-run —
each command checks whether the resource already exists before creating it. It performs:

- Creates R2 bucket `parchment`
- Creates D1 database `parchment-log` and applies migration
- Creates Queue `parchment-queue`
- Patches `wrangler.toml` with the D1 database ID

After running, regenerate types:

```bash
npm run types
```

**Do not run this script in CI.** It is a manual operator step only.

### Step 3 — Secrets (one-time, run manually)

```bash
npx wrangler secret put RESEND_API_KEY        # Resend API key for mastertimewaster.com
npx wrangler secret put MTW_ISSUE_API_KEY     # API key for /parchment/issue on mtw
npx wrangler secret put BBPP_ISSUE_API_KEY    # API key for /parchment/issue on bbpp
```

### Step 4 — Local development

```bash
npm run dev         # starts wrangler dev on localhost:8787
```

Verify (pass X-Site-ID header to select site):
- `curl -H "X-Site-ID: mtw" http://localhost:8787/parchment/health` → `{"status":"ok","siteId":"mtw"}`
- `curl -H "X-Site-ID: mtw" "http://localhost:8787/parchment/render?name=Test+User" --output test.png`
- `file test.png` → should report `PNG image data` with "PREVIEW" in footer

### Step 5 — Deploy (after Cloudflare setup is complete)

```bash
npm run deploy
```

## Daily commands

```bash
npm run dev           # local dev on localhost:8787
npm run lint          # ESLint — must pass before committing
npm run typecheck     # tsc --noEmit — must pass before committing
npm run deploy        # deploy to Cloudflare
```

## Architecture

- src/index.ts      entrypoint, router — reads X-Site-ID header to determine site
- src/config.ts     SiteConfig type + loader (getConfig, getIssueApiKey)
- src/render.ts     Satori + resvg-wasm pipeline
- src/r2.ts         R2 get/put helpers
- src/template.ts   certificate layout (Satori node tree, no React)
- src/db.ts         D1 helpers (certificate log + serial numbers)
- src/queue.ts      Queue consumer (render → log → email)
- src/email.ts      Resend email delivery
- src/secrets-env.d.ts  Declaration merge extending Env with secret fields
- config/           per-site JSON — all copy, colors, fonts live here

## Adding a new site

1. Add `config/<siteid>.json` with the site's copy, colors, and font choices
2. Add a case to `getConfig()` and `getIssueApiKey()` in `src/config.ts`
3. Add `<SITEID>_ISSUE_API_KEY` to `src/secrets-env.d.ts`
4. Set the new secret: `npx wrangler secret put <SITEID>_ISSUE_API_KEY`
5. In the Pages repo, add `'X-Site-ID': '<siteid>'` to the Pages Function proxy headers
6. Set `PARCHMENT_BASE_URL` on the Pages site to `https://parchment-worker.danrevel.workers.dev`
7. `npm run deploy`

No new R2 buckets, D1 databases, or Queues needed.

## API

All endpoints require an `X-Site-ID` header (injected by each site's Pages Function).

### GET /parchment/health
Returns `{"status":"ok","siteId":"<siteid>"}`.

### GET /parchment/render
Returns a **preview** PNG with `PREVIEW` in the footer. Cached in R2 under `previews/{siteId}/`.
No D1 record created, no email sent.

Query params: `name` (required, max 100), `achievement` (optional, max 200).

### POST /parchment/issue
Queues an official certificate issuance. Returns `{"status":"queued"}` (202).
Requires `Authorization: Bearer <SITEID_ISSUE_API_KEY>` header.
The queue consumer renders the certificate with a serial number (e.g. `MTW-0001`),
logs it to D1, and emails it to the recipient via Resend.

Body params (form or JSON): `name` (required), `achievement` (optional), `email` (required).

## Conventions

- No React. Satori object tree API only ({ type, props }).
- No any types. Run typecheck before committing.
- No hand-written Env interface — always regenerate via `npm run types`.
  Exception: `src/secrets-env.d.ts` extends Env with secret fields wrangler cannot introspect.
- resvg-wasm initialized once at module level via a promise (wasmReady).
- R2 is the permanent cache — keys are never deleted.
- Seal image fetch failures are non-fatal; certificate renders without the seal.
- Cloudflare infrastructure changes go through scripts/cloudflare-setup.sh,
  run manually by the developer — never automated by Claude Code.
- Secrets are set via `wrangler secret put` — never stored in wrangler.toml.

## TODO / Next Steps
- [ ] create seal images for all awards
