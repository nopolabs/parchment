# mtw4 Turnstile + Proxy Pages Function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cloudflare Turnstile widget to the certificate form and a catch-all Pages Function that verifies the Turnstile token and proxies all `/parchment/*` requests to the parchment `workers.dev` endpoint with an API key header.

**Architecture:** The Pages Function at `functions/parchment/[[path]].ts` intercepts all `/parchment/*` domain traffic. For `POST /parchment/issue` it verifies the Turnstile token server-side before forwarding with `Authorization: Bearer`. All other paths proxy transparently. The Send Certificate button is disabled until Turnstile resolves client-side.

**Tech Stack:** Vanilla JavaScript, Liquid templates (Eleventy), Cloudflare Pages Functions (TypeScript), Wrangler 3.x

**Run the parchment plan first.** This plan assumes `parchment-worker-mtw` is already deployed with `ISSUE_API_KEY` set and domain routes removed.

**Working directory for all steps:** `~/dev/mtw4`

---

### Task 1: Create Turnstile widget in Cloudflare dashboard (manual)

- [ ] **Step 1: Create the widget**

In the Cloudflare dashboard:
1. Go to **Turnstile** in the left sidebar
2. Click **Add widget**
3. Name: `mtw4`
4. Hostname: `mastertimewaster.com`
5. Widget type: **Managed**
6. Click **Create**

- [ ] **Step 2: Record the keys**

The dashboard shows two values — keep them handy for later steps:
- **Site key** (public): goes in the HTML template as `data-sitekey`
- **Secret key** (private): goes in Pages secrets as `TURNSTILE_SECRET_KEY`

---

### Task 2: Add Turnstile to `src/certificate.liquid`

**Files:**
- Modify: `src/certificate.liquid`

The file has three sections: HTML (lines 1–48), CSS (lines 50–140), JavaScript (lines 142–243).

- [ ] **Step 1: Add the Turnstile script tag**

Insert the script tag on a new line just before the opening `<script>` tag at line 142:

```html
<script src="https://challenges.cloudflare.com/turnstile/v1/api.js" async defer></script>

<script>
```

- [ ] **Step 2: Add the Turnstile widget div to the form**

Inside `<form id="cert-form">`, add the widget div between the error paragraph and the submit button. Replace:

```html
      <p id="cert-form-error" class="cert-error" hidden></p>
      <button type="submit" class="buy-button">Preview Certificate</button>
```

With:

```html
      <p id="cert-form-error" class="cert-error" hidden></p>
      <div class="cf-turnstile" data-sitekey="<PASTE-SITE-KEY-HERE>" data-theme="light" data-callback="onTurnstileSuccess"></div>
      <button type="submit" class="buy-button">Preview Certificate</button>
```

Replace `<PASTE-SITE-KEY-HERE>` with the site key from Task 1.

- [ ] **Step 3: Disable the Send Certificate button by default**

Find the Send Certificate button in `#cert-preview-section` (currently around line 39):

```html
      <button type="button" id="cert-send-btn" class="buy-button">Send Certificate</button>
```

Change to:

```html
      <button type="button" id="cert-send-btn" class="buy-button" disabled>Send Certificate</button>
```

- [ ] **Step 4: Add `onTurnstileSuccess` callback**

Inside the IIFE in the `<script>` block, after the line that reads `var anotherBtn = document.getElementById('cert-another-btn');` (currently line 157), add:

```javascript
  window.onTurnstileSuccess = function () {
    sendBtn.disabled = false;
  };
```

- [ ] **Step 5: Add the Turnstile token to the POST body**

In the `sendBtn` click handler, after the lines that build `body` and before the `fetch()` call (currently around lines 218–221):

```javascript
    var body = new URLSearchParams({ name: name, email: email });
    if (achievement) body.set('achievement', achievement);

    fetch('/parchment/issue', {
```

Change to:

```javascript
    var body = new URLSearchParams({ name: name, email: email });
    if (achievement) body.set('achievement', achievement);
    body.set('cf-turnstile-response', turnstile.getResponse());

    fetch('/parchment/issue', {
```

- [ ] **Step 6: Reset Turnstile when sending another certificate**

In the `anotherBtn` click handler (currently around lines 201–207), the button was previously re-enabled on reset. Now it must stay disabled until Turnstile resolves again:

```javascript
  anotherBtn.addEventListener('click', function () {
    form.reset();
    formError.hidden = true;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Send Certificate';
    turnstile.reset();
    showSection('form');
  });
```

(Two changes: `sendBtn.disabled = true` instead of `false`, and `turnstile.reset()` added before `showSection`.)

- [ ] **Step 7: Commit**

```bash
git add src/certificate.liquid
git commit -m "feat: add Turnstile widget to certificate form"
```

---

### Task 3: Create the Pages Function

**Files:**
- Create: `functions/parchment/[[path]].ts`

- [ ] **Step 1: Create the directory**

```bash
mkdir -p functions/parchment
```

- [ ] **Step 2: Create `functions/parchment/[[path]].ts`**

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
    // Buffer body to read Turnstile token, then forward the same bytes.
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
    const result = await verifyRes.json() as { success: boolean };
    if (!result.success) {
      return new Response(JSON.stringify({ error: 'verification failed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Forward full body — parchment ignores the cf-turnstile-response field.
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

- [ ] **Step 3: Commit**

```bash
git add functions/parchment/
git commit -m "feat: add parchment proxy Pages Function with Turnstile verification"
```

---

### Task 4: Set Pages secrets and deploy

- [ ] **Step 1: Find the mtw4 Pages project name**

```bash
npx wrangler pages project list
```

Look for the project associated with mastertimewaster.com. Use that name in the steps below (referred to as `<project-name>`).

- [ ] **Step 2: Set the three Pages secrets**

```bash
echo '<paste-mtw-api-key>'      | npx wrangler pages secret put PARCHMENT_API_KEY    --project-name <project-name>
echo '<paste-parchment-workers-dev-base-url>' | npx wrangler pages secret put PARCHMENT_BASE_URL   --project-name <project-name>
echo '<paste-turnstile-secret>' | npx wrangler pages secret put TURNSTILE_SECRET_KEY --project-name <project-name>
```

Values:
- `PARCHMENT_API_KEY`: the MTW key generated in the parchment plan (Task 3, Step 1)
- `PARCHMENT_BASE_URL`: `https://parchment-worker-mtw.<your-account>.workers.dev` (no trailing slash, no path)
- `TURNSTILE_SECRET_KEY`: the secret key from Cloudflare Turnstile dashboard (Task 1, Step 2)

Each command expected output: `✨ Success! Saved secret PARCHMENT_API_KEY`

- [ ] **Step 3: Deploy**

mtw4 is an Eleventy site — the build output goes to `_site/`. If the CF Pages project is connected to a Git repo and auto-deploys on push, just push your commits:

```bash
git push
```

If you're doing a manual direct-upload deployment instead:

```bash
npx eleventy               # builds into _site/
npx wrangler pages deploy _site --project-name <project-name>
```

Expected: ends with `✨ Deployment complete!` and a deployment URL.

- [ ] **Step 4: Verify Turnstile is present on the certificate page**

Visit `https://mastertimewaster.com/certificate` (or wherever the certificate page is served). Confirm:
- A Turnstile widget appears in the form (may be invisible/auto-resolved for real browsers)
- The **Send Certificate** button is initially disabled (greyed out)
- Within ~1 second the Send Certificate button becomes enabled

- [ ] **Step 5: Verify the proxy protects against raw POSTs**

```bash
# No Turnstile token — should return 403
curl -s -X POST "https://mastertimewaster.com/parchment/issue" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "name=Test&email=test@example.com"
# Expected: {"error":"verification failed"}
```

- [ ] **Step 6: Verify render and health still proxy correctly**

```bash
curl -s "https://mastertimewaster.com/parchment/health"
# Expected: {"status":"ok","siteId":"mtw"}

curl -s "https://mastertimewaster.com/parchment/render?name=Test" \
  --output /tmp/test-mtw.png && file /tmp/test-mtw.png
# Expected: PNG image data
```
