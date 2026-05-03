import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { createCollector, _resetCollectorState } from '../../src/adapter/xhr-collector.js';
import { createFakePage, createFakeResponse } from './helpers/fake-playwright.js';

describe('XHR Collector PBT', () => {
  it('PROP-CL-1: collector ignores responses from requests that predate collector', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 5 }),
        async (preRequestCount) => {
          _resetCollectorState();
          const page = createFakePage();

          const firstCollector = createCollector(page, {
            pattern: '/api/',
            count: 1,
            timeout: 500,
          });
          firstCollector.dispose();

          const preRequests = [];
          for (let i = 0; i < preRequestCount; i++) {
            preRequests.push(page._nextRequest());
          }

          const collector = createCollector(page, {
            pattern: '/api/',
            count: 1,
            timeout: 2000,
          });

          for (const req of preRequests) {
            page.emit('response', createFakeResponse({
              url: 'https://mms.pinduoduo.com/api/old',
              request: req,
            }));
          }

          const newReq = page._nextRequest();
          const freshResp = createFakeResponse({
            url: 'https://mms.pinduoduo.com/api/new',
            request: newReq,
          });

          setTimeout(() => page.emit('response', freshResp), 10);

          const results = await collector.waitFor();
          assert.strictEqual(results.length, 1);
          assert.strictEqual(results[0].url(), freshResp.url());
        }
      ),
      { numRuns: 5 }
    );
  });

  it('PROP-CL-2: concurrent non-multiplex collectors throw E_COLLECTOR_COLLISION', () => {
    _resetCollectorState();
    const page = createFakePage();

    const first = createCollector(page, { pattern: '/api/', count: 1, timeout: 500 });

    assert.throws(
      () => createCollector(page, { pattern: '/api/', count: 1, timeout: 500 }),
      (err) => err.code === 'E_COLLECTOR_COLLISION'
    );

    first.dispose();
  });
});
