# parchment

A Cloudflare Worker that renders and delivers award certificates as PNG images.

Given a recipient name and optional achievement text, it generates a styled certificate, stores it in R2, logs it to D1, and emails it to the recipient via Resend. Two independent deployments share the codebase — one for [Master Time Waster](https://mastertimewaster.com) and one for [Big Beautiful Peace Prize](https://bigbeautifulpeaceprize.com).

## What it does

- `GET /parchment/cert/render` — renders a certificate preview PNG synchronously (no email, no log entry)
- `GET /parchment/mug/render` — renders preview artwork for an 11 oz mug
- `POST /parchment/issue` — queues an official issuance; the queue consumer renders, assigns a serial number, logs to D1, and emails the certificate to the recipient
- `GET /parchment/cert/<token>` — renders token-backed certificate artwork for an issued certificate
- `GET /parchment/mug/<token>` — renders token-backed 11 oz mug artwork for an issued certificate

Certificates are cached in R2 so repeat renders are instant. Each official certificate gets a unique serial number (`MTW-0042`, `BBPP-0007`, etc.).

## Stack

- **Runtime:** Cloudflare Workers (TypeScript)
- **Rendering:** Satori (SVG layout) → resvg-wasm (PNG)
- **Storage:** Cloudflare R2 (PNG cache), D1 (certificate log)
- **Delivery:** Cloudflare Queues + Resend (email with PNG attachment)

## Technical reference

See [PARCHMENT.md](./PARCHMENT.md) for full API docs, certificate layout, infrastructure details, source file map, and conventions.
