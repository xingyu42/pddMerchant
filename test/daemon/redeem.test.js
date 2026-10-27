import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { it, vi } from 'vitest';

const source = readFileSync(new URL('../../src/console/public/app/redeem.js', import.meta.url), 'utf8');

async function run(status, destination = '/') {
  const message = { textContent: '' };
  const location = { pathname: '/c/synthetic-token', replace: vi.fn() };
  const fetch = vi.fn(async () => ({ status, ok: status === 200, json: async () => ({ location: destination }) }));
  const context = { location, fetch, document: { querySelector: () => message } };
  runInNewContext(source, context);
  await vi.waitFor(() => assert.ok(location.replace.mock.calls.length || message.textContent));
  return { message, location, fetch };
}

it('redeems in the browser with a JSON POST and console header, then navigates to the safe landing location', async () => {
  const { fetch, location } = await run(200, '/#/accounts/shop');
  const [path, options] = fetch.mock.calls[0];
  assert.equal(path, '/api/redeem');
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'same-origin');
  assert.equal(options.headers['X-PDD-Console'], '1');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(options.body), { token: 'synthetic-token' });
  assert.equal(location.replace.mock.calls[0][0], '/#/accounts/shop');
});

it.each([410, 500])('shows fixed Chinese text on redemption HTTP %s without leaking the token', async (status) => {
  const { message, location } = await run(status);
  assert.match(message.textContent, status === 410 ? /链接已失效.*重新获取/ : /进入控制台失败/);
  assert.equal(message.textContent.includes('synthetic-token'), false);
  assert.equal(location.replace.mock.calls.length, 0);
});
