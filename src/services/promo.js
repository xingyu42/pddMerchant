import { runEndpoint } from '../adapter/run-endpoint.js';
import { PROMO_ENTITY_REPORT, PROMO_HOURLY_REPORT } from '../adapter/endpoints/promo.js';

const TYPE_MARKERS = {
  search: { scenesType: 1, keyword: 'search' },
  scene: { scenesType: 2, keyword: 'scene' },
};

function filterByType(entities, typeKey) {
  if (!Array.isArray(entities)) return [];
  const marker = TYPE_MARKERS[typeKey];
  if (!marker) return entities;
  return entities.filter((e) => {
    if (e == null || typeof e !== 'object') return false;
    if (typeof e.promotionType === 'string') {
      return e.promotionType.toLowerCase() === typeKey;
    }
    if (marker.scenesType != null && e.scenesType === marker.scenesType) return true;
    if (typeof e.scenesMode === 'string' && e.scenesMode.toLowerCase().includes(marker.keyword)) {
      return true;
    }
    return false;
  });
}

export async function getPromoReport(page, params = {}, ctx = {}) {
  const { type = 'entity', mallId: paramMallId, ...rest } = params;
  const mallId = paramMallId ?? ctx.mallId;
  const meta = type === 'hourly' ? PROMO_HOURLY_REPORT : PROMO_ENTITY_REPORT;
  return runEndpoint(page, meta, rest, { ...ctx, mallId });
}

export async function getSearchPromo(page, params = {}, ctx = {}) {
  const report = await getPromoReport(page, { ...params, type: 'entity' }, ctx);
  const entities = filterByType(report?.entities, 'search');
  return { ...report, entities, filterType: 'search' };
}

export async function getScenePromo(page, params = {}, ctx = {}) {
  const report = await getPromoReport(page, { ...params, type: 'entity' }, ctx);
  const entities = filterByType(report?.entities, 'scene');
  return { ...report, entities, filterType: 'scene' };
}

export { filterByType };
