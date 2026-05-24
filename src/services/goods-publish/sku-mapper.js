import { PddCliError, ExitCodes } from '../../infra/errors.js';

const MAX_SKU_COUNT = 600;

function priceToCents(priceStr) {
  const n = parseFloat(String(priceStr ?? ''));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

function defaultSku(price) {
  const cents = priceToCents(price);
  return {
    skus: [{
      id: 0,
      is_onsale: 1,
      multi_price: cents,
      price: cents,
      quantity_delta: 999,
      thumb_url: '',
      spec: '',
      weight: 0,
    }],
    groups: {
      single_price: cents,
      group_price: cents,
      customer_num: 2,
      buy_limit: 999999,
    },
  };
}

function cartesian(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap(combo => arr.map(val => [...combo, val])),
    [[]],
  );
}

function formatSpecText(dims, combo) {
  return dims.map((d, i) => `${d.name}:${combo[i]}`).join(' ');
}

export function mapSourceSkus(skuSpecs, price) {
  const cents = priceToCents(price);

  if (!Array.isArray(skuSpecs) || skuSpecs.length === 0) {
    return defaultSku(price);
  }

  const activeDims = skuSpecs.filter(d => d.values.length > 0);
  const valueArrays = activeDims.map(d => d.values);
  if (valueArrays.length === 0) return defaultSku(price);

  const total = valueArrays.reduce((n, a) => n * a.length, 1);
  if (total > MAX_SKU_COUNT) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `SKU 组合数 ${total} 超过上限 ${MAX_SKU_COUNT}`,
      hint: '检查商品规格维度是否正常',
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const combos = cartesian(valueArrays);

  if (combos.length <= 1 && activeDims.length === 1 && activeDims[0].values.length <= 1) {
    return defaultSku(price);
  }

  const skus = combos.map((combo, idx) => ({
    id: idx,
    is_onsale: 1,
    multi_price: cents,
    price: cents,
    quantity_delta: 999,
    thumb_url: '',
    spec: formatSpecText(activeDims, combo),
    weight: 0,
  }));

  return {
    skus,
    groups: {
      single_price: cents,
      group_price: cents,
      customer_num: 2,
      buy_limit: 999999,
    },
  };
}
