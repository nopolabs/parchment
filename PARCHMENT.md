# PARCHMENT — Technical Reference

**Parchment** is a Cloudflare Worker that generates award certificate images (PNG) on demand.
It supports two independent deployments from a single codebase.

**GitHub repo:** `nopolabs/parchment`
**Runtime:** Cloudflare Workers (TypeScript strict mode)
**Output:** `image/png` — 1200×850px certificate image

---

## Environments

| Environment | Worker | Site | R2 bucket | D1 database | Queue |
|---|---|---|---|---|---|
| `mtw` | `parchment-worker-mtw` | mastertimewaster.com | `parchment-mtw` | `parchment-log-mtw` | `parchment-queue-mtw` |
| `bbpp` | `parchment-worker-bbpp` | bigbeautifulpeaceprize.com | `parchment-bbpp` | `parchment-log-bbpp` | `parchment-queue-bbpp` |

---

## API

### GET /parchment/health

Liveness check.

```
200 OK
{ "status": "ok", "siteId": "mtw" }
```

---

### GET /parchment/render

Returns a **preview** PNG synchronously. The footer shows `PREVIEW` instead of a serial number.
No D1 record is created and no email is sent. Cached in R2 under `previews/{siteId}/`.

**Query parameters:**

| Param | Required | Constraints |
|---|---|---|
| `name` | Yes | 1–100 characters |
| `achievement` | No | 1–200 characters; defaults to `config.achievementSubtitle` |

**Success response:**

```
200 OK
Content-Type: image/png
Cache-Control: public, max-age=31536000, immutable
X-Parchment-Cache: HIT | MISS
X-Parchment-Key: <r2 key>
```

**Error responses:**

```
400 { "error": "name parameter is required" }
400 { "error": "name must be 100 characters or fewer" }
400 { "error": "achievement must be 200 characters or fewer" }
500 { "error": "render failed", "detail": "..." }
```

---

### POST /parchment/issue

Queues an official certificate issuance. Returns immediately; the queue consumer handles
rendering, logging, and email delivery asynchronously.

**Authentication required.** Every request must carry:

```
Authorization: Bearer <ISSUE_API_KEY>
```

Missing or incorrect key → `401 { "error": "unauthorized" }`. The key is set per environment
via `wrangler secret put ISSUE_API_KEY --env <mtw|bbpp>`. Callers are expected to be the
Cloudflare Pages Function proxies on mastertimewaster.com and bigbeautifulpeaceprize.com,
which also enforce Cloudflare Turnstile verification before forwarding.

Accepts `application/x-www-form-urlencoded` or `application/json`.

**Parameters:**

| Param | Required | Constraints |
|---|---|---|
| `name` | Yes | 1–100 characters |
| `achievement` | No | 1–200 characters; defaults to `config.achievementSubtitle` |
| `email` | Yes | Recipient email address |

**Success response:**

```
202 Accepted
{ "status": "queued" }
```

**Queue consumer flow:**
1. Check D1 for an existing record matching the R2 key
2. If new: INSERT into D1 → get auto-increment id → format serial (e.g. `MTW-0042`)
3. Check R2 for cached PNG → if absent: render with serial → store in R2
4. Send certificate PNG as email attachment via Resend

---

### All other paths

```
404 { "error": "not found" }
```

---

## Certificate layout

1200×850px, rendered by Satori (SVG) → resvg-wasm (PNG).

```
┌─────────────────────────────────────────┐
│  [Site name in small caps]              │
│                                         │
│  [Certificate title — large]            │
│  ─────────────────────                  │
│  [Recipient label — italic]             │
│  [Recipient name — largest]             │
│  [Achievement label — uppercase]        │
│  [Achievement subtitle — italic]        │
│                                         │
│  [Date]      [Seal 200×200]   [Serial]  │
└─────────────────────────────────────────┘
```

All colors, fonts, and copy are driven by per-site JSON config in `config/`.

---

## Site config (`SiteConfig`)

Defined in `src/config.ts`. Both sites share the same interface.

```typescript
interface SiteConfig {
  siteId:              string;   // "mtw" | "bbpp"
  siteName:            string;
  certificateTitle:    string;
  recipientLabel:      string;
  achievementLabel:    string;
  achievementSubtitle: string;
  palette:             Palette;  // background, border, titleText, bodyText, accent, nameText
  fonts:               FontConfig; // titleFamily, bodyFamily
  sealAssetUrl:        string;   // fetched at render time; failure is non-fatal
  r2KeyPrefix:         string;   // e.g. "certs/mtw/"
  fromEmail:           string;   // sender address for Resend
}
```

---

## Infrastructure

### R2
Permanent PNG cache. Keys are never deleted. Two key namespaces per environment:
- `previews/{siteId}/` — preview renders (no serial)
- `certs/{siteId}/` — official renders (with serial, logged in D1)

### D1
One database per environment. Schema:

```sql
CREATE TABLE certificates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  achievement TEXT    NOT NULL,
  r2_key      TEXT    NOT NULL UNIQUE,
  serial      TEXT    NOT NULL,  -- e.g. "MTW-0042"
  email       TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
```

### Queues
One queue per environment. Consumer is exported from `src/index.ts` alongside the fetch handler.
Max batch size: 10. Max batch timeout: 30s.

### Email
Sent via [Resend](https://resend.com). API key stored as `RESEND_API_KEY` Worker secret.
Both environments send from `awards@mastertimewaster.com`.

### Secrets

| Secret | Env | Purpose |
|---|---|---|
| `RESEND_API_KEY` | both | Resend email delivery |
| `DKIM_PRIVATE_KEY` | both | DKIM signing for outbound email |
| `ISSUE_API_KEY` | both | Bearer token required on `POST /parchment/issue` |

Set via:
```bash
npx wrangler secret put ISSUE_API_KEY --env mtw
npx wrangler secret put ISSUE_API_KEY --env bbpp
```

The `ISSUE_API_KEY` for each environment must match the `PARCHMENT_API_KEY` secret set in the
corresponding Cloudflare Pages project (mtw4 / bbpp).

### Access

Both worker environments are exposed **only at their `workers.dev` URLs** — no custom domain
routes are configured. All public traffic reaches parchment through the Pages Function proxies:

| Environment | Workers.dev URL |
|---|---|
| `mtw` | `https://parchment-worker-mtw.danrevel.workers.dev` |
| `bbpp` | `https://parchment-worker-bbpp.danrevel.workers.dev` |

### Fonts
Four TTF files bundled as Worker static assets via Wrangler `Data` rule:

| Family | Weight | Used by |
|---|---|---|
| Playfair Display | 700 | mtw titles |
| Lato | 400 | mtw body |
| Cormorant Garamond | 600 | bbpp titles |
| Source Sans Pro | 400 | bbpp body |

---

## Source files

| File | Purpose |
|---|---|
| `src/index.ts` | Entrypoint, router, queue export |
| `src/config.ts` | `SiteConfig` type + `getConfig()` loader |
| `src/render.ts` | Satori + resvg-wasm pipeline |
| `src/template.ts` | Certificate layout (Satori node tree, no React) |
| `src/r2.ts` | R2 cache key builder + get/put helpers |
| `src/db.ts` | D1 helpers: find and insert certificate records |
| `src/queue.ts` | Queue consumer: render → log → email |
| `src/email.ts` | Resend email sender |
| `config/mtw.json` | Master Time Waster site config |
| `config/bbpp.json` | Big Beautiful Peace Prize site config |
| `migrations/0001_create_certificates.sql` | D1 schema |

---

## Conventions

- No React. Satori object tree API only (`{ type, props }`).
- No `any` types. Run `npm run typecheck` before committing.
- No hand-written `Env` interface — always regenerate via `npm run types`.
- resvg-wasm initialized once at module level via a promise (`wasmReady`).
- R2 is the permanent cache — keys are never deleted.
- Seal image fetch failures are non-fatal; certificate renders without the seal.
- Cloudflare infrastructure changes go through `scripts/cloudflare-setup.sh`, run manually.
- Secrets set via `wrangler secret put` — never stored in `wrangler.toml`.
