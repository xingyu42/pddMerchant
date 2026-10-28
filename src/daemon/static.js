import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { send } from './http.js';
import { consoleRequestError } from '../services/console-runtime.js';

const PUBLIC = fileURLToPath(new URL('../console/public/', import.meta.url));
const VENDOR = fileURLToPath(new URL('../console/vendor/', import.meta.url));
const MIME = Object.freeze({ '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2' });

function inside(root, file) {
  return file.startsWith(`${resolve(root)}${sep}`);
}

export async function serveStatic(path, response) {
  const root = path.startsWith('/vendor/') ? VENDOR : PUBLIC;
  const relative = path.startsWith('/vendor/') ? path.slice('/vendor/'.length) : path.slice(1);
  const file = resolve(root, relative || 'index.html');
  const mime = MIME[extname(file)];
  if (!inside(root, file) || !mime) throw consoleRequestError(404, 'E_NOT_FOUND', '页面不存在');
  try {
    const actual = await realpath(file);
    if (!inside(await realpath(root), actual) || !(await stat(actual)).isFile()) throw new Error();
    send(response, 200, await readFile(actual), `${mime}${mime.startsWith('text/') ? '; charset=utf-8' : ''}`);
  } catch {
    throw consoleRequestError(404, 'E_NOT_FOUND', '页面不存在');
  }
}
