import { getConfig }         from './config.ts';
import { buildCacheKey, getCached, putCached } from './r2.ts';
import { renderCertificate, ALL_FONTS }        from './render.ts';

function jsonError(status: number, body: Record<string, string>): Response {
  return Response.json(body, { status });
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'GET') {
      return jsonError(405, { error: 'method not allowed' });
    }

    const url = new URL(request.url);

    switch (url.pathname) {
      case '/parchment/health': {
        return Response.json({ status: 'ok', siteId: env.SITE_ID });
      }

      case '/parchment/render': {
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

        const config = getConfig(env);
        const ach    = achievement ?? config.achievementSubtitle;
        const key    = buildCacheKey(config.r2KeyPrefix, name, ach);

        const cached = await getCached(env.PARCHMENT, key);
        if (cached !== null) {
          return new Response(cached, {
            status:  200,
            headers: {
              'Content-Type':       'image/png',
              'Cache-Control':      'public, max-age=31536000, immutable',
              'X-Parchment-Cache':  'HIT',
              'X-Parchment-Key':    key,
            },
          });
        }

        try {
          const png = await renderCertificate(config, name, ach, ALL_FONTS);
          await putCached(env.PARCHMENT, key, png);
          return new Response(png, {
            status:  200,
            headers: {
              'Content-Type':       'image/png',
              'Cache-Control':      'public, max-age=31536000, immutable',
              'X-Parchment-Cache':  'MISS',
              'X-Parchment-Key':    key,
            },
          });
        } catch (err) {
          console.error('parchment: render error', err);
          return jsonError(500, { error: 'render failed', detail: String(err) });
        }
      }

      default:
        return jsonError(404, { error: 'not found' });
    }
  },
};
