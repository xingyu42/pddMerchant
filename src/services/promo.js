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

export async function getPromoReport(page, params = {}) {
  const { type = 'entity', mallId, ...rest } = params;
  const meta = type === 'hourly' ? PROMO_HOURLY_REPORT : PROMO_ENTITY_REPORT;
  return runEndpoint(page, meta, rest, { mallId });
}

export async function getSearchPromo(page, params = {}) {
  const report = await getPromoReport(page, { ...params, type: 'entity' });
  const entities = filterByType(report?.entities, 'search');
  return { ...report, entities, filterType: 'search' };
}

export async function getScenePromo(page, params = {}) {
  const report = await getPromoReport(page, { ...params, type: 'entity' });
  const entities = filterByType(report?.entities, 'scene');
  return { ...report, entities, filterType: 'scene' };
}

export async function getDdkPromo(_page, _params = {}) {
  return {
    ok: false,
    error: {
      code: 'E_DDK_UNAVAILABLE',
      message: 'DDK 多多客推广 endpoint 尚未接入',
      hint: 'V0.1 版本补齐 mms.pinduoduo.com/jinbao/promotionDetail',
    },
  };
}

export { filterByType };
