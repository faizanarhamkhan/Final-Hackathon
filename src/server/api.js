import { routes } from './routes/index.js';
import { authenticate } from './services/auth.js';
import { ensureBootstrap } from './services/setup.js';
import { HttpError, forbidden, notFound, toErrorPayload } from './lib/http.js';

const compiled = routes.map(([method, pattern, roles, handler]) => {
  const keys = [];
  const re = new RegExp(
    `^${pattern
      .split('/')
      .map((seg) => {
        if (!seg.startsWith(':')) return seg.replace(/[.]/g, '\\.');
        keys.push(seg.slice(1));
        return '([^/]+)';
      })
      .join('/')}$`,
  );
  return { method, pattern, roles, handler, re, keys };
});

function match(method, path) {
  let pathMatched = false;
  for (const r of compiled) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method !== method) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    return { route: r, params };
  }
  return { route: null, pathMatched };
}

const json = (status, body) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function handle(request, pathSegments) {
  const method = request.method;
  const path = (pathSegments || []).join('/');
  try {
    await ensureBootstrap();
    const { route, params, pathMatched } = match(method, path);
    if (!route) {
      if (pathMatched) return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: `${method} is not allowed here` } });
      throw notFound(`No API route for ${method} /api/${path}`);
    }

    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'local';

    let actor = null;
    if (route.roles !== 'public') {
      actor = await authenticate(request, `${route.method} ${route.pattern}`);
      if (route.roles !== 'any' && !route.roles.includes(actor.role)) throw forbidden('Your role cannot do this');
    }

    let body = {};
    if (!['GET', 'HEAD', 'DELETE'].includes(method)) {
      const text = await request.text();
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          throw new HttpError(400, 'BAD_JSON', 'Request body is not valid JSON');
        }
      }
    }

    const result = await route.handler({ actor, params, query, body, ip, request });
    if (result && result.__file) {
      const { body: content, type, name } = result.__file;
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': type, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
      });
    }
    return json(200, result ?? { ok: true });
  } catch (err) {
    const { status, body } = toErrorPayload(err);
    return json(status, body);
  }
}
