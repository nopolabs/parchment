# PARCHMENT — Technical Reference

**Parchment** is a single shared Cloudflare Worker that generates award certificate
images (PNG) on demand for multiple sites. Site identity is selected per-request by
the `X-Site-ID` header, injected by each site's Cloudflare Pages Function proxy.

**GitHub repo:** `nopolabs/parchment`
**Runtime:** Cloudflare Workers (TypeScript strict mode)
**Output:** `image/png` — 1200×850px certificate image (scalable to 4× for print)
and 2700×1050px 11 oz mug artwork.

For setup and daily commands, see `CLAUDE.md`. This document is the reference for
the API, data model, and infrastructure.

---

## Sites

One worker, one set of infrastructure, N sites. Adding a site requires no new
Cloudflare resources — only a config file, a `src/config.ts` case, a secret, and
a Pages Function header (see "Adding a new site" in `CLAUDE.md`).

| Site ID | Site | Issue secret |
|---|---|---|
| `mtw` | mastertimewaster.com | `MTW_ISSUE_API_KEY` |
| `bbpp` | bigbeautifulpeaceprize.com | `BBPP_ISSUE_API_KEY` |

Preferred public Worker host:

```
https://parchment.nopolabs.com
```

The original `workers.dev` hostname still works and is useful as a fallback or
debugging endpoint:

```
https://parchment-worker.danrevel.workers.dev
```

All public traffic reaches parchment through the Pages Function proxies, which
enforce Cloudflare Turnstile and inject `X-Site-ID` plus the bearer token.

---

## API

Every request must carry an `X-Site-ID` header naming a known site.
Unknown or missing site ID → `400 { "error": "unknown site: \"...\"" }`.

### GET /parchment/health

Liveness check.

```
200 OK
{ "status": "ok", "siteId": "mtw" }
```

---

### GET /parchment/cert/render

Returns a **preview** PNG synchronously. The footer shows `PREVIEW` instead of a
serial number. No D1 record is created and no email is sent. Cached in R2 under
`previews/{siteId}/`.

`GET /parchment/render` is retained as a deprecated alias for backward
compatibility. It returns the same image response plus:

```
Deprecation: true
Link: </parchment/cert/render>; rel="successor-version"
```

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

Issues an official certificate. The D1 record — serial number (e.g. `MTW-0042`)
and personalization token — is created **synchronously in the handler**, so the
token exists when the 202 returns (the awarder's print upsell depends on it).
The slow work — render + email — is queued for the consumer.

**Authentication required.** Every request must carry:

```
Authorization: Bearer <SITEID_ISSUE_API_KEY>
```

Missing or incorrect key → `401 { "error": "unauthorized" }`. The key is per
site (`MTW_ISSUE_API_KEY`, `BBPP_ISSUE_API_KEY`), set via
`npx wrangler secret put <SITEID>_ISSUE_API_KEY`, and must match the
`PARCHMENT_API_KEY` secret in the corresponding Cloudflare Pages project.

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
{ "status": "queued", "personalization_id": "tok_..." }
```

**Error responses** (in addition to the render-style 400s):

```
401 { "error": "unauthorized" }
429 { "error": "A certificate has already been issued to this email today" }
```

**Behavior:**
- **Rate limit:** one certificate per email per site per day (the 429 above).
- **Re-issue dedup:** the same name + achievement maps to the same R2 key; the
  handler finds the existing record and returns its existing serial and token.
  A pre-token record (issued before migration 0002) gains a token lazily on
  re-issue — never overwritten once set.

---

### GET|HEAD /parchment/cert/&lt;token&gt;

Resolves a personalization token to the official certificate PNG.

The token is an unguessable capability minted at issue time. Possession
authorizes exactly two things: viewing the PNG and (on the site) buying a print
of it. Nothing else — in particular the recipient's email — is resolvable from
one. Lookups are site-scoped: a token issued for one site 404s under another
site's `X-Site-ID`.

**Query parameters:**

| Param | Required | Constraints |
|---|---|---|
| `scale` | No | Integer 1–4; defaults to 1 |

`?scale=N` rasterizes the same Satori SVG at N× — text and borders stay crisp
because the source is vector (scale 3 → 3600×2550, true 300 DPI at 12×8.5″).
Scaled renders are cached in R2 as `<key>@Nx.png`.

`HEAD` is the cheap existence check (used by clodsite checkout validation
before creating a Stripe session). `GET` renders on demand if the queue hasn't
run yet (or the scale is new), using the same render path as the consumer.

**Success response:**

```
200 OK
Content-Type: image/png
Cache-Control: no-store
```

Responses are `no-store` because the token is the URL — CDN caches must not
hold capability-addressed content.

**Error responses:**

```
400 { "error": "scale must be an integer between 1 and 4" }
404 { "error": "not found" }   // unknown, malformed, or cross-site token
500 { "error": "render failed", "detail": "..." }
```

---

### GET /parchment/mug/render

Returns a **preview** 11 oz mug artwork PNG synchronously. No D1 record is
created and no email is sent. Cached in R2 under `previews/{siteId}/mugs/`.

The artwork is 2700×1050px: one face is a large seal; the other is a compact
certificate-style plaque. Achievement text is never truncated. It wraps and
adapts font size inside the space between the achievement label and footer.

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

**Error responses:** same as `GET /parchment/cert/render`.

---

### GET|HEAD /parchment/mug/&lt;token&gt;

Resolves a personalization token to official 11 oz mug artwork PNG.

The token rules are the same as `/parchment/cert/<token>`: possession authorizes
viewing/rendering the artwork, lookups are site-scoped, and malformed or
cross-site tokens return 404.

`HEAD` is the cheap existence check. `GET` renders on demand and caches the
artwork in R2 using a derived key under `mugs/{siteId}/...@11oz.png`.

**Success response:**

```
200 OK
Content-Type: image/png
Cache-Control: no-store
```

Responses are `no-store` because the token is the URL — CDN caches must not
hold capability-addressed content.

**Error responses:**

```
404 { "error": "not found" }   // unknown, malformed, or cross-site token
500 { "error": "render failed", "detail": "..." }
```

---

### All other paths

```
404 { "error": "not found" }
```

---

## Personalization tokens

Defined in `src/token.ts`. Format: `tok_` + 128 random bits
(`crypto.getRandomValues`), base64url-encoded — e.g. `tok_BYdie7-kZkkEqw-sNMsc3A`.
Accepted pattern: `^[A-Za-z0-9_-]{16,64}$`.

Serials (`BBPP-0042`) are sequential and guessable — they are display
identifiers, never capabilities. Tokens and serials are stored side by side in
the same D1 row.

When `SiteConfig.emailCta` is set (currently bbpp only), the certificate email
includes a configurable token-backed call to action with `{token}` substituted
in the CTA URL. This feeds clodsite's bbpp certificate commerce — see
`clodsite/docs/superpowers/specs/2026-06-11-bbpp-certificate-commerce-design.md`.

---

## Queue consumer flow

The consumer (`src/queue.ts`, exported from `src/index.ts` alongside the fetch
handler) receives `{ siteId, name, achievement, email, serial, token }`:

1. If `serial` is absent (legacy message from before the insert moved into
   `/issue`): find-or-insert the D1 record, minting a token if needed
2. Check R2 for the cached PNG → if absent: render with serial → store in R2
3. Send the certificate PNG as an email attachment via Resend, appending the
   configured email CTA when `emailCta` and a token are available

Email failures are non-fatal (logged, message still acked); render/DB failures
trigger a queue retry.

---

## Certificate layout

1200×850px, rendered by Satori (SVG) → resvg-wasm (PNG). `scale` only changes
the rasterization width (`fitTo: { mode: 'width', value: 1200 * scale }`).

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

Defined in `src/config.ts`. All sites share the same interface.

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
  emailCta?: {                  // optional email CTA; "{token}" substituted in url
    url:      string;
    linkText: string;
    prefix?:  string;
    suffix?:  string;
  };
  printOfferUrl?:      string;   // deprecated generic keepsake URL fallback
}
```

---

## Infrastructure

One shared instance of each resource, bound in `wrangler.toml`.

The Worker is attached to the preferred custom domain
`parchment.nopolabs.com` via Wrangler:

```toml
[[routes]]
pattern = "parchment.nopolabs.com"
custom_domain = true
```

Do not create a manual CNAME first; Cloudflare creates the needed DNS record
when the Worker custom domain is deployed.

### R2 — bucket `parchment` (binding `PARCHMENT`)
Permanent PNG cache. Keys are never deleted (except deliberately, to force a
re-render after template changes). Key namespaces:
- `previews/{siteId}/` — preview renders (no serial)
- `previews/{siteId}/mugs/` — preview 11 oz mug artwork
- `certs/{siteId}/` — official renders (with serial, logged in D1)
- `certs/{siteId}/<key>@Nx.png` — scaled print-resolution renders
- `mugs/{siteId}/<key>@11oz.png` — official token-backed 11 oz mug artwork

### D1 — database `parchment-log` (binding `PARCHMENT_LOG`)
Schema after migrations 0001 + 0002:

```sql
CREATE TABLE certificates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  achievement TEXT    NOT NULL,
  r2_key      TEXT    NOT NULL UNIQUE,
  serial      TEXT    NOT NULL,  -- e.g. "MTW-0042"
  email       TEXT,
  token       TEXT,              -- personalization token; UNIQUE index
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_certificates_token ON certificates (token);
```

Migrations live in `migrations/` and are applied with
`npx wrangler d1 migrations apply parchment-log --remote` (tracked in D1's
migrations table; safe to re-run). Apply migrations **before** deploying worker
code that depends on them.

### Queue — `parchment-queue` (binding `PARCHMENT_QUEUE`)
Producer and consumer in the same worker. Max batch size: 10. Max batch
timeout: 30s.

### Email
Sent via [Resend](https://resend.com). Both sites currently send from
`awards@mastertimewaster.com`.

### Secrets

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend email delivery |
| `MTW_ISSUE_API_KEY` | Bearer token for `POST /parchment/issue` with `X-Site-ID: mtw` |
| `BBPP_ISSUE_API_KEY` | Bearer token for `POST /parchment/issue` with `X-Site-ID: bbpp` |

Set via `npx wrangler secret put <NAME>` — never stored in `wrangler.toml`.
Local development uses dummy values in `.dev.vars` (gitignored).
Secret names are declared in `src/secrets-env.d.ts` (a declaration merge on
`Env` — wrangler cannot introspect secrets into generated types).

### Fonts
Four TTF files bundled as Worker static assets via a Wrangler `Data` rule.
Downloaded by `npm run fonts` into `assets/fonts/` (gitignored).

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
| `src/index.ts` | Entrypoint, router (X-Site-ID), queue export |
| `src/config.ts` | `SiteConfig` type + `getConfig()` / `getIssueApiKey()` |
| `src/token.ts` | Personalization token mint + pattern |
| `src/render.ts` | Satori + resvg-wasm pipeline (with `scale`) |
| `src/cert-template.ts` | Certificate layout (Satori node tree, no React) |
| `src/mug-template.ts` | 11 oz mug artwork layout (Satori node tree, no React) |
| `src/r2.ts` | R2 cache key builder + get/put helpers |
| `src/db.ts` | D1 helpers: find/insert records, token lookup + lazy backfill |
| `src/queue.ts` | Queue consumer: render → email |
| `src/email.ts` | Resend email sender (+ optional print-offer link) |
| `src/secrets-env.d.ts` | Declaration merge extending `Env` with secret fields |
| `config/mtw.json` | Master Time Waster site config |
| `config/bbpp.json` | Big Beautiful Peace Prize site config |
| `migrations/0001_create_certificates.sql` | Base D1 schema |
| `migrations/0002_add_certificate_token.sql` | `token` column + unique index |

---

## Conventions

- No React. Satori object tree API only (`{ type, props }`).
- No `any` types. Run `npm run lint` and `npm run typecheck` before committing.
- No hand-written `Env` interface — always regenerate via `npm run types`.
  Exception: `src/secrets-env.d.ts` extends `Env` with secret fields.
- resvg-wasm initialized once at module level via a promise (`wasmReady`).
- R2 cert PNGs are the canonical rendered output. Only delete a cert key to
  force a re-render after template changes; the next issuance or token
  resolution re-renders and re-caches.
- Seal image fetch failures are non-fatal; certificate renders without the seal.
- Tokens are capabilities: never log them, never use serials in their place,
  and keep `/parchment/cert/` responses `no-store`.
- Cloudflare infrastructure changes go through `scripts/cloudflare-setup.sh`,
  run manually by the operator — never automated.
- Secrets set via `wrangler secret put` — never stored in `wrangler.toml`.
