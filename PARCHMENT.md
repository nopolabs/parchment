# PARCHMENT — Technical Design Document

> **Purpose:** This document is the authoritative specification for the `parchment` Cloudflare Worker.
> It is written for Claude Code CLI running in autonomous mode (`--auto`). Every requirement is
> numbered and atomic. No ambiguity is permitted. Open questions are flagged with ⚠️.

---

## 1. Overview

**Parchment** is a Cloudflare Worker that generates award certificate images (PNG) on demand using
Satori (SVG layout engine) and resvg-wasm (SVG → PNG renderer). Generated images are cached
permanently in Cloudflare R2 object storage.

The worker is deployed as **two independent environments** from a single codebase:

| Environment | Worker name | Site | R2 bucket |
|---|---|---|---|
| `mtw` | `parchment-worker-mtw` | mastertimewaster.com | `parchment-mtw` |
| `bbpp` | `parchment-worker-bbpp` | bigbeautifulpeaceprize.com | `parchment-bbpp` |

All site-specific content (copy, colors, fonts) lives in JSON config files. The rendering pipeline,
R2 caching logic, and API surface are identical across both deployments.

**GitHub repo:** `nopolabs/parchment`
**Runtime:** Cloudflare Workers (TypeScript)
**Primary output:** `image/png` — a 1200×850px certificate image

---

## 2. Goals & Non-Goals

### Goals

- Render a unique certificate PNG for any combination of `name` + optional `achievement` text
- Cache every rendered PNG in R2 so each unique combination is rendered exactly once
- Support two independent deployments (mtw, bbpp) from one codebase with zero shared runtime state
- All site-specific copy, colors, and font choices are driven entirely by per-site JSON config
- Both environments deploy cleanly via `wrangler deploy --env mtw` and `wrangler deploy --env bbpp`
- A `GET /health` endpoint confirms the deployment is live and reports its `siteId`
- TypeScript strict mode throughout — zero `any` types, zero `tsc` errors

### Non-Goals

- No authentication or access control on the render endpoint
- No user-facing HTML form (forms live on the parent sites, not in this worker)
- No PDF output — PNG only
- No cache invalidation — R2 entries are permanent once written
- No Printful integration in this worker
- No analytics or logging beyond Cloudflare's built-in request logs
- No seal image upload — seal images are referenced by URL in config and fetched at render time
- No support for more than two environments in this version
- No multiple certificate templates per site

---

## 3. Repository Structure

Claude Code must create the following file and folder structure. Do not add files not listed here.

```
parchment/
├── wrangler.toml
├── package.json
├── tsconfig.json
├── CLAUDE.md
├── PARCHMENT.md                  ← this document (copy into repo)
├── src/
│   ├── index.ts                  ← Worker entrypoint and router
│   ├── config.ts                 ← SiteConfig type definition and config loader
│   ├── render.ts                 ← Satori + resvg-wasm pipeline
│   ├── r2.ts                     ← R2 get/put helpers
│   ├── template.ts               ← Certificate layout (Satori node tree, no React)
│   └── types.d.ts                ← Module declarations for *.wasm imports
├── config/
│   ├── mtw.json                  ← Master Time Waster site config
│   └── bbpp.json                 ← Big Beautiful Peace Prize site config
├── scripts/
│   ├── download-fonts.sh             ← downloads bundled TTF files from Google Fonts
│   └── cloudflare-setup.sh           ← one-time Cloudflare infrastructure setup (run manually)
└── assets/
    └── fonts/
        ├── PlayfairDisplay-Bold.ttf
        ├── Lato-Regular.ttf
        ├── CormorantGaramond-SemiBold.ttf
        └── SourceSansPro-Regular.ttf
```

**Font files:** Claude Code must download the four TTF font files listed above from Google Fonts
during setup. Use `npx google-fonts-dl` or direct URL download via curl. Place them in
`assets/fonts/`. Do not commit font files to git — add `assets/fonts/*.ttf` to `.gitignore`.
Instead, add a `scripts/download-fonts.sh` shell script that downloads them, and document its use
in CLAUDE.md.

**Cloudflare infrastructure setup:** All one-time Cloudflare setup steps (R2 bucket creation,
Worker route registration, etc.) are collected in `scripts/cloudflare-setup.sh`. Claude Code must
write this script but must NOT execute it. It is run manually by the developer after review.
Document all steps in CLAUDE.md.

---

## 4. Tech Stack

| Concern | Technology | Version |
|---|---|---|
| Runtime | Cloudflare Workers | current |
| Language | TypeScript | ~5.x, strict mode |
| Build / deploy | Wrangler | ~3.x |
| SVG layout | `satori` | ^0.10.x |
| PNG rendering | `@resvg/resvg-wasm` | ^2.x |
| Object storage | Cloudflare R2 | via Worker binding |
| Linting | ESLint + `@typescript-eslint` | current |
| Type generation | `wrangler types` | run before build |

**No React dependency.** Satori accepts plain object trees (`{ type, props }`) — do not install
React. Use Satori's native object tree API throughout `template.ts`.

---

## 5. Configuration

### 5.1 SiteConfig Type

Defined in `src/config.ts`. This is the single source of truth for all site-specific values.

```typescript
export interface Palette {
  background: string;   // CSS hex color — certificate background
  border: string;       // CSS hex color — outer border and inner rule
  titleText: string;    // CSS hex color — certificate title line
  bodyText: string;     // CSS hex color — labels and subtitle
  accent: string;       // CSS hex color — achievement label text
  nameText: string;     // CSS hex color — recipient name (large)
}

export interface FontConfig {
  titleFamily: string;  // Must match exactly one of the four bundled TTF files
  bodyFamily:  string;  // Must match exactly one of the four bundled TTF files
}

export interface SiteConfig {
  siteId:              string;   // "mtw" | "bbpp"
  siteName:            string;   // Displayed in small caps at top of certificate
  certificateTitle:    string;   // Large title line
  recipientLabel:      string;   // Label above the recipient name e.g. "Hereby awarded to"
  achievementLabel:    string;   // Bold label below name e.g. "Master Time Waster"
  achievementSubtitle: string;   // Smaller italic text below achievementLabel
  palette:             Palette;
  fonts:               FontConfig;
  sealAssetUrl:        string;   // Fully-qualified URL to fetch the seal PNG at render time
  r2KeyPrefix:         string;   // e.g. "certs/mtw/" — must end with "/"
}
```

### 5.2 mtw.json

```json
{
  "siteId": "mtw",
  "siteName": "Master Time Waster",
  "certificateTitle": "Certificate of Certified Time Wasting",
  "recipientLabel": "Hereby awarded to",
  "achievementLabel": "Master Time Waster",
  "achievementSubtitle": "In recognition of spectacular, world-class, unapologetic wasting of time",
  "palette": {
    "background": "#fdf6e3",
    "border":     "#8b6914",
    "titleText":  "#3d2b00",
    "bodyText":   "#5c4a1e",
    "accent":     "#c8960c",
    "nameText":   "#2c1810"
  },
  "fonts": {
    "titleFamily": "Playfair Display",
    "bodyFamily":  "Lato"
  },
  "sealAssetUrl": "https://mastertimewaster.com/assets/mtw-seal.png",
  "r2KeyPrefix":  "certs/mtw/"
}
```

### 5.3 bbpp.json

```json
{
  "siteId": "bbpp",
  "siteName": "Big Beautiful Peace Prize",
  "certificateTitle": "The Big Beautiful Peace Prize",
  "recipientLabel": "Presented to",
  "achievementLabel": "Peace Prize Laureate",
  "achievementSubtitle": "In recognition of extraordinary contributions to the art of peaceful coexistence",
  "palette": {
    "background": "#f0f4f8",
    "border":     "#1a4a7a",
    "titleText":  "#0d2844",
    "bodyText":   "#2d4a6a",
    "accent":     "#c9a227",
    "nameText":   "#0d2844"
  },
  "fonts": {
    "titleFamily": "Cormorant Garamond",
    "bodyFamily":  "Source Sans Pro"
  },
  "sealAssetUrl": "https://bigbeautifulpeaceprize.com/assets/bbpp-seal.png",
  "r2KeyPrefix":  "certs/bbpp/"
}
```

⚠️ **OPEN QUESTION — BBPP palette:** The BBPP color palette above is a proposal. Review and adjust
before deploying the `bbpp` environment.

⚠️ **OPEN QUESTION — Seal images:** The `sealAssetUrl` values reference images that may not exist
yet on the parent sites. The render pipeline must handle a failed seal fetch gracefully: if the
seal URL returns a non-200 status, omit the seal image from the layout and render the certificate
without it. Do not throw or return a 500 error.

### 5.4 Config Loader

`src/config.ts` must export a `getConfig(env: Env): SiteConfig` function that:

- Reads `env.SITE_ID` (a `string` injected via `wrangler.toml` vars)
- Returns the corresponding parsed JSON config
- Throws a descriptive `Error` if `SITE_ID` is not `"mtw"` or `"bbpp"`
- Both config objects are statically imported at module level — no dynamic `require()`

---

## 6. Cloudflare Configuration (wrangler.toml)

```toml
name            = "parchment-worker"
main            = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[rules]]
type  = "Data"
globs = ["**/*.ttf"]
fallthrough = true

# ── MTW environment ───────────────────────────────────────────────────────────

[env.mtw]
name = "parchment-worker-mtw"

[env.mtw.vars]
SITE_ID = "mtw"

[[env.mtw.r2_buckets]]
binding     = "PARCHMENT"
bucket_name = "parchment-mtw"

[[env.mtw.routes]]
pattern   = "mastertimewaster.com/parchment/*"
zone_name = "mastertimewaster.com"

# ── BBPP environment ──────────────────────────────────────────────────────────

[env.bbpp]
name = "parchment-worker-bbpp"

[env.bbpp.vars]
SITE_ID = "bbpp"

[[env.bbpp.r2_buckets]]
binding     = "PARCHMENT"
bucket_name = "parchment-bbpp"

[[env.bbpp.routes]]
pattern   = "bigbeautifulpeaceprize.com/parchment/*"
zone_name = "bigbeautifulpeaceprize.com"
```

**Note:** Do not add a `[build]` custom command section. Wrangler bundles TypeScript natively;
a `[build] command = "npm run build"` entry causes infinite recursion (wrangler deploy → custom
build → wrangler deploy → …).

**Note:** The `[[rules]]` glob must be `**/*.ttf` (not `assets/fonts/*.ttf`) because wrangler
matches globs against the resolved file path, which includes the relative prefix from the import
specifier (e.g. `../assets/fonts/...`).

All one-time Cloudflare infrastructure setup is handled by `scripts/cloudflare-setup.sh` (see §17).
Claude Code must write that script but must not execute it.

---

## 7. Env Interface

After scaffolding, run `wrangler types --env mtw` to generate `worker-configuration.d.ts`.
The `--env mtw` flag is required — plain `wrangler types` only sees top-level bindings and omits
`PARCHMENT: R2Bucket`, which is defined per-environment. The generated `Env` interface must include:

```typescript
interface Env {
  SITE_ID:   string;        // "mtw" | "bbpp" — injected via wrangler.toml vars
  PARCHMENT: R2Bucket;      // R2 binding name is "PARCHMENT" in both environments
}
```

Use only the generated `Env` type in `index.ts` and all other source files. Never hand-write the
`Env` interface.

---

## 8. API Surface

The Worker handles exactly two routes. All other paths return 404.

### 8.1 GET /parchment/render

Renders a certificate PNG for the given recipient.

**Query parameters:**

| Param | Required | Type | Constraints |
|---|---|---|---|
| `name` | Yes | string | 1–100 characters after URL-decoding |
| `achievement` | No | string | 1–200 characters after URL-decoding; defaults to `config.achievementSubtitle` if omitted |

**Success response:**

```
HTTP 200 OK
Content-Type: image/png
Cache-Control: public, max-age=31536000, immutable
X-Parchment-Cache: HIT | MISS
X-Parchment-Key: <r2 key used>
Body: <PNG binary>
```

**Error responses:**

```
HTTP 400 Bad Request
Content-Type: application/json

{ "error": "name parameter is required" }
{ "error": "name must be 100 characters or fewer" }
{ "error": "achievement must be 200 characters or fewer" }
```

```
HTTP 500 Internal Server Error
Content-Type: application/json

{ "error": "render failed", "detail": "<error message>" }
```

### 8.2 GET /parchment/health

Liveness check.

**Response:**

```
HTTP 200 OK
Content-Type: application/json

{ "status": "ok", "siteId": "mtw" }
```

### 8.3 All other paths

```
HTTP 404 Not Found
Content-Type: application/json

{ "error": "not found" }
```

---

## 9. Rendering Pipeline

Implemented in `src/render.ts`. The function signature must be:

```typescript
export async function renderCertificate(
  config:      SiteConfig,
  name:        string,
  achievement: string,
  fonts:       FontData[],         // pre-loaded font buffers, see §9.1
): Promise<Uint8Array>             // returns PNG bytes
```

### 9.1 Font Loading

Font files are imported as Worker static assets using Wrangler's `Data` rule. In `src/render.ts`:

```typescript
// Import TTF files as ArrayBuffer (Wrangler Data rule converts them)
import playfairBold          from '../assets/fonts/PlayfairDisplay-Bold.ttf';
import latoRegular           from '../assets/fonts/Lato-Regular.ttf';
import cormorantSemibold     from '../assets/fonts/CormorantGaramond-SemiBold.ttf';
import sourceSansProRegular  from '../assets/fonts/SourceSansPro-Regular.ttf';
```

Build a `FontData[]` array at module level (executed once per isolate):

```typescript
export const ALL_FONTS: FontData[] = [
  { name: 'Playfair Display', data: playfairBold,         weight: 700, style: 'normal' },
  { name: 'Lato',             data: latoRegular,          weight: 400, style: 'normal' },
  { name: 'Cormorant Garamond', data: cormorantSemibold,  weight: 600, style: 'normal' },
  { name: 'Source Sans Pro',  data: sourceSansProRegular, weight: 400, style: 'normal' },
];
```

Pass `ALL_FONTS` into `renderCertificate` from `index.ts`. The render function passes the full
array to Satori — Satori will select the correct font by `name` matching `config.fonts.titleFamily`
and `config.fonts.bodyFamily`.

### 9.2 resvg-wasm Initialization

`@resvg/resvg-wasm` must be initialized exactly once per Worker isolate. Use a module-level
promise:

```typescript
import { initWasm, Resvg }    from '@resvg/resvg-wasm';
import resvgWasm              from '@resvg/resvg-wasm/index_bg.wasm';

const wasmReady: Promise<void> = initWasm(resvgWasm);
```

In `renderCertificate`, `await wasmReady` before using `Resvg`. If `initWasm` has already
resolved, `await wasmReady` returns immediately.

### 9.3 Seal Image Fetching

The seal image is fetched from `config.sealAssetUrl` on each cache-miss render:

- If the fetch succeeds (HTTP 200) and the response Content-Type begins with `image/`:
  - Read the response as `ArrayBuffer`
  - Convert to base64 data URL: `data:<content-type>;base64,<base64string>`
  - Pass the data URL to the template as `sealDataUrl`
- If the fetch fails for any reason (non-200, network error, wrong content type):
  - Set `sealDataUrl = null`
  - Log a warning: `console.warn('parchment: seal fetch failed', config.sealAssetUrl, status)`
  - Continue rendering without the seal

### 9.4 Satori Call

```typescript
import satori from 'satori';

const svg: string = await satori(
  buildTemplate(config, name, achievement, sealDataUrl),
  {
    width:  1200,
    height: 850,
    fonts:  fonts,
  }
);
```

`buildTemplate` is defined in `src/template.ts` (see §10).

### 9.5 PNG Conversion

```typescript
await wasmReady;
const resvg  = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
const png    = resvg.render();
return png.asPng();   // returns Uint8Array
```

---

## 10. Certificate Template

Implemented in `src/template.ts`. Exports one function:

```typescript
export function buildTemplate(
  config:       SiteConfig,
  name:         string,
  achievement:  string,
  sealDataUrl:  string | null,
): object   // Satori node tree — { type, props }
```

### 10.1 Canvas

- Width: 1200px, Height: 850px
- Background: `config.palette.background`
- Outer border: 6px solid `config.palette.border`, inset 20px from all edges (using padding/margin on root)
- Inner decorative rule: 2px solid `config.palette.border`, 40px inside the outer border

All layout uses `display: flex` and `flexDirection`. Satori does not support CSS Grid.

### 10.2 Layout Zones (top to bottom, centered horizontally)

All text is `textAlign: center` unless specified otherwise.

**Zone 1 — Site name** (top, ~60px from inner rule)
- Text: `config.siteName`
- Font: `config.fonts.bodyFamily`, weight 400, size 18px
- Color: `config.palette.bodyText`
- Letter spacing: 4px (small caps feel)
- Text transform: uppercase

**Zone 2 — Certificate title** (below zone 1, margin-top 20px)
- Text: `config.certificateTitle`
- Font: `config.fonts.titleFamily`, weight 700, size 52px
- Color: `config.palette.titleText`

**Zone 3 — Decorative divider** (below zone 2, margin-top 24px)
- Horizontal rule: 1px solid `config.palette.border`, width 480px, centered

**Zone 4 — Recipient label** (below divider, margin-top 28px)
- Text: `config.recipientLabel`
- Font: `config.fonts.bodyFamily`, weight 400, size 20px
- Color: `config.palette.bodyText`
- Font style: italic

**Zone 5 — Recipient name** (below zone 4, margin-top 8px)
- Text: `name` (the query parameter value)
- Font: `config.fonts.titleFamily`, weight 700, size 72px
- Color: `config.palette.nameText`

**Zone 6 — Achievement label** (below zone 5, margin-top 20px)
- Text: `config.achievementLabel`
- Font: `config.fonts.bodyFamily`, weight 400, size 24px
- Color: `config.palette.accent`
- Letter spacing: 2px
- Text transform: uppercase

**Zone 7 — Achievement subtitle** (below zone 6, margin-top 8px)
- Text: `achievement` (the query parameter value, or `config.achievementSubtitle` if omitted)
- Font: `config.fonts.bodyFamily`, weight 400, size 18px
- Color: `config.palette.bodyText`
- Font style: italic
- Max width: 700px, centered, `flexWrap: wrap`

**Zone 8 — Footer row** (bottom, ~48px from inner rule)
- Horizontal flex row, `justifyContent: space-between`, `alignItems: center`
- Left: issue date — `new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })`
  - Font: `config.fonts.bodyFamily`, size 14px, color `config.palette.bodyText`
- Center: seal image (if `sealDataUrl !== null`)
  - `<img>` element, width 80px, height 80px, `objectFit: contain`
  - If `sealDataUrl === null`: empty `<div>` with width 80px (preserve spacing)
- Right: `config.siteName`
  - Font: `config.fonts.bodyFamily`, size 14px, color `config.palette.bodyText`

---

## 11. R2 Caching

Implemented in `src/r2.ts`.

### 11.1 Cache Key Generation

```typescript
export function buildCacheKey(prefix: string, name: string, achievement: string): string
```

- Concatenate `prefix + slug(name) + "-" + slug(achievement) + ".png"`
- `slug()` lowercases, replaces all non-alphanumeric characters with `-`, collapses consecutive
  `-` to one, trims leading/trailing `-`
- Example: `"certs/mtw/pete-bowser-napping-champion.png"`
- Maximum key length: 512 characters. If the generated key exceeds 512 characters, truncate
  `slug(achievement)` until it fits, then re-append `.png`.

### 11.2 R2 Get

```typescript
export async function getCached(bucket: R2Bucket, key: string): Promise<Uint8Array | null>
```

- Calls `bucket.get(key)`
- If result is null: return `null`
- Otherwise: return `new Uint8Array(await result.arrayBuffer())`

### 11.3 R2 Put

```typescript
export async function putCached(bucket: R2Bucket, key: string, png: Uint8Array): Promise<void>
```

- Calls `bucket.put(key, png, { httpMetadata: { contentType: 'image/png' } })`
- Does not return the R2 object — fire and forget (but do `await` the put before returning the
  response, so the cache is populated before the response is sent)

---

## 12. Worker Entrypoint (src/index.ts)

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>
}
```

### 12.1 Request Routing

Parse `new URL(request.url).pathname` and route:

| Pathname | Handler |
|---|---|
| `/parchment/render` | §12.2 |
| `/parchment/health` | §12.3 |
| anything else | return 404 JSON |

Only `GET` requests are handled. Any other HTTP method returns:
```
HTTP 405 Method Not Allowed
Content-Type: application/json
{ "error": "method not allowed" }
```

### 12.2 Render Handler

```
1. Parse URL search params: name, achievement
2. Validate name:
   - If missing or empty string → 400 { "error": "name parameter is required" }
   - If length > 100 → 400 { "error": "name must be 100 characters or fewer" }
3. Validate achievement (if present):
   - If length > 200 → 400 { "error": "achievement must be 200 characters or fewer" }
4. Load config: const config = getConfig(env)
5. Resolve achievement: const ach = achievement ?? config.achievementSubtitle
6. Build cache key: const key = buildCacheKey(config.r2KeyPrefix, name, ach)
7. Check R2: const cached = await getCached(env.PARCHMENT, key)
8. If cached !== null:
   - Return Response(cached, { status: 200, headers: {
       'Content-Type': 'image/png',
       'Cache-Control': 'public, max-age=31536000, immutable',
       'X-Parchment-Cache': 'HIT',
       'X-Parchment-Key': key,
     }})
9. If cached === null:
   - Try:
     - const png = await renderCertificate(config, name, ach, ALL_FONTS)
     - await putCached(env.PARCHMENT, key, png)
     - Return Response(png, { status: 200, headers: {
         'Content-Type': 'image/png',
         'Cache-Control': 'public, max-age=31536000, immutable',
         'X-Parchment-Cache': 'MISS',
         'X-Parchment-Key': key,
       }})
   - Catch (err):
     - console.error('parchment: render error', err)
     - Return 500 JSON { "error": "render failed", "detail": String(err) }
```

### 12.3 Health Handler

```typescript
return Response.json({ status: 'ok', siteId: env.SITE_ID });
```

---

## 13. package.json

```json
{
  "name": "parchment",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev":        "wrangler dev --env mtw",
    "build":      "wrangler deploy --dry-run --outdir dist --env mtw",
    "deploy:mtw": "wrangler deploy --env mtw",
    "deploy:bbpp":"wrangler deploy --env bbpp",
    "types":      "wrangler types --env mtw",
    "lint":       "eslint src --ext .ts",
    "typecheck":  "tsc --noEmit",
    "fonts":      "bash scripts/download-fonts.sh",
    "setup:cf":   "bash scripts/cloudflare-setup.sh"
  },
  "dependencies": {
    "satori":           "^0.10.x",
    "@resvg/resvg-wasm":"^2.x"
  },
  "devDependencies": {
    "typescript":                "^5.x",
    "wrangler":                  "^3.x",
    "@cloudflare/workers-types": "^4.x",
    "eslint":                    "^8.x",
    "@typescript-eslint/parser": "^7.x",
    "@typescript-eslint/eslint-plugin": "^7.x"
  }
}
```

---

## 14. tsconfig.json

```json
{
  "compilerOptions": {
    "target":           "ES2022",
    "module":           "ES2022",
    "moduleResolution": "bundler",
    "lib":              ["ES2022"],
    "types":            ["@cloudflare/workers-types"],
    "strict":           true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "allowImportingTsExtensions": true,
    "noEmit":           true,
    "skipLibCheck":     true
  },
  "include": ["src", "worker-configuration.d.ts"]
}
```

---

## 15. CLAUDE.md (create in repo root)

```markdown
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
```

---

## 16. scripts/cloudflare-setup.sh

This script performs all one-time Cloudflare infrastructure setup. Claude Code must write this
script but must NOT execute it. The developer runs it manually after review.

```bash
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
```

**Notes for Claude Code:**
- Write this file to `scripts/cloudflare-setup.sh` and make it executable (`chmod +x`)
- Do not run this script during implementation
- The `npm run setup:cf` script in package.json provides a named entry point for documentation
  purposes — it must not be invoked by Claude Code either

---

## 17. scripts/download-fonts.sh

```bash
#!/usr/bin/env bash
set -euo pipefail

FONTS_DIR="$(dirname "$0")/../assets/fonts"
mkdir -p "$FONTS_DIR"

echo "Downloading fonts..."
# Google Fonts static TTF instances via the CSS2 API (legacy UA returns truetype format).
# Playfair Display, Cormorant Garamond, and Source Sans Pro are variable-font-only on the
# Google Fonts GitHub repo; static weight instances must be fetched from fonts.gstatic.com.
GFONTS_UA="Mozilla/5.0"

get_ttf_url() {
  curl -sA "$GFONTS_UA" "https://fonts.googleapis.com/css2?family=$1&display=swap" \
    | grep -o 'url([^)]*\.ttf)' | sed 's/url(//' | sed 's/)//'
}

PLAYFAIR_URL=$(get_ttf_url "Playfair+Display:wght@700")
LATO_URL=$(get_ttf_url "Lato:wght@400")
CORMORANT_URL=$(get_ttf_url "Cormorant+Garamond:wght@600")
SOURCESANS_URL=$(get_ttf_url "Source+Sans+3:wght@400")

curl -sL -o "$FONTS_DIR/PlayfairDisplay-Bold.ttf"       "$PLAYFAIR_URL"
curl -sL -o "$FONTS_DIR/Lato-Regular.ttf"               "$LATO_URL"
curl -sL -o "$FONTS_DIR/CormorantGaramond-SemiBold.ttf" "$CORMORANT_URL"
curl -sL -o "$FONTS_DIR/SourceSansPro-Regular.ttf"      "$SOURCESANS_URL"

echo "Done. Fonts in $FONTS_DIR"
```

**NOTE:** Google Fonts GitHub no longer ships static-weight TTF files for Playfair Display,
Cormorant Garamond, or Source Sans Pro — they are variable-font-only. The script above fetches
static weight instances directly from `fonts.gstatic.com` via the CSS2 API. Claude Code must
verify all four files exist and are valid TrueType files (`file` reports `TrueType Font data`)
after running the script.

---

## 18. .gitignore additions

```
assets/fonts/*.ttf
dist/
worker-configuration.d.ts
.wrangler/
node_modules/
```

---

## 19. Quality Gates

Claude Code must verify all of the following before declaring the implementation complete:

- [ ] **FR-Q1:** `npm run typecheck` exits with code 0 and zero errors (TypeScript strict mode)
- [ ] **FR-Q2:** `npm run lint` exits with code 0 and zero errors
- [ ] **FR-Q3:** `npm run build` (dry-run deploy) completes without error for both environments
- [ ] **FR-Q4:** `wrangler dev --env mtw` starts without error
- [ ] **FR-Q5:** `GET http://localhost:8787/parchment/health` returns `{"status":"ok","siteId":"mtw"}`
- [ ] **FR-Q6:** `GET http://localhost:8787/parchment/render?name=Test+User` returns a valid PNG
  (Content-Type: image/png, non-empty body, file is a valid PNG — verify with `file` command)
- [ ] **FR-Q7:** A second identical request returns `X-Parchment-Cache: HIT`
- [ ] **FR-Q8:** `GET http://localhost:8787/parchment/render` (no name) returns HTTP 400 with
  `{"error":"name parameter is required"}`
- [ ] **FR-Q9:** No `any` types anywhere in `src/` — confirmed by typecheck with `strict: true`
- [ ] **FR-Q10:** `worker-configuration.d.ts` is generated (not hand-written) and gitignored

---

## 20. Out of Scope (do not build)

- HTML form UI — forms live on mastertimewaster.com and bigbeautifulpeaceprize.com, not here
- Authentication, API keys, or rate limiting on the render endpoint
- PDF generation
- Cache invalidation or R2 key deletion
- Printful API integration
- Analytics or custom logging beyond `console.log`/`console.error`
- A third environment or site
- Multiple certificate templates or layouts per site
- Image upload for seal files
- Any database (D1, KV) — R2 is the only storage primitive used

---

*End of PARCHMENT.md*
