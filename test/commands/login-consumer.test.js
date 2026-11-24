import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, it } from 'vitest';
import { composeCommandRuntime } from '../../src/runtime/command-runtime.js';
import { run as runLogin } from '../../src/commands/login.js';
import { createInMemoryBrowserRuntime } from '../helpers/in-memory-ports.js';

const tempDirs = [];

function makeTempStatePath() {
  const dir = mkdtempSync(join(tmpdir(), 'pdd-login-cooldown-'));
  tempDirs.push(dir);
  return join(dir, 'scrape-cooldown.json');
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('login --consumer runtime scrapeCooldown wiring', () => {
  it('clears the runtime-injected persistent scrapeCooldown upon successful consumer login', async () => {
    const statePath = makeTempStatePath();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const browser = createInMemoryBrowserRuntime({
      createPage: (context) => {
        const emitter = new EventEmitter();
        let currentUrl = 'https://mobile.yangkeduo.com/login.html';
        return {
          context: () => context,
          on: (event, fn) => emitter.on(event, fn),
          off: (event, fn) => emitter.off(event, fn),
          url: () => currentUrl,
          waitForTimeout: async () => {},
          evaluate: async () => 0,
          goto: async (url) => { currentUrl = url; },
          waitForURL: async () => {
            currentUrl = 'https://mobile.yangkeduo.com/home';
            await Promise.all(
              emitter.listeners('response').map((listener) => listener({
                url: () => 'https://mobile.yangkeduo.com/proxy/api/api/apollo/v3/user/me',
                status: () => 200,
                json: async () => ({ uid: '991122', nickname: 'Replacement Buyer' }),
              })),
            );
          },
          close: async () => {},
        };
      },
    });

    const runtime = await composeCommandRuntime({
      mode: 'live',
      runtimeConfigPolicy: 'maintenance',
      env: {},
      streams: { stdout, stderr },
      overrides: {
        browser,
        scrapeCooldownStatePath: statePath,
        runtimeConfig: {
          consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html',
          scrapeSoftBlockThreshold: 1,
          scrapeSoftBlockCooldownMs: 60_000,
        },
      },
    });

    try {
      runtime.scrapeCooldown.recordSoftBlock({ reason: 'empty_shell' });
      assert.throws(() => runtime.scrapeCooldown.check(), { code: 'E_RATE_LIMIT' });

      const envelope = await runLogin({ consumer: true, headed: true, json: true }, { runtime });
      assert.equal(envelope.ok, true);
      assert.equal(envelope.command, 'login.consumer');
      assert.equal(runtime.scrapeCooldown.status().consecutiveSoftBlock, 0);
      runtime.scrapeCooldown.check();
    } finally {
      await runtime.closeAll();
    }
  });
});
