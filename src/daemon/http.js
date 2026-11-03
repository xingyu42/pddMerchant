import { consoleRequestError } from '../services/console-runtime.js';

const CSP = "default-src 'self'; img-src 'self' data: blob:; connect-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'";
const SECURITY_HEADERS = Object.freeze({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY' });

export function securityHeaders(response) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(key, value);
}

export function rejectHttpClient(socket) {
  if (!socket.writable) { socket.destroy(); return; }
  const body = JSON.stringify({ error: { code: 'E_USAGE', message: 'HTTP 请求格式无效' } });
  const headers = { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body), Connection: 'close' };
  socket.end(`HTTP/1.1 400 Bad Request\r\n${Object.entries(headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n${body}`);
}

export function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.statusCode = status;
  response.setHeader('Content-Type', type);
  if (type.startsWith('text/html')) response.setHeader('Content-Security-Policy', CSP);
  response.end(Buffer.isBuffer(body) || typeof body === 'string' ? body : JSON.stringify(body));
}

export function sendHtml(response, status, message, scripts = '') {
  send(response, status, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>pdd 控制台</title>
<link rel="stylesheet" href="/app/styles.css"></head><body><main><p>${message}</p></main>${scripts}</body></html>`,
    'text/html; charset=utf-8');
}

export function requestPath(request) {
  const raw = request.url?.split('?')[0] ?? '';
  let path;
  try { path = decodeURIComponent(raw); }
  catch { throw consoleRequestError(400, 'E_USAGE', '请求路径无效'); }
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\0:%]/.test(path)
    || path.split('/').some((part) => part === '.' || part === '..')) {
    throw consoleRequestError(404, 'E_NOT_FOUND', '页面不存在');
  }
  return path;
}

export function readConsoleCookie(request) {
  const cookies = request.headers.cookie?.split(';').map((part) => part.trim()) ?? [];
  const matches = cookies.filter((part) => part.startsWith('pdd_console='));
  return matches.length === 1 ? matches[0].slice('pdd_console='.length) : null;
}

export function requireJsonPost(request) {
  if (request.method !== 'POST' || request.headers['x-pdd-console'] !== '1'
    || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) {
    throw consoleRequestError(403, 'E_CONSOLE_CSRF', '请使用带控制台请求头的 JSON POST 请求');
  }
}

export async function readJson(request) {
  if (Number(request.headers['content-length']) > 65536) {
    throw consoleRequestError(413, 'E_CONSOLE_BODY_TOO_LARGE', '请求体超过 64 KiB');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 65536) throw consoleRequestError(413, 'E_CONSOLE_BODY_TOO_LARGE', '请求体超过 64 KiB');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw consoleRequestError(400, 'E_USAGE', '请求体须为有效 JSON'); }
  finally { chunks.length = 0; }
}
