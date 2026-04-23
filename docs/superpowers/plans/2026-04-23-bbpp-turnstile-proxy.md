# bbpp Turnstile + Proxy Pages Function Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Cloudflare Turnstile widget to the award form and a catch-all Pages Function that verifies the Turnstile token and proxies all `/parchment/*` requests to the parchment `workers.dev` endpoint with an API key header.

**Architecture:** Same proxy pattern as mtw4. The Pages Function at `functions/parchment/[[path]].ts` intercepts all `/parchment/*` domain traffic. For `POST /parchment/issue` it verifies the Turnstile token server-side before forwarding with `Authorization: Bearer`. The Award button is disabled until Turnstile resolves.

**Tech Stack:** Vanilla JavaScript, plain HTML, Cloudflare Pages Functions (TypeScript). bbpp has no `package.json` or `wrangler.toml` — it is a static Cloudflare Pages site. Adding a `functions/` directory is all that's needed to activate Pages Functions.

**Run the parchment plan first.** This plan assumes `parchment-worker-bbpp` is already deployed with `ISSUE_API_KEY` set and domain routes removed.

**Working directory for all steps:** `~/dev/bbpp`

---

### Task 1: Create Turnstile widget in Cloudflare dashboard (manual)

- [ ] **Step 1: Create the widget**

In the Cloudflare dashboard:
1. Go to **Turnstile** in the left sidebar
2. Click **Add widget**
3. Name: `bbpp`
4. Hostname: `bigbeautifulpeaceprize.com`
5. Widget type: **Managed**
6. Click **Create**

- [ ] **Step 2: Record the keys**

The dashboard shows two values:
- **Site key** (public): goes in `src/index.html` as `data-sitekey`
- **Secret key** (private): goes in Pages secrets as `TURNSTILE_SECRET_KEY`

---

### Task 2: Add Turnstile to `src/index.html`

**Files:**
- Modify: `src/index.html`

The form is inside `<div id="form-container">` (around lines 360–395). The award button is `<button class="btn btn-award" id="award-btn">`.

- [ ] **Step 1: Add the Turnstile script tag to `<head>`**

Add the script tag inside `<head>`, after the existing Google Fonts `<link>` tags and before the closing `</style>` tag — specifically, just before `</head>` (line 340):

```html
  <script src="https://challenges.cloudflare.com/turnstile/v1/api.js" async defer></script>
</head>
```

- [ ] **Step 2: Add the Turnstile widget div to the form**

Inside `<div class="form-actions">` (currently around lines 379–382), add the widget div between the preview button and the award button:

```html
      <div class="form-actions">
        <button class="btn btn-preview" id="preview-btn" type="button">Preview</button>
        <div class="cf-turnstile" data-sitekey="<PASTE-SITE-KEY-HERE>" data-theme="light" data-callback="onTurnstileSuccess" style="align-self:center"></div>
        <button class="btn btn-award" id="award-btn" type="button" disabled>Award the Prize</button>
      </div>
```

Two changes: widget div added, and `disabled` added to `award-btn`.

Replace `<PASTE-SITE-KEY-HERE>` with the site key from Task 1.

- [ ] **Step 3: Add `onTurnstileSuccess` callback and Turnstile token to POST body**

In the `<script>` block, add the `onTurnstileSuccess` global function just after the `escHtml` function definition (currently the last function, around lines 535–537). Add it before the closing `</script>` tag:

```javascript
    function onTurnstileSuccess() {
      awardBtn.disabled = false;
    }
    window.onTurnstileSuccess = onTurnstileSuccess;
```

- [ ] **Step 4: Add Turnstile token to the award POST body**

In the `awardBtn` click handler, after the lines that build `body` and before the `fetch` call (currently around lines 492–500):

```javascript
      const body = new URLSearchParams({
        name:  nameEl.value.trim(),
        email: emailEl.value.trim(),
      });
      const ach = achievementEl.value.trim();
      if (ach) body.set('achievement', ach);

      try {
        const res = await fetch('/parchment/issue', { method: 'POST', body });
```

Change to:

```javascript
      const body = new URLSearchParams({
        name:  nameEl.value.trim(),
        email: emailEl.value.trim(),
      });
      const ach = achievementEl.value.trim();
      if (ach) body.set('achievement', ach);
      body.set('cf-turnstile-response', turnstile.getResponse());

      try {
        const res = await fetch('/parchment/issue', { method: 'POST', body });
```

- [ ] **Step 5: Reset Turnstile when awarding another prize**

In the `resetBtn` click handler (currently around lines 522–533), `awardBtn.disabled = false` re-enables the button immediately. Change it to stay disabled until Turnstile re-resolves, and call `turnstile.reset()`:

```javascript
    resetBtn.addEventListener('click', () => {
      nameEl.value        = '';
      achievementEl.value = '';
      emailEl.value       = '';
      clearErrors();
      previewArea.hidden  = true;
      previewArea.innerHTML = '';
      awardBtn.disabled   = true;
      awardBtn.textContent = 'Award the Prize';
      turnstile.reset();
      formContainer.hidden = false;
      confirmation.hidden  = true;
    });
```

(Two changes: `awardBtn.disabled = true` instead of `false`, and `turnstile.reset()` added.)

- [ ] **Step 6: Commit**

```bash
git add src/index.html
git commit -m "feat: add Turnstile widget to award form"
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

- [ ] **Step 1: Find the bbpp Pages project name**

```bash
npx wrangler pages project list
```

bbpp has no `package.json` so run this from any directory that has wrangler available, or install it first:

```bash
npm install -g wrangler   # if wrangler is not globally available
wrangler pages project list
```

Look for the project associated with bigbeautifulpeaceprize.com. Use that name below as `<project-name>`.

- [ ] **Step 2: Set the three Pages secrets**

```bash
echo '<paste-bbpp-api-key>'     | wrangler pages secret put PARCHMENT_API_KEY    --project-name <project-name>
echo '<paste-parchment-base-url>' | wrangler pages secret put PARCHMENT_BASE_URL --project-name <project-name>
echo '<paste-turnstile-secret>' | wrangler pages secret put TURNSTILE_SECRET_KEY --project-name <project-name>
```

Values:
- `PARCHMENT_API_KEY`: the BBPP key generated in the parchment plan (Task 3, Step 1)
- `PARCHMENT_BASE_URL`: `https://parchment-worker-bbpp.<your-account>.workers.dev` (no trailing slash, no path)
- `TURNSTILE_SECRET_KEY`: the secret key from Cloudflare Turnstile dashboard (Task 1, Step 2)

Each command expected output: `✨ Success! Saved secret PARCHMENT_API_KEY`

- [ ] **Step 3: Deploy**

bbpp is a static site — deploy the `src/` directory as the Pages root, with `functions/` alongside it:

```bash
wrangler pages deploy src --project-name <project-name>
```

Expected: ends with `✨ Deployment complete!` and a deployment URL.

- [ ] **Step 4: Verify Turnstile is present on the award page**

Visit `https://bigbeautifulpeaceprize.com`. Confirm:
- The Turnstile widget appears between the Preview and Award buttons (may be invisible for real browsers)
- The **Award the Prize** button is initially disabled (greyed out)
- Within ~1 second the Award button becomes enabled

- [ ] **Step 5: Verify the proxy protects against raw POSTs**

```bash
# No Turnstile token — should return 403
curl -s -X POST "https://bigbeautifulpeaceprize.com/parchment/issue" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "name=Test&email=test@example.com"
# Expected: {"error":"verification failed"}
```

- [ ] **Step 6: Verify render and health still proxy correctly**

```bash
curl -s "https://bigbeautifulpeaceprize.com/parchment/health"
# Expected: {"status":"ok","siteId":"bbpp"}

curl -s "https://bigbeautifulpeaceprize.com/parchment/render?name=Test" \
  --output /tmp/test-bbpp.png && file /tmp/test-bbpp.png
# Expected: PNG image data
```
