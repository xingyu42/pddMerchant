import { afterAll, beforeAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { closeBrowser, evaluateInMainWorld, launchBrowser } from '../../src/adapter/browser.js';

const integrationIt = process.env.PDD_RUN_BROWSER_INTEGRATION === '1' ? it : it.skip;

function captureScript() {
  return `<script>
    (() => {
      const descriptorFor = (target, property) => {
        let owner = target;
        while (owner && !Object.prototype.hasOwnProperty.call(owner, property)) {
          owner = Object.getPrototypeOf(owner);
        }
        const descriptor = owner ? Object.getOwnPropertyDescriptor(owner, property) : null;
        return {
          configurable: descriptor?.configurable ?? null,
          enumerable: descriptor?.enumerable ?? null,
          getterSource: descriptor?.get ? Function.prototype.toString.call(descriptor.get) : null,
        };
      };
      globalThis.__earlyProfile = {
        outerWidth: globalThis.outerWidth,
        outerHeight: globalThis.outerHeight,
        availHeight: globalThis.screen.availHeight,
        screenWidth: globalThis.screen.width,
        screenHeight: globalThis.screen.height,
        innerWidth: globalThis.innerWidth,
        innerHeight: globalThis.innerHeight,
        devicePixelRatio: globalThis.devicePixelRatio,
        userAgent: globalThis.navigator.userAgent,
        descriptors: {
          outerWidth: descriptorFor(globalThis, 'outerWidth'),
          outerHeight: descriptorFor(globalThis, 'outerHeight'),
          availHeight: descriptorFor(globalThis.screen, 'availHeight'),
        },
      };
    })();
  </script>`;
}

function html(body = '') {
  return `<!doctype html><html><head>${captureScript()}</head><body>${body}</body></html>`;
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function closeServer(server) {
  if (!server?.listening) return;
  server.close();
  await once(server, 'close');
}

async function readEarlyProfile(pageOrFrame) {
  return evaluateInMainWorld(pageOrFrame, () => globalThis.__earlyProfile);
}

function assertConsistentProfile(profile, expectedUserAgent, expectedInnerSize = null) {
  assert.deepEqual({
    outerWidth: profile.outerWidth,
    outerHeight: profile.outerHeight,
    availHeight: profile.availHeight,
    screenWidth: profile.screenWidth,
    screenHeight: profile.screenHeight,
    devicePixelRatio: profile.devicePixelRatio,
  }, {
    outerWidth: 1920,
    outerHeight: 1080,
    availHeight: 1050,
    screenWidth: 1920,
    screenHeight: 1080,
    devicePixelRatio: 1,
  });
  if (expectedInnerSize) {
    assert.deepEqual(
      { width: profile.innerWidth, height: profile.innerHeight },
      expectedInnerSize,
    );
  }
  assert.equal(profile.userAgent, expectedUserAgent);
  for (const descriptor of Object.values(profile.descriptors)) {
    assert.equal(descriptor.configurable, true);
    assert.equal(descriptor.enumerable, true);
    assert.match(descriptor.getterSource, /\[native code\]/);
  }
}

describe('real browser Headless consistency profile', () => {
  let mainServer;
  let mainOrigin;
  let mainRequestUserAgent;
  let crossFrameUrl;

  beforeAll(async () => {
    crossFrameUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html('cross-origin iframe'))}`;

    mainServer = createServer((request, response) => {
      if (request.url === '/main') mainRequestUserAgent = request.headers['user-agent'];
      const body = request.url === '/main'
        ? `<iframe src="/same"></iframe><iframe src="${crossFrameUrl}"></iframe>`
        : request.url === '/same' ? 'same-origin iframe' : 'second page';
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(html(body));
    });
    const mainPort = await listen(mainServer);
    mainOrigin = `http://127.0.0.1:${mainPort}`;
  });

  afterAll(async () => {
    await closeServer(mainServer);
  });

  integrationIt('applies before page code to main page, iframes, and later pages with one UA', async () => {
    const launched = await launchBrowser();
    let secondPage = null;
    try {
      await launched.page.goto(`${mainOrigin}/main`, { waitUntil: 'load' });
      const expectedUserAgent = await evaluateInMainWorld(launched.page, () => navigator.userAgent);
      const frameUrls = launched.page.frames().map((frame) => frame.url());
      const sameFrame = launched.page.frames().find((frame) => frame.url().endsWith('/same'));
      const crossFrame = launched.page.frames().find((frame) => frame.url().startsWith('data:text/html'));
      assert.ok(sameFrame, `same-origin iframe should be attached: ${JSON.stringify(frameUrls)}`);
      assert.ok(crossFrame, `cross-origin iframe should be attached: ${JSON.stringify(frameUrls)}`);

      const mainProfile = await readEarlyProfile(launched.page);
      const sameProfile = await readEarlyProfile(sameFrame);
      const crossProfile = await readEarlyProfile(crossFrame);
      assertConsistentProfile(mainProfile, expectedUserAgent, { width: 1902, height: 984 });
      assertConsistentProfile(sameProfile, expectedUserAgent);
      assertConsistentProfile(crossProfile, expectedUserAgent);
      assert.equal(mainRequestUserAgent, expectedUserAgent);

      secondPage = await launched.context.newPage();
      await secondPage.goto(`${mainOrigin}/second`, { waitUntil: 'load' });
      assertConsistentProfile(
        await readEarlyProfile(secondPage),
        expectedUserAgent,
        { width: 1902, height: 984 },
      );
    } finally {
      await secondPage?.close().catch(() => {});
      await closeBrowser(launched.browser);
    }
  }, 60_000);
});
