import { getConfig }                            from './config.ts';
import { buildCacheKey, getCached, putCached }  from './r2.ts';
import { renderCertificate, ALL_FONTS }         from './render.ts';
import { handleQueue, type IssueMessage }       from './queue.ts';
import { hasRecentCertificate }                 from './db.ts';

function jsonError(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url    = new URL(request.url);
    const method = request.method;

    // ── GET /parchment/health ─────────────────────────────────────────────────
    if (url.pathname === '/parchment/health') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });
      return Response.json({ status: 'ok', siteId: env.SITE_ID });
    }

    // ── GET /parchment/render — preview certificate ───────────────────────────
    if (url.pathname === '/parchment/render') {
      if (method !== 'GET') return jsonError(405, { error: 'method not allowed' });

      const name        = url.searchParams.get('name') ?? '';
      const achievement = url.searchParams.get('achievement');

      if (!name) {
        return jsonError(400, { error: 'name parameter is required' });
      }
      if (name.length > 100) {
        return jsonError(400, { error: 'name must be 100 characters or fewer' });
      }
      if (achievement !== null && achievement.length > 200) {
        return jsonError(400, { error: 'achievement must be 200 characters or fewer' });
      }

      const config        = getConfig(env);
      const ach           = achievement ?? config.achievementSubtitle;
      const previewPrefix = `previews/${config.siteId}/`;
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
        const png = await renderCertificate(config, name, ach, 'PREVIEW', ALL_FONTS);
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
        console.error('parchment: render error', err);
        return jsonError(500, { error: 'render failed', detail: String(err) });
      }
    }

    // ── POST /parchment/issue — queue official certificate issuance ───────────
    if (url.pathname === '/parchment/issue') {
      if (method !== 'POST') return jsonError(405, { error: 'method not allowed' });

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

      const config = getConfig(env);

      if (await hasRecentCertificate(env.PARCHMENT_LOG, config.siteId, email)) {
        return jsonError(429, { error: 'A certificate has already been issued to this email today' });
      }

      const ach = achievement ?? config.achievementSubtitle;
      const msg: IssueMessage = { name, achievement: ach, email };
      await env.PARCHMENT_QUEUE.send(msg);

      return Response.json({ status: 'queued' }, { status: 202 });
    }

    return jsonError(404, { error: 'not found' });
  },

  queue: handleQueue,
};
