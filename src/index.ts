import { getConfig, getIssueApiKey, type SiteConfig } from './config.ts';
import { buildCacheKey, getCached, putCached }      from './r2.ts';
import { renderCertificate, renderMugArtwork, ALL_FONTS } from './render.ts';
import { handleQueue, type IssueMessage }           from './queue.ts';
import { hasRecentCertificate, findCertificate, findCertificateByToken, insertCertificate, setCertificateToken } from './db.ts';
import { mintToken, TOKEN_PATTERN }                 from './token.ts';

function jsonError(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status });
}

function validateNameAndAchievement(name: string, achievement: string | null): Response | null {
  if (!name) {
    return jsonError(400, { error: 'name parameter is required' });
  }
  if (name.length > 100) {
    return jsonError(400, { error: 'name must be 100 characters or fewer' });
  }
  if (achievement !== null && achievement.length > 200) {
    return jsonError(400, { error: 'achievement must be 200 characters or fewer' });
  }
  return null;
}

function mugKeyFromCertificateKey(r2Key: string): string {
  const base = r2Key.startsWith('certs/')
    ? r2Key.replace(/^certs\//, 'mugs/')
    : `mugs/${r2Key}`;
  return base.replace(/\.png$/, '@11oz.png');
}

async function renderCertificatePreview(
  env: Env,
  config: SiteConfig,
  url: URL,
  deprecated: boolean = false,
): Promise<Response> {
  const name        = url.searchParams.get('name') ?? '';
  const achievement = url.searchParams.get('achievement');

  const validationError = validateNameAndAchievement(name, achievement);
  if (validationError !== null) return validationError;

  const ach           = achievement ?? config.achievementSubtitle;
  const previewPrefix = `previews/${config.siteId}/`;
  const key           = buildCacheKey(previewPrefix, name, ach);
  const headers       = {
    'Content-Type':      'image/png',
    'Cache-Control':     'public, max-age=31536000, immutable',
    'X-Parchment-Key':   key,
    ...(deprecated ? {
      'Deprecation': 'true',
      'Link':        '</parchment/cert/render>; rel="successor-version"',
    } : {}),
  };

  const cached = await getCached(env.PARCHMENT, key);
  if (cached !== null) {
    return new Response(cached, {
      status:  200,
      headers: {
        ...headers,
        'X-Parchment-Cache': 'HIT',
      },
    });
  }

  try {
    const png = await renderCertificate(config, name, ach, 'PREVIEW', ALL_FONTS);
    await putCached(env.PARCHMENT, key, png);
    return new Response(png, {
      status:  200,
      headers: {
        ...headers,
        'X-Parchment-Cache': 'MISS',
      },
    });
  } catch (err) {
    console.error('parchment: render error', err);
    return jsonError(500, { error: 'render failed', detail: String(err) });
  }
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url    = new URL(request.url);
    const method = request.method;

    const siteId = request.headers.get('X-Site-ID') ?? '';
    let config: SiteConfig;
    try {
      config = getConfig(siteId);
    } catch {
      return jsonError(400, { error: `unknown site: "${siteId}"` });
    }

    // ── GET /parchment/health ─────────────────────────────────────────────────
    if (url.pathname === '/parchment/health') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });
      return Response.json({ status: 'ok', siteId });
    }

    // ── GET /parchment/cert/render — preview certificate ──────────────────────
    if (url.pathname === '/parchment/cert/render') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });
      return renderCertificatePreview(env, config, url);
    }

    // ── GET /parchment/render — deprecated certificate preview alias ──────────
    if (url.pathname === '/parchment/render') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });
      return renderCertificatePreview(env, config, url, true);
    }

    // ── GET /parchment/mug/render — preview 11 oz mug artwork ────────────────
    if (url.pathname === '/parchment/mug/render') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });

      const name        = url.searchParams.get('name') ?? '';
      const achievement = url.searchParams.get('achievement');

      const validationError = validateNameAndAchievement(name, achievement);
      if (validationError !== null) return validationError;

      const ach           = achievement ?? config.achievementSubtitle;
      const previewPrefix = `previews/${config.siteId}/mugs/`;
      const key           = buildCacheKey(previewPrefix, name, ach);

      const cached = await getCached(env.PARCHMENT, key);
      if (cached !== null) {
        return new Response(cached, {
          status:  200,
          headers: {
            'Content-Type':      'image/png',
            'Cache-Control':     'public, max-age=31536000, immutable',
            'X-Parchment-Cache': 'HIT',
            'X-Parchment-Key':   key,
          },
        });
      }

      try {
        const png = await renderMugArtwork(config, name, ach, 'PREVIEW', ALL_FONTS);
        await putCached(env.PARCHMENT, key, png);
        return new Response(png, {
          status:  200,
          headers: {
            'Content-Type':      'image/png',
            'Cache-Control':     'public, max-age=31536000, immutable',
            'X-Parchment-Cache': 'MISS',
            'X-Parchment-Key':   key,
          },
        });
      } catch (err) {
        console.error('parchment: mug render error', err);
        return jsonError(500, { error: 'render failed', detail: String(err) });
      }
    }

    // ── POST /parchment/issue — queue official certificate issuance ───────────
    if (url.pathname === '/parchment/issue') {
      if (method !== 'POST') return jsonError(405, { error: 'method not allowed' });

      const apiKey     = getIssueApiKey(siteId, env);
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !apiKey || authHeader !== `Bearer ${apiKey}`) {
        return jsonError(401, { error: 'unauthorized' });
      }

      let name: string;
      let achievement: string | null;
      let email: string;

      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = await request.json<Record<string, string>>();
        name        = body['name']        ?? '';
        achievement = body['achievement'] ?? null;
        email       = body['email']       ?? '';
      } else {
        const form  = await request.formData();
        name        = (form.get('name')        as string | null) ?? '';
        achievement = (form.get('achievement') as string | null);
        email       = (form.get('email')       as string | null) ?? '';
      }

      if (!name) {
        return jsonError(400, { error: 'name parameter is required' });
      }
      if (name.length > 100) {
        return jsonError(400, { error: 'name must be 100 characters or fewer' });
      }
      if (achievement !== null && achievement.length > 200) {
        return jsonError(400, { error: 'achievement must be 200 characters or fewer' });
      }
      if (!email) {
        return jsonError(400, { error: 'email parameter is required' });
      }

      if (await hasRecentCertificate(env.PARCHMENT_LOG, config.siteId, email)) {
        return jsonError(429, { error: 'A certificate has already been issued to this email today' });
      }

      // The D1 record (and its personalization token) is created here,
      // synchronously, so the token exists when this 202 returns — the
      // awarder's print upsell depends on it. The queue keeps the slow work:
      // render + email. Re-issuing the same name + achievement finds the
      // existing record and returns its existing token (minting one lazily
      // for pre-token records).
      const ach   = achievement ?? config.achievementSubtitle;
      const r2Key = buildCacheKey(config.r2KeyPrefix, name, ach);

      let serial: string;
      let token:  string;
      const existing = await findCertificate(env.PARCHMENT_LOG, r2Key);
      if (existing) {
        serial = existing.serial;
        if (existing.token !== null) {
          token = existing.token;
        } else {
          token = mintToken();
          await setCertificateToken(env.PARCHMENT_LOG, existing.id, token);
        }
      } else {
        token  = mintToken();
        serial = await insertCertificate(env.PARCHMENT_LOG, config.siteId, name, ach, r2Key, email, token);
      }

      const msg: IssueMessage = { siteId, name, achievement: ach, email, serial, token };
      await env.PARCHMENT_QUEUE.send(msg);

      return Response.json({ status: 'queued', personalization_id: token }, { status: 202 });
    }

    // ── GET|HEAD /parchment/cert/<token> — resolve a personalization token ────
    // The token is the capability: possession authorizes viewing the official
    // PNG (and, on the site, buying a print of it). HEAD is the existence
    // check clodsite checkout uses before creating a Stripe session;
    // ?scale=3 is the print-resolution render the fulfillment email links to.
    // Responses are no-store: the token is the URL, and CDN caches should not
    // hold capability-addressed content.
    if (url.pathname.startsWith('/parchment/cert/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        return jsonError(405, { error: 'method not allowed' });
      }

      const token = url.pathname.slice('/parchment/cert/'.length);
      if (!TOKEN_PATTERN.test(token)) {
        return jsonError(404, { error: 'not found' });
      }

      const scaleParam = url.searchParams.get('scale');
      const scale      = scaleParam === null ? 1 : Number(scaleParam);
      if (!Number.isInteger(scale) || scale < 1 || scale > 4) {
        return jsonError(400, { error: 'scale must be an integer between 1 and 4' });
      }

      const record = await findCertificateByToken(env.PARCHMENT_LOG, config.siteId, token);
      if (record === null) {
        return jsonError(404, { error: 'not found' });
      }

      const headers = {
        'Content-Type':  'image/png',
        'Cache-Control': 'no-store',
      };
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }

      const key = scale === 1
        ? record.r2_key
        : record.r2_key.replace(/\.png$/, `@${scale}x.png`);

      let png = await getCached(env.PARCHMENT, key);
      if (png === null) {
        // The queue may not have rendered yet (or this is a new scale) —
        // render on demand with the same find-or-render path the consumer uses.
        try {
          png = await renderCertificate(config, record.name, record.achievement, record.serial, ALL_FONTS, scale);
          await putCached(env.PARCHMENT, key, png);
        } catch (err) {
          console.error('parchment: render error', err);
          return jsonError(500, { error: 'render failed', detail: String(err) });
        }
      }
      return new Response(png, { status: 200, headers });
    }

    // ── GET|HEAD /parchment/mug/<token> — 11 oz mug artwork ──────────────────
    if (url.pathname.startsWith('/parchment/mug/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        return jsonError(405, { error: 'method not allowed' });
      }

      const token = url.pathname.slice('/parchment/mug/'.length);
      if (!TOKEN_PATTERN.test(token)) {
        return jsonError(404, { error: 'not found' });
      }

      const record = await findCertificateByToken(env.PARCHMENT_LOG, config.siteId, token);
      if (record === null) {
        return jsonError(404, { error: 'not found' });
      }

      const headers = {
        'Content-Type':  'image/png',
        'Cache-Control': 'no-store',
      };
      if (method === 'HEAD') {
        return new Response(null, { status: 200, headers });
      }

      const key = mugKeyFromCertificateKey(record.r2_key);
      let png = await getCached(env.PARCHMENT, key);
      if (png === null) {
        try {
          png = await renderMugArtwork(config, record.name, record.achievement, record.serial, ALL_FONTS);
          await putCached(env.PARCHMENT, key, png);
        } catch (err) {
          console.error('parchment: mug render error', err);
          return jsonError(500, { error: 'render failed', detail: String(err) });
        }
      }
      return new Response(png, { status: 200, headers });
    }

    return jsonError(404, { error: 'not found' });
  },

  queue: handleQueue,
};
