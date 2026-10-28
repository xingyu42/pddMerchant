import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, it, vi } from 'vitest';
import { readFile, realpath, stat } from 'node:fs/promises';
import { serveStatic } from '../../src/daemon/static.js';

vi.mock('node:fs/promises', async (original) => ({ ...await original(), readFile: vi.fn(), realpath: vi.fn(), stat: vi.fn() }));

const root = fileURLToPath(new URL('../../src/console/', import.meta.url));
beforeEach(() => {
  readFile.mockReset().mockResolvedValue(Buffer.from('synthetic asset'));
  realpath.mockReset().mockImplementation(async (path) => resolve(path));
  stat.mockReset().mockResolvedValue({ isFile: () => true });
});

function response() { return { setHeader: vi.fn(), end: vi.fn() }; }

it('serves public and vendor assets with a small explicit MIME allowlist', async () => {
  for (const [path, relative, mime] of [['/', 'public/index.html', 'text/html; charset=utf-8'],
    ['/app.css', 'public/app.css', 'text/css; charset=utf-8'],
    ['/vendor/preact.module.js', 'vendor/preact.module.js', 'text/javascript; charset=utf-8'],
    ['/vendor/preact.mjs', 'vendor/preact.mjs', 'text/javascript; charset=utf-8']]) {
    const res = response();
    await serveStatic(path, res);
    assert.equal(res.statusCode, 200);
    assert.equal(readFile.mock.calls.at(-1)[0], resolve(root, relative));
    assert.ok(res.setHeader.mock.calls.some(([key, value]) => key === 'Content-Type' && value === mime));
  }
});

it('rejects lexical prefix escape, unknown MIME types, directories and symlinks outside either root', async () => {
  for (const path of ['/vendor/../../infra/db.js', '/../public-other/app.js', '/private.db']) {
    await assert.rejects(serveStatic(path, response()), { code: 'E_NOT_FOUND' });
  }
  assert.equal(readFile.mock.calls.length, 0);
  realpath.mockImplementation(async (path) => path.endsWith('escape.js') ? resolve(root, '../infra/db.js') : resolve(path));
  await assert.rejects(serveStatic('/escape.js', response()), { code: 'E_NOT_FOUND' });
  await assert.rejects(serveStatic('/vendor/escape.js', response()), { code: 'E_NOT_FOUND' });
  stat.mockResolvedValue({ isFile: () => false });
  await assert.rejects(serveStatic('/directory.js', response()), { code: 'E_NOT_FOUND' });
  assert.equal(readFile.mock.calls.length, 0);
});
