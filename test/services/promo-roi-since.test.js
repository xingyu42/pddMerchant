import { beforeEach, it } from 'vitest';
import assert from 'node:assert/strict';
import { getPromoRoiView } from '../../src/services/promo-roi.js';
import { createMemoryEndpointTransport, createTestCtx } from '../helpers/test-ctx.js';

const emptyPromoRaw = {
  success: true,
  result: {
    entityReportList: [],
    totalSumReport: { impression: 0, click: 0, gmv: 0, spend: 0 },
  },
};

let transport;
let ctx;
beforeEach(() => {
  transport = createMemoryEndpointTransport({
    responses: { 'promo.entityReport': emptyPromoRaw },
  });
  ctx = createTestCtx({ transport, mallId: '900001' });
});

it('accepts the CLI --since date string as the report start date', async () => {
  await getPromoRoiView(ctx.page, { since: '2026-10-30' }, ctx);
  assert.equal(transport.calls[0].payload.startDate, '2026-10-30');
  assert.match(transport.calls[0].payload.endDate, /^\d{4}-\d{2}-\d{2}$/);
});

it.each(['2026-02-30', '20261030', 'yesterday'])('rejects invalid --since %s as usage error', async (since) => {
  await assert.rejects(getPromoRoiView(ctx.page, { since }, ctx), { code: 'E_USAGE', exitCode: 2 });
});
