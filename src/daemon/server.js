import { createServer } from 'node:http';
import { consoleBaseUrl, isConsoleLoopback, publishConsoleUrl, consoleListenError,
  consoleApiError, consoleRequestError } from '../services/console-runtime.js';
import { securityHeaders, requestPath, send, rejectHttpClient } from './http.js';
import { dispatchRoute } from './routes.js';
import { closeAllConsoleSessions } from '../services/console-login.js';

function validHost(request, runtimeConfig, port) {
  const host = runtimeConfig.consoleHost.toLowerCase();
  const hosts = isConsoleLoopback(host) ? [host, 'localhost', '127.0.0.1', '[::1]'] : [host];
  const allowed = new Set(hosts.map((item) => `${item.includes(':') && !item.startsWith('[') ? `[${item}]` : item}:${port}`));
  if (port === 80) for (const item of hosts) allowed.add(item);
  if (runtimeConfig.consolePublicUrl) allowed.add(new URL(runtimeConfig.consolePublicUrl).host);
  const hostCount = request.rawHeaders.filter((_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === 'host').length;
  return hostCount === 1 && allowed.has(request.headers.host?.toLowerCase());
}

async function handleRequest(request, response, context, port) {
  const startedAt = performance.now();
  const access = { route: '/*' };
  securityHeaders(response);
  response.once('finish', () => context.log.info({ method: request.method, route: access.route,
    status: response.statusCode, duration_ms: Math.round(performance.now() - startedAt) }, 'console request'));
  try {
    if (!validHost(request, context.runtimeConfig, port)) throw consoleRequestError(421, 'E_CONSOLE_HOST', '访问地址无效');
    await dispatchRoute(request, response, requestPath(request), context.runtimeConfig, access, context);
  } catch (error) {
    const { status, body } = consoleApiError(error);
    if (status === 413) {
      request.pause();
      response.setHeader('Connection', 'close');
      const socket = request.socket;
      // Flush the write side before destroying an upload with unread bytes (Windows can otherwise reset the response).
      response.once('finish', () => { socket.end(); setImmediate(() => socket.destroy()); });
    }
    if (!response.writableEnded && !response.destroyed && !response.headersSent) send(response, status, body);
  } finally { if (response.statusCode !== 413) request.resume(); }
}

function listen(server, runtimeConfig) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(consoleListenError(error, runtimeConfig.consolePort));
    server.once('error', onError);
    server.listen({ host: runtimeConfig.consoleHost.replace(/^\[|\]$/g, ''), port: runtimeConfig.consolePort }, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
}

export function createConsoleServer({ patrol } = {}) {
  let server;
  let context;
  let starting;
  let controller;
  return {
    async start(nextContext) {
      controller = new AbortController();
      context = { ...nextContext, patrol, signal: nextContext.signal
        ? AbortSignal.any([nextContext.signal, controller.signal]) : controller.signal };
      server = createServer((request, response) => { void handleRequest(request, response, context, server.address()?.port); });
      server.on('clientError', (_error, socket) => rejectHttpClient(socket));
      starting = listen(server, context.runtimeConfig);
      await starting;
      if (context.signal?.aborted) return;
      publishConsoleUrl(consoleBaseUrl(context.runtimeConfig, server.address().port), context.ownerTag);
      if (!isConsoleLoopback(context.runtimeConfig.consoleHost)) context.log.warn('控制台使用 http 明文传输，请通过 HTTPS 反向代理访问');
    },
    async stop() {
      controller?.abort();
      try { await starting; } catch { /* 监听失败时仍清理元数据。 */ }
      publishConsoleUrl(null, context?.ownerTag);
      await closeAllConsoleSessions();
      if (!server?.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
    address: () => server?.address(),
  };
}
