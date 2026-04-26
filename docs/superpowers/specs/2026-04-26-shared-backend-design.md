# Shared Backend Design

**Date:** 2026-04-26
**Status:** Approved

## Problem

Parchment currently deploys as two isolated Cloudflare environments — one for MasterTimeWaster (mtw) and one for BigBeautifulPeacePrize (bbpp). Each environment has its own R2 bucket, D1 database, queue, and worker. Adding a new certificate site requires provisioning all four resources and managing a second (third, etc.) deployment.

The code is already multi-tenant: D1 rows carry `site_id`, R2 keys are prefixed per-site, and site config is loaded from JSON files. The isolation is purely at the infrastructure binding level and provides no meaningful benefit.

## Goal

Collapse to a single shared worker, R2 bucket, D1 database, and queue. Adding a new certificate should require only: a new config JSON file, two new secrets, one deploy, and a new Pages site pointed at the shared worker.

## Architecture

```
mastertimewaster.com        bigbeautifulpeaceprize.com
  Pages (mtw4)                Pages (bbpp)
  PARCHMENT_BASE_URL ─────────────────┐
  PARCHMENT_API_KEY (mtw)             │  (same URL)
                                      ▼
                          parchment-worker (single)
                          ┌─────────────────────────┐
                          │  R2: parchment           │
                          │  D1: parchment-log       │
                          │  Queue: parchment-queue  │
                          └─────────────────────────┘
```

Both Pages sites set `PARCHMENT_BASE_URL` to the same shared worker URL. Site identity flows from Pages Function → worker via a hardcoded `X-Site-ID` request header.

## Cloudflare Resources

| Resource | Before | After |
|---|---|---|
| R2 buckets | `parchment-mtw`, `parchment-bbpp` | `parchment` |
| D1 databases | `parchment-log-mtw`, `parchment-log-bbpp` | `parchment-log` |
| Queues | `parchment-queue-mtw`, `parchment-queue-bbpp` | `parchment-queue` |
| Workers | `parchment-worker-mtw`, `parchment-worker-bbpp` | `parchment-worker` |

## Worker Changes (`~/dev/parchment`)

### `src/config.ts`
- `getConfig(env: Env)` → `getConfig(siteId: string)`
- `Env` type loses `SITE_ID`
- `Env` gains per-site API key vars: `MTW_ISSUE_API_KEY`, `BBPP_ISSUE_API_KEY`, etc.
- `RESEND_API_KEY` remains a single shared secret

### `src/index.ts`
- Read site identity from `request.headers.get('X-Site-ID')`
- Return 400 if header is missing or maps to no known config
- Auth validation reads the site-specific key dynamically:
  ```ts
  const expectedKey = env[`${siteId.toUpperCase()}_ISSUE_API_KEY`];
  ```

### `src/queue.ts`
- `IssueMessage` gains an explicit `siteId: string` field
- Queue handler reads `message.body.siteId` to load config instead of `env.SITE_ID`

### `wrangler.toml`
- Remove `[env.mtw]` and `[env.bbpp]` sections
- Single top-level config with one R2, D1, and queue binding
- `SITE_ID` var removed
- Deploy scripts: `deploy:mtw` and `deploy:bbpp` → single `deploy`

### No changes needed
`render.ts`, `template.ts`, `r2.ts`, `db.ts`, `email.ts` — all take `config` or `siteId` as arguments already.

## Pages Function Changes (`~/dev/mtw4`, `~/dev/bbpp`)

### `functions/parchment/[[path]].ts` — both repos

Add `X-Site-ID` header (hardcoded per repo) to all forwarded requests:

**mtw4:** `'X-Site-ID': 'mtw'`
**bbpp:** `'X-Site-ID': 'bbpp'`

Applied in both the issue path and the transparent proxy path. No new env vars — the value is hardcoded since it's a fixed property of each site.

## Migration Strategy

Steps 1–4 have no user impact. Step 5 is the cutover.

1. **Update Pages Functions** — add `X-Site-ID` to both repos and deploy. Old workers silently ignore the header.
2. **Create shared infra** — new R2 bucket `parchment`, D1 database `parchment-log`, queue `parchment-queue`.
3. **Migrate D1 data** — `wrangler d1 export` from both old DBs; import both into `parchment-log`. Serials (`MTW-0042`, `BBPP-0007`) are already namespaced so there are no conflicts.
4. **Copy R2 objects** — copy all objects from `parchment-mtw` and `parchment-bbpp` into `parchment`. No key renaming needed (prefixes already differ).
5. **Deploy shared worker** — apply code changes and new `wrangler.toml`; update `PARCHMENT_BASE_URL` on both Pages sites to the new worker URL. Both sites cut over.
6. **Verify** — hit `/parchment/health` on both sites; do a test render on each; confirm D1 writes and R2 reads work.
7. **Tear down old infra** — delete `parchment-worker-mtw`, `parchment-worker-bbpp`, old R2 buckets, old D1 databases, old queues.

**Rollback:** revert `PARCHMENT_BASE_URL` on each Pages site; old workers remain live until step 7.

## Adding a New Certificate (Post-Migration)

1. Add `config/xyz.json` with site branding
2. Add `XYZ_ISSUE_API_KEY` secret to the shared worker: `wrangler secret put XYZ_ISSUE_API_KEY`
3. `npm run deploy`
4. Create new Pages site; set `PARCHMENT_BASE_URL` to shared worker URL and `PARCHMENT_API_KEY` to the XYZ key
5. Hardcode `X-Site-ID: xyz` in the new Pages Function

No new R2 buckets, D1 databases, or queues.
