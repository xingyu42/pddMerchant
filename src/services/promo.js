import { runEndpoint } from '../adapter/run-endpoint.js';
import { PROMO_ENTITY_REPORT, PROMO_HOURLY_REPORT } from '../adapter/endpoints/promo.js';

export async function getPromoReport(page, params = {}, ctx = {}) {
  const { type = 'entity', mallId: paramMallId, ...rest } = params;
  const mallId = paramMallId ?? ctx.mallId;
  const meta = type === 'hourly' ? PROMO_HOURLY_REPORT : PROMO_ENTITY_REPORT;
  return runEndpoint(page, meta, rest, { ...ctx, mallId });
}
