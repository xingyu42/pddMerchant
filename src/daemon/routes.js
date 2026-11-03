import { redeemConsoleToken, resolveConsoleSession, consoleSessionCookie } from '../services/console-auth.js';
import { consoleHealth, consoleRequestError } from '../services/console-runtime.js';
import { listConsoleAccounts, saveConsolePassword, clearConsolePassword, unblockConsoleAccount } from '../services/console-accounts.js';
import { readConsoleCookie, requireJsonPost, readJson, send, sendHtml } from './http.js';
import { serveStatic } from './static.js';
import { startConsoleSession, startConsoleAddSession, getConsoleSession, consoleSessionFrames, consoleSessionPointer,
  consoleSessionText, consoleSessionSms, refreshConsoleQr, cancelConsoleSession, completeFixtureConsoleSession,
  consoleFixtureEnabled } from '../services/console-login.js';
import { streamFrames } from './sse.js';

export const CONSOLE_ROUTES = Object.freeze([
  { method: 'GET', template: '/healthz', pattern: /^\/healthz$/, public: true, run: () => consoleHealth() },
  { method: 'GET', template: '/c/:token', pattern: /^\/c\/([^/]+)$/, public: true, run: redemptionPage },
  { method: 'GET', template: '/app/redeem.js', pattern: /^\/app\/redeem\.js$/, public: true,
    run: ({ response }) => serveStatic('/app/redeem.js', response) },
  { method: 'POST', template: '/api/redeem', pattern: /^\/api\/redeem$/, public: true, run: redeem },
  { method: 'GET', template: '/api/accounts', pattern: /^\/api\/accounts$/, run: () => listConsoleAccounts() },
  { method: 'POST', template: '/api/accounts/add', pattern: /^\/api\/accounts\/add$/,
    run: ({ body, ownerTag, signal }) => startConsoleAddSession(body, { ownerTag, signal }) },
  { method: 'POST', template: '/api/accounts/:slug/password', pattern: /^\/api\/accounts\/([^/]+)\/password$/,
    run: ({ slug, body }) => saveConsolePassword(slug, body) },
  { method: 'POST', template: '/api/accounts/:slug/password/clear', pattern: /^\/api\/accounts\/([^/]+)\/password\/clear$/,
    run: ({ slug }) => clearConsolePassword(slug) },
  { method: 'POST', template: '/api/accounts/:slug/unblock', pattern: /^\/api\/accounts\/([^/]+)\/unblock$/,
    run: ({ slug }) => unblockConsoleAccount(slug) },
  { method: 'POST', template: '/api/accounts/:slug/relogin', pattern: /^\/api\/accounts\/([^/]+)\/relogin$/,
    run: ({ slug, ownerTag, signal }) => startConsoleSession(slug, { mode: 'password', ownerTag, signal }) },
  { method: 'POST', template: '/api/accounts/:slug/qr', pattern: /^\/api\/accounts\/([^/]+)\/qr$/,
    run: ({ slug, ownerTag, signal }) => startConsoleSession(slug, { mode: 'qr', ownerTag, signal }) },
  { method: 'GET', template: '/api/sessions/:id', pattern: /^\/api\/sessions\/([^/]+)$/,
    run: ({ id }) => getConsoleSession(id) },
  { method: 'GET', template: '/api/sessions/:id/frames', pattern: /^\/api\/sessions\/([^/]+)\/frames$/,
    run: ({ id, response }) => streamFrames(consoleSessionFrames(id), response) },
  { method: 'POST', template: '/api/sessions/:id/pointer', pattern: /^\/api\/sessions\/([^/]+)\/pointer$/,
    run: ({ id, body }) => consoleSessionPointer(id, body) },
  { method: 'POST', template: '/api/sessions/:id/sms', pattern: /^\/api\/sessions\/([^/]+)\/sms$/,
    run: ({ id, body }) => consoleSessionSms(id, body) },
  { method: 'POST', template: '/api/sessions/:id/text', pattern: /^\/api\/sessions\/([^/]+)\/text$/,
    run: ({ id, body }) => consoleSessionText(id, body) },
  { method: 'POST', template: '/api/sessions/:id/qr/refresh', pattern: /^\/api\/sessions\/([^/]+)\/qr\/refresh$/,
    run: ({ id }) => refreshConsoleQr(id) },
  { method: 'POST', template: '/api/sessions/:id/cancel', pattern: /^\/api\/sessions\/([^/]+)\/cancel$/,
    run: ({ id }) => cancelConsoleSession(id) },
  { method: 'POST', template: '/api/sessions/:id/fixture-complete', pattern: /^\/api\/sessions\/([^/]+)\/fixture-complete$/,
    fixtureOnly: true, run: ({ id, body }) => completeFixtureConsoleSession(id, body) },
]);

function redemptionPage({ response }) {
  sendHtml(response, 200, '正在进入控制台，请稍候…', '<script src="/app/redeem.js" defer></script>');
}

const LINK_FAILURES = new Set(['E_CONSOLE_LINK_GONE', 'E_CONSOLE_LINK_EXPIRED']);

function redeem({ body, request, response, runtimeConfig }) {
  try {
    const { sessionValue: consoleSession, accountSlug } = redeemConsoleToken(body?.token);
    response.setHeader('Set-Cookie', consoleSessionCookie(consoleSession, runtimeConfig));
    return { location: accountSlug ? `/#/accounts/${encodeURIComponent(accountSlug)}` : '/' };
  } catch (error) {
    // 已登录的浏览器再次打开用过或过期的链接（重复点击、页面重复加载）时直接进入控制台，不签发新会话。
    if (LINK_FAILURES.has(error?.code) && resolveConsoleSession(readConsoleCookie(request))) return { location: '/' };
    throw error;
  }
}

function authenticated(request, response, path) {
  if (resolveConsoleSession(readConsoleCookie(request))) return true;
  if (request.method === 'GET' && path === '/') {
    sendHtml(response, 401, '请通过 pdd console link 获取访问链接');
    return false;
  }
  throw consoleRequestError(401, 'E_CONSOLE_UNAUTHORIZED', '请通过 pdd console link 获取访问链接');
}

export async function dispatchRoute(request, response, path, runtimeConfig, access, context = {}) {
  const route = CONSOLE_ROUTES.find((entry) => (!entry.fixtureOnly || consoleFixtureEnabled()) && entry.pattern.test(path));
  access.route = route?.template ?? (path.startsWith('/api/') ? '/api/*' : '/*');
  if (!route?.public && !authenticated(request, response, path)) return;
  if (route?.method === 'POST' || !['GET', 'HEAD'].includes(request.method)) requireJsonPost(request);
  if (!route) {
    if (request.method === 'GET' && !path.startsWith('/api/')) return serveStatic(path, response);
    throw consoleRequestError(404, 'E_NOT_FOUND', '接口不存在');
  }
  if (request.method !== route.method) throw consoleRequestError(405, 'E_USAGE', '请求方法无效');
  let body = route.method === 'POST' ? await readJson(request) : null;
  try {
    const result = await route.run({ slug: route.template.startsWith('/api/accounts/') ? path.match(route.pattern)[1] : null,
      id: route.template.startsWith('/api/sessions/') ? path.match(route.pattern)[1] : null,
      body, request, response, runtimeConfig, ownerTag: context.ownerTag, signal: context.signal });
    if (!response.writableEnded && !response.headersSent) send(response, 200, result);
  } finally { body = null; }
}
