# parchment

Cloudflare Worker that renders award certificate PNGs on demand.
Two environments: `mtw` (mastertimewaster.com) and `bbpp` (bigbeautifulpeaceprize.com).

## Tech Stack
- Cloudflare Workers, TypeScript strict mode
- Satori (SVG layout), @resvg/resvg-wasm (SVG → PNG)
- Cloudflare R2 (PNG cache)
- Wrangler 3.x

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

This script requires `wrangler` to be authenticated (`wrangler login`). It is safe to re-run —
each command checks whether the resource already exists before creating it. It performs:

- Creates R2 bucket `parchment-mtw`
- Creates R2 bucket `parchment-bbpp`
- Verifies both buckets appear in `wrangler r2 bucket list`
- Prints a summary of what was created

**Do not run this script via `npm run setup:cf` in CI.** It is a manual operator step only.

### Step 3 — Local development

```bash
npm run dev         # starts wrangler dev with mtw config on localhost:8787
```

Verify:
- `curl http://localhost:8787/parchment/health` → `{"status":"ok","siteId":"mtw"}`
- `curl "http://localhost:8787/parchment/render?name=Test+User" --output test.png`
- `file test.png` → should report `PNG image data`

### Step 4 — Deploy (after Cloudflare setup is complete)

```bash
npm run deploy:mtw    # deploys parchment-worker-mtw to mastertimewaster.com
npm run deploy:bbpp   # deploys parchment-worker-bbpp to bigbeautifulpeaceprize.com
```

## Daily commands

```bash
npm run dev           # local dev, mtw config on localhost:8787
npm run lint          # ESLint — must pass before committing
npm run typecheck     # tsc --noEmit — must pass before committing
npm run deploy:mtw    # deploy MTW environment to Cloudflare
npm run deploy:bbpp   # deploy BBPP environment to Cloudflare
```

## Architecture

- src/index.ts    entrypoint, router
- src/config.ts   SiteConfig type + loader (reads env.SITE_ID)
- src/render.ts   Satori + resvg-wasm pipeline
- src/r2.ts       R2 get/put helpers
- src/template.ts certificate layout (Satori node tree, no React)
- config/         per-site JSON — all copy, colors, fonts live here

## Conventions

- No React. Satori object tree API only ({ type, props }).
- No any types. Run typecheck before committing.
- No hand-written Env interface — always regenerate via `npm run types`.
- resvg-wasm initialized once at module level via a promise (wasmReady).
- R2 is the permanent cache — keys are never deleted.
- Seal image fetch failures are non-fatal; certificate renders without the seal.
- Cloudflare infrastructure changes (R2 buckets, routes) go through scripts/cloudflare-setup.sh,
  run manually by the developer — never automated by Claude Code.

## TODO / Next Steps
- [ ] create seal images for all awards
- [ ] log awards that have been generated
- [ ] email awards to recipients
- [ ] add a serial number/counter to the certificate
