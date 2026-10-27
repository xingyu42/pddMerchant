import { redeemConsoleToken, resolveConsoleSession, consoleSessionCookie } from '../services/console-auth.js';
import { consoleHealth, consoleRequestError } from '../services/console-runtime.js';
import { listConsoleAccounts, saveConsolePassword, clearConsolePassword, unblockConsoleAccount } from '../services/console-accounts.js';
import { readConsoleCookie, requireJsonPost, readJson, send, sendHtml } from './http.js';
import { serveStatic } from './static.js';

export const CONSOLE_ROUTES = Object.freeze([
  { method: 'GET', template: '/healthz', pattern: /^\/healthz$/, public: true, run: () => consoleHealth() },
  { method: 'GET', template: '/c/:token', pattern: /^\/c\/([^/]+)$/, public: true, run: redeem },
  { method: 'GET', template: '/api/accounts', pattern: /^\/api\/accounts$/, run: () => listConsoleAccounts() },
  { method: 'POST', template: '/api/accounts/:slug/password', pattern: /^\/api\/accounts\/([^/]+)\/password$/,
    run: ({ slug, body }) => saveConsolePassword(slug, body) },
  { method: 'POST', template: '/api/accounts/:slug/password/clear', pattern: /^\/api\/accounts\/([^/]+)\/password\/clear$/,
    run: ({ slug }) => clearConsolePassword(slug) },
  { method: 'POST', template: '/api/accounts/:slug/unblock', pattern: /^\/api\/accounts\/([^/]+)\/unblock$/,
    run: ({ slug }) => unblockConsoleAccount(slug) },
]);

function redeem({ consoleToken, response, runtimeConfig }) {
  try {
    const { sessionValue: consoleSession, accountSlug } = redeemConsoleToken(consoleToken);
    response.setHeader('Set-Cookie', consoleSessionCookie(consoleSession, runtimeConfig));
    response.setHeader('Location', accountSlug ? `/#/accounts/${encodeURIComponent(accountSlug)}` : '/');
    send(response, 302, '');
  }
  catch (error) {
    if (!['E_CONSOLE_LINK_GONE', 'E_CONSOLE_LINK_EXPIRED'].includes(error?.code)) throw error;
    sendHtml(response, 410, '链接已失效，请重新获取');
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

export async function dispatchRoute(request, response, path, runtimeConfig, access) {
  const route = CONSOLE_ROUTES.find((entry) => entry.pattern.test(path));
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
      consoleToken: route.template === '/c/:token'
      ? path.match(route.pattern)[1] : null, body, request, response, runtimeConfig });
    if (!response.writableEnded) send(response, 200, result);
  } finally { body = null; }
}
