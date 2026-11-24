import { consoleRequestError } from '../services/console-runtime.js';
import { readConsoleCookie, requireJsonPost, readJson, send, sendHtml } from './http.js';
import { serveStatic } from './static.js';
import { streamFrames } from './sse.js';

const BASE_CONSOLE_ROUTES = Object.freeze([
  { method: 'GET', template: '/healthz', pattern: /^\/healthz$/, public: true, run: ({ consoleApp }) => consoleApp.health.check() },
  { method: 'GET', template: '/c/:token', pattern: /^\/c\/([^/]+)$/, public: true, run: redemptionPage },
  {
    method: 'GET', template: '/app/redeem.js', pattern: /^\/app\/redeem\.js$/, public: true,
    run: ({ response }) => serveStatic('/app/redeem.js', response),
  },
  {
    method: 'GET', template: '/app/styles.css', pattern: /^\/app\/styles\.css$/, public: true,
    run: ({ response }) => serveStatic('/app/styles.css', response),
  },
  { method: 'POST', template: '/api/redeem', pattern: /^\/api\/redeem$/, public: true, run: redeem },
  { method: 'GET', template: '/api/accounts', pattern: /^\/api\/accounts$/, run: ({ consoleApp }) => consoleApp.accounts.list() },
  {
    method: 'GET', template: '/api/patrol', pattern: /^\/api\/patrol$/,
    run: ({ consoleApp, patrol, runtimeConfig }) => consoleApp.patrol.get(patrol, runtimeConfig),
  },
  {
    method: 'POST', template: '/api/patrol', pattern: /^\/api\/patrol$/,
    run: ({ consoleApp, patrol, body, runtimeConfig }) => consoleApp.patrol.set(patrol, body, runtimeConfig),
  },
  {
    method: 'POST', template: '/api/accounts/add', pattern: /^\/api\/accounts\/add$/,
    run: ({ consoleApp, body, ownerTag, signal }) => consoleApp.accounts.add(body, { ownerTag, signal }),
  },
  {
    method: 'POST', template: '/api/accounts/:slug/password', pattern: /^\/api\/accounts\/([^/]+)\/password$/,
    run: ({ consoleApp, slug, body }) => consoleApp.accounts.savePassword(slug, body),
  },
  {
    method: 'POST', template: '/api/accounts/:slug/password/clear', pattern: /^\/api\/accounts\/([^/]+)\/password\/clear$/,
    run: ({ consoleApp, slug }) => consoleApp.accounts.clearPassword(slug),
  },
  {
    method: 'POST', template: '/api/accounts/:slug/unblock', pattern: /^\/api\/accounts\/([^/]+)\/unblock$/,
    run: ({ consoleApp, slug }) => consoleApp.accounts.unblock(slug),
  },
  {
    method: 'POST', template: '/api/accounts/:slug/remove', pattern: /^\/api\/accounts\/([^/]+)\/remove$/,
    run: ({ consoleApp, slug, body }) => consoleApp.accounts.remove(slug, body),
  },
  {
    method: 'POST', template: '/api/accounts/:slug/relogin', pattern: /^\/api\/accounts\/([^/]+)\/relogin$/,
    run: ({ consoleApp, slug, ownerTag, signal }) => consoleApp.sessions.start(slug, { mode: 'password', ownerTag, signal }),
  },
  {
    method: 'POST', template: '/api/accounts/:slug/qr', pattern: /^\/api\/accounts\/([^/]+)\/qr$/,
    run: ({ consoleApp, slug, ownerTag, signal }) => consoleApp.sessions.start(slug, { mode: 'qr', ownerTag, signal }),
  },
  {
    method: 'GET', template: '/api/sessions/:id', pattern: /^\/api\/sessions\/([^/]+)$/,
    run: ({ consoleApp, id }) => consoleApp.sessions.get(id),
  },
  {
    method: 'GET', template: '/api/sessions/:id/frames', pattern: /^\/api\/sessions\/([^/]+)\/frames$/,
    run: ({ consoleApp, id, response }) => streamFrames(consoleApp.sessions.frames(id), response),
  },
  {
    method: 'POST', template: '/api/sessions/:id/pointer', pattern: /^\/api\/sessions\/([^/]+)\/pointer$/,
    run: ({ consoleApp, id, body }) => consoleApp.sessions.pointer(id, body),
  },
  {
    method: 'POST', template: '/api/sessions/:id/sms', pattern: /^\/api\/sessions\/([^/]+)\/sms$/,
    run: ({ consoleApp, id, body }) => consoleApp.sessions.sms(id, body),
  },
  {
    method: 'POST', template: '/api/sessions/:id/text', pattern: /^\/api\/sessions\/([^/]+)\/text$/,
    run: ({ consoleApp, id, body }) => consoleApp.sessions.text(id, body),
  },
  {
    method: 'POST', template: '/api/sessions/:id/qr/refresh', pattern: /^\/api\/sessions\/([^/]+)\/qr\/refresh$/,
    run: ({ consoleApp, id }) => consoleApp.sessions.refreshQr(id),
  },
  {
    method: 'POST', template: '/api/sessions/:id/cancel', pattern: /^\/api\/sessions\/([^/]+)\/cancel$/,
    run: ({ consoleApp, id }) => consoleApp.sessions.cancel(id),
  },
]);

export function routesForMode(mode = 'live', extraRoutes = []) {
  if (mode !== 'fixture' || !Array.isArray(extraRoutes) || extraRoutes.length === 0) {
    return BASE_CONSOLE_ROUTES;
  }
  return Object.freeze([...BASE_CONSOLE_ROUTES, ...extraRoutes]);
}

function redemptionPage({ response }) {
  sendHtml(response, 200, '正在进入控制台，请稍候…', '<script src="/app/redeem.js" defer></script>');
}

const LINK_FAILURES = new Set(['E_CONSOLE_LINK_GONE', 'E_CONSOLE_LINK_EXPIRED']);

function redeem({ consoleApp, body, request, response, runtimeConfig }) {
  try {
    const { sessionValue: consoleSession, accountSlug } = consoleApp.auth.redeem(body?.token);
    response.setHeader('Set-Cookie', consoleApp.auth.sessionCookie(consoleSession, runtimeConfig));
    return { location: accountSlug ? `/#/accounts/${encodeURIComponent(accountSlug)}` : '/' };
  } catch (error) {
    // 已登录的浏览器再次打开用过或过期的链接（重复点击、页面重复加载）时直接进入控制台，不签发新会话。
    if (LINK_FAILURES.has(error?.code) && consoleApp.auth.resolveSession(readConsoleCookie(request))) {
      return { location: '/' };
    }
    throw error;
  }
}

function authenticated(request, response, path, consoleApp) {
  if (consoleApp.auth.resolveSession(readConsoleCookie(request))) return true;
  if (request.method === 'GET' && path === '/') {
    sendHtml(response, 401, '请通过 pdd console link 获取访问链接');
    return false;
  }
  throw consoleRequestError(401, 'E_CONSOLE_UNAUTHORIZED', '请通过 pdd console link 获取访问链接');
}

export async function dispatchRoute(request, response, path, runtimeConfig, access, context = {}) {
  const mode = context.runtime?.mode ?? context.mode ?? 'live';
  const routes = context.routes ?? routesForMode(mode, context.runtime?.consoleExtraRoutes);
  const consoleApp = context.consoleApp ?? context.runtime?.consoleApp;
  const matches = routes.filter((entry) => entry.pattern.test(path));
  const route = matches.find((entry) => entry.method === request.method) ?? matches[0];
  access.route = route?.template ?? (path.startsWith('/api/') ? '/api/*' : '/*');
  if (!route?.public && !authenticated(request, response, path, consoleApp)) return;
  if (route?.method === 'POST' || !['GET', 'HEAD'].includes(request.method)) requireJsonPost(request);
  if (!route) {
    if (request.method === 'GET' && !path.startsWith('/api/')) return serveStatic(path, response);
    throw consoleRequestError(404, 'E_NOT_FOUND', '接口不存在');
  }
  if (request.method !== route.method) throw consoleRequestError(405, 'E_USAGE', '请求方法无效');
  let body = route.method === 'POST' ? await readJson(request) : null;
  try {
    const result = await route.run({
      slug: route.template.startsWith('/api/accounts/') ? path.match(route.pattern)[1] : null,
      id: route.template.startsWith('/api/sessions/') ? path.match(route.pattern)[1] : null,
      body,
      request,
      response,
      runtimeConfig,
      ownerTag: context.ownerTag,
      signal: context.signal,
      patrol: context.patrol,
      runtime: context.runtime,
      consoleApp,
    });
    if (!response.writableEnded && !response.headersSent) send(response, 200, result);
  } finally {
    body = null;
  }
}
