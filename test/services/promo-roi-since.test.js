import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';

const mock = vi.hoisted(() => ({ payloads: [] }));
vi.mock('../../src/adapter/run-endpoint.js', async (original) => ({ ...(await original()),
  async runEndpoint(_page, spec, params, ctx) {
    mock.payloads.push(spec.buildPayload(params, ctx));
    return { entities: [], totals: {} };
  },
}));
const { getPromoRoiView } = await import('../../src/services/promo-roi.js');

beforeEach(() => { mock.payloads = []; });

it('accepts the CLI --since date string as the report start date', async () => {
  await getPromoRoiView({}, { since: '2026-10-30' }, { mallId: '900001' });
  assert.equal(mock.payloads[0].startDate, '2026-10-30');
  assert.match(mock.payloads[0].endDate, /^\d{4}-\d{2}-\d{2}$/);
});

it.each(['2026-02-30', '20261030', 'yesterday'])('rejects invalid --since %s as usage error', async (since) => {
  await assert.rejects(getPromoRoiView({}, { since }, { mallId: '900001' }), { code: 'E_USAGE', exitCode: 2 });
});
