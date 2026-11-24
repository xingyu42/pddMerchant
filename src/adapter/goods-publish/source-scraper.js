import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { simulateHumanBrowsing } from '../behavior-simulator.js';
import { detectPageRisk } from './risk-detector.js';
import { evaluateInMainWorld } from '../browser.js';

const KNOWN_SPEC_DIMS = new Set([
  '颜色分类', '颜色', '主要颜色', '花色',
  '尺码', '尺寸', '大小',
  '规格', '款式', '型号', '版本',
  '口味', '容量', '重量', '包装', '数量',
  '套餐', '套餐类型',
  '适用季节', '材质', '风格',
]);

const NOISE_RE = /^[¥￥]|已售|库存|^请选择|^\d+\.\d+$/;

export function parseSkuText(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const dims = [];
  let current = null;

  for (const line of lines) {
    if (KNOWN_SPEC_DIMS.has(line)) {
      current = { name: line, values: [] };
      dims.push(current);
    } else if (current && !NOISE_RE.test(line)) {
      current.values.push(line);
    }
  }
  return dims.filter((dim) => dim.values.length > 0);
}

function riskToError(signal) {
  const map = {
    'login-redirect': { code: 'E_AUTH_EXPIRED', exit: ExitCodes.AUTH },
    captcha: { code: 'E_RATE_LIMIT', exit: ExitCodes.RATE_LIMIT },
    slider: { code: 'E_RATE_LIMIT', exit: ExitCodes.RATE_LIMIT },
    'risk-modal': { code: 'E_RATE_LIMIT', exit: ExitCodes.RATE_LIMIT },
  };
  const m = map[signal.type] ?? { code: 'E_RATE_LIMIT', exit: ExitCodes.RATE_LIMIT };
  return new PddCliError({
    code: m.code,
    message: `源商品爬取风控拦截: ${signal.type} (phase: ${signal.phase})`,
    detail: signal,
    exitCode: m.exit,
  });
}

function extractPageData(nodeGoodsId) {
  function unwrapObservable(value) {
    // MobX 包装通常只有一层；多层循环属于过度假设。
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    const isObservableValue = Object.hasOwn(value, 'value')
      && (Object.hasOwn(value, 'observers')
        || Object.hasOwn(value, 'enhancer')
        || Object.hasOwn(value, 'diffValue'));
    return isObservableValue ? value.value : value;
  }

  function readValue(record, keys) {
    if (!record || typeof record !== 'object') return undefined;
    for (const key of keys) {
      if (record[key] !== undefined) return unwrapObservable(record[key]);
    }
    return undefined;
  }

  function toList(value) {
    const unwrapped = unwrapObservable(value);
    if (Array.isArray(unwrapped)) return unwrapped;
    if (unwrapped && typeof unwrapped !== 'string'
      && typeof unwrapped[Symbol.iterator] === 'function') {
      try {
        return Array.from(unwrapped);
      } catch {
        return [];
      }
    }
    return [];
  }

  function projectDimensionValue(rawValue) {
    if (typeof rawValue === 'string' || typeof rawValue === 'number') {
      return { id: rawValue, text: rawValue };
    }
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
    return {
      id: readValue(rawValue, ['id', 'valueId', 'specValueId', 'spec_value_id', 'specValueID']),
      text: readValue(rawValue, [
        'text', 'name', 'value', 'label', 'spec_value', 'specValue', 'value_name',
      ]),
    };
  }

  function projectSpec(rawSpec) {
    if (!rawSpec || typeof rawSpec !== 'object') return null;
    const name = readValue(rawSpec, ['name', 'key', 'specName', 'spec_name', 'specKey', 'spec_key']);
    const value = readValue(rawSpec, [
      'text', 'value', 'label', 'specValue', 'spec_value', 'value_name',
    ]);
    return name && value ? { name, text: value } : null;
  }

  function dimensionsFromSkus(rawSkus) {
    const grouped = new Map();
    for (const rawSku of rawSkus) {
      const rawSpecs = toList(readValue(rawSku, ['specs', 'properties']));
      for (const spec of rawSpecs.map(projectSpec).filter(Boolean)) {
        const name = String(spec.name);
        const text = String(spec.text);
        if (!grouped.has(name)) grouped.set(name, new Set());
        grouped.get(name).add(text);
      }
    }
    return [...grouped.entries()].map(([name, values]) => ({
      name,
      values: [...values].map((text) => ({ id: text, text })),
    }));
  }

  function projectDimensions(goods, rawSkus) {
    const candidates = [
      readValue(goods, ['skuDimensions']),
      readValue(goods, ['sku_dimensions']),
      readValue(goods, ['skuProperty']),
      readValue(goods, ['newOptions']),
      readValue(goods, ['options']),
    ];
    for (const candidate of candidates) {
      const rawDimensions = toList(candidate);
      if (rawDimensions.length === 0) continue;
      const nested = rawDimensions.map((rawDimension) => {
        if (!rawDimension || typeof rawDimension !== 'object' || Array.isArray(rawDimension)) return null;
        const rawValues = toList(readValue(rawDimension, [
          'values', 'options', 'children', 'valueList', 'value_list', 'specValues', 'spec_values',
        ]));
        return {
          name: readValue(rawDimension, [
            'name', 'key', 'specName', 'spec_name', 'specKey', 'spec_key',
          ]),
          values: rawValues.map(projectDimensionValue).filter((value) => value?.text),
        };
      }).filter((dimension) => dimension?.name && dimension.values.length > 0);
      if (nested.length > 0) return nested;

      const grouped = new Map();
      for (const rawOption of rawDimensions) {
        if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) continue;
        const name = readValue(rawOption, [
          'name', 'key', 'specName', 'spec_name', 'specKey', 'spec_key',
        ]);
        const value = projectDimensionValue(rawOption);
        if (!name || !value?.text) continue;
        if (!grouped.has(String(name))) grouped.set(String(name), []);
        grouped.get(String(name)).push(value);
      }
      if (grouped.size > 0) {
        return [...grouped.entries()].map(([name, values]) => ({ name, values }));
      }
    }
    return dimensionsFromSkus(rawSkus);
  }

  function projectSku(rawSku) {
    const specs = toList(readValue(rawSku, ['specs'])).map(projectSpec).filter(Boolean);
    const properties = toList(readValue(rawSku, ['properties'])).map(projectSpec).filter(Boolean);
    return {
      skuID: readValue(rawSku, ['skuID', 'skuId']),
      groupPrice: readValue(rawSku, ['groupPrice', 'group_price']),
      normalPrice: readValue(rawSku, ['normalPrice', 'normal_price']),
      quantity: readValue(rawSku, ['quantity', 'stock', 'inventory']),
      thumbUrl: readValue(rawSku, ['thumbUrl', 'thumb_url']),
      specValues: readValue(rawSku, ['specValues', 'spec_values']),
      specs: specs.length > 0 ? specs : null,
      properties: properties.length > 0 ? properties : null,
    };
  }

  function projectGoodsProperties(goods) {
    const rawProperties = toList(readValue(goods, [
      'goodsProperty', 'goods_property', 'goodsProperties', 'goods_properties',
    ])).slice(0, 100);
    return rawProperties.map((rawProperty) => {
      if (!rawProperty || typeof rawProperty !== 'object' || Array.isArray(rawProperty)) return null;
      return {
        name: readValue(rawProperty, ['name', 'key', 'propertyName', 'property_name']),
        values: toList(readValue(rawProperty, ['values', 'valueList', 'value_list'])).slice(0, 20),
        refPid: readValue(rawProperty, ['refPid', 'ref_pid']),
        referenceId: readValue(rawProperty, ['referenceId', 'reference_id']),
      };
    }).filter((property) => property?.name && property.values.length > 0);
  }

  function pushReactRoot(roots, element) {
    if (!element) return;
    for (const key of Object.getOwnPropertyNames(element)) {
      if (!key.startsWith('__reactFiber')
        && !key.startsWith('__reactContainer')
        && !key.startsWith('__reactInternalInstance')) continue;
      const root = element[key];
      if (root && typeof root === 'object') roots.push(root);
      break;
    }
  }

  function collectRuntimeRoots() {
    const roots = [];
    if (globalThis.rawData && typeof globalThis.rawData === 'object') roots.push(globalThis.rawData);
    for (const id of ['main', 'app', 'root']) {
      pushReactRoot(roots, document.getElementById(id));
    }
    if (roots.length > 1) return roots;

    let scannedElements = 0;
    for (const element of document.querySelectorAll('*')) {
      scannedElements += 1;
      if (scannedElements > 3000 || roots.length >= 50) break;
      pushReactRoot(roots, element);
    }
    return roots;
  }

  function findDecodedGoods(roots, targetGoodsId) {
    const queue = roots.map((value) => ({ value, depth: 0 }));
    const seen = new WeakSet();
    const looseSkus = new Map();
    let visited = 0;
    let fallback = null;
    let bestGoods = null;
    let bestSkuCount = 0;
    while (queue.length > 0 && visited < 8000) {
      const current = queue.shift();
      const value = current?.value;
      if (!value || typeof value !== 'object') continue;
      if (seen.has(value)) continue;
      seen.add(value);
      visited += 1;
      const candidateGoodsId = readValue(value, ['goodsID', 'goodsId', 'goods_id']);
      if (String(candidateGoodsId ?? '') === String(targetGoodsId)) {
        const candidateSkus = toList(readValue(value, ['skus']));
        if (candidateSkus.length > bestSkuCount) {
          bestGoods = value;
          bestSkuCount = candidateSkus.length;
        }
        const skuId = readValue(value, ['skuID', 'skuId']);
        if (skuId != null && readValue(value, ['groupPrice', 'group_price']) != null) {
          looseSkus.set(String(skuId), value);
        }
        fallback ??= value;
      }
      if (current.depth >= 10) continue;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      let childCount = 0;
      for (const descriptor of Object.values(descriptors)) {
        const child = descriptor?.value;
        if (child && typeof child === 'object') queue.push({ value: child, depth: current.depth + 1 });
        childCount += 1;
        if (childCount >= 120) break;
      }
    }
    return { goods: bestGoods ?? fallback, looseSkus: [...looseSkus.values()], visited };
  }

  const runtimeRoots = collectRuntimeRoots();
  const decodedSearch = findDecodedGoods(runtimeRoots, nodeGoodsId);
  const decodedGoodsCandidate = decodedSearch.goods;
  const decodedGoodsId = readValue(decodedGoodsCandidate, ['goodsID', 'goodsId', 'goods_id']);
  const decodedGoods = String(decodedGoodsId ?? '') === String(nodeGoodsId)
    ? decodedGoodsCandidate
    : null;
  const goodsSkus = toList(readValue(decodedGoods, ['skus']));
  const rawSkuQuality = (rawSkus) => rawSkus.reduce((score, rawSku) => {
    const projected = projectSku(rawSku);
    const specCount = (projected.specs?.length ?? 0) + (projected.properties?.length ?? 0);
    const hasPrice = Number(projected.groupPrice) > 0 ? 1 : 0;
    const hasStock = Number.isSafeInteger(Number(projected.quantity)) ? 1 : 0;
    return score + (specCount * 100) + (hasPrice * 10) + hasStock;
  }, 0);
  const looseSkusCoverParent = goodsSkus.length > 0
    && decodedSearch.looseSkus.length === goodsSkus.length;
  const rawSkus = looseSkusCoverParent
    && rawSkuQuality(decodedSearch.looseSkus) > rawSkuQuality(goodsSkus)
    ? decodedSearch.looseSkus
    : goodsSkus;

  function extractFromFiber() {
    const roots = [document.getElementById('main'), document.getElementById('app'), document.getElementById('root')];
    for (const el of roots) {
      if (!el) continue;
      const fiberKey = Object.keys(el).find((k) =>
        k.startsWith('__reactFiber') || k.startsWith('__reactContainer') || k.startsWith('__reactInternalInstance'),
      );
      if (!fiberKey) continue;
      const paths = [
        el[fiberKey]?.child?.memoizedProps,
        el[fiberKey]?.memoizedProps,
        el[fiberKey]?.child?.child?.memoizedProps,
        el[fiberKey]?.pendingProps,
      ];
      for (const props of paths) {
        if (!props) continue;
        try {
          const str = JSON.stringify(props);
          if (str.includes('goodsName') || str.includes('catID')) return str;
        } catch { /* circular ref */ }
      }
    }
    return '';
  }

  const fiberStr = extractFromFiber();
  const get = (key) =>
    fiberStr.match(new RegExp(`"${key}":\\s*(\\d+\\.?\\d*|"[^"]*")`))?.[1]?.replace(/"/g, '') || null;

  const body = document.body.innerText;
  const title = document.querySelector('title')?.textContent || '';
  const detailIdx = body.indexOf('商品详情');

  const fiberName = readValue(decodedGoods, ['goodsName', 'goodsDesc']) || get('goodsName') || get('goodsDesc');
  const domTitle = title.replace(/[-–—|].*/g, '').trim();
  const metaTitle = document.querySelector('meta[property="og:title"]')?.content || '';

  return {
    goodsID: decodedGoodsId || get('goodsID') || String(nodeGoodsId),
    goodsName: fiberName || domTitle || metaTitle || '',
    catID: readValue(decodedGoods, ['catID']) ?? get('catID'),
    catID1: readValue(decodedGoods, ['catID1']) ?? get('catID1'),
    catID2: readValue(decodedGoods, ['catID2']) ?? get('catID2'),
    catID3: readValue(decodedGoods, ['catID3']) ?? get('catID3'),
    price: body.match(/[¥￥]\s*\n?\s*(\d+\.?\d*)/)?.[1] || null,
    carousel: [...new Set(
      Array.from(document.querySelectorAll('img[src*="mms-material-img"]'))
        .map((img) => img.src.split('?')[0]),
    )],
    skuText: document.querySelector('[class*="sku"]')?.innerText || '',
    properties: detailIdx > -1 ? body.substring(detailIdx, detailIdx + 500) : '',
    detailImgs: [...new Set(
      Array.from(document.querySelectorAll('img[src*="mms-goods-image"]'))
        .map((img) => img.src.split('?')[0]),
    )],
    _fiberFound: Boolean(decodedGoods) || fiberStr.length > 0,
    _maskHint: /前往APP查看价格|APP内?查看价格|登录后?查看价格|查看完整价格/i.test(body),
    _url: location.href,
    _title: title,
    _bodyLen: body.length,
    _roots: ['main', 'app', 'root'].filter((id) => document.getElementById(id)).join(',') || 'none',
    _appWall: /打开(拼多多)?APP|在APP(内|中)?(打开|查看)|下载拼多多|立即打开/i.test(body),
    _decodedSkuSource: decodedGoods ? {
      goodsID: decodedGoodsId,
      linePrice: readValue(decodedGoods, ['linePrice', 'line_price']),
      skuDimensions: projectDimensions(decodedGoods, rawSkus),
      skus: rawSkus.map(projectSku),
      goodsProperties: projectGoodsProperties(decodedGoods),
      visitedObjects: decodedSearch.visited,
    } : null,
  };
}

function defaultScoreCandidate(candidate) {
  const source = candidate?._decodedSkuSource ?? candidate;
  const skuCount = Array.isArray(source?.skus) ? source.skus.length : 0;
  return { complete: skuCount > 0, score: skuCount };
}

export async function observeSourceGoodsPage(page, goodsId, {
  simulate = true,
  random = Math.random,
  scoreCandidate = defaultScoreCandidate,
} = {}) {
  const url = `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}&refer_page_name=search_result&refer_page_id=10033&refer_page_sn=10033`;

  await Promise.all([
    page.waitForResponse((r) => r.url().includes('oak/integration/render'), { timeout: 15000 }).catch(() => null),
    page.goto(url, { waitUntil: 'domcontentloaded' }),
  ]);

  const navRisk = await detectPageRisk(page, { phase: 'source-navigate' });
  if (navRisk.detected) throw riskToError(navRisk);

  // 页面会把初始化期的完整 SKU 对象精简成展示态；通过导航风控检查后短暂轮询，
  // 只保留规范化质量最高的脱敏投影，不保存完整 React 状态。
  let earlyObservation = null;
  let earlyScore = Number.NEGATIVE_INFINITY;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = await evaluateInMainWorld(page, extractPageData, goodsId);
    const scored = scoreCandidate(candidate);
    if ((scored?.score ?? 0) > earlyScore) {
      earlyObservation = candidate;
      earlyScore = scored?.score ?? 0;
    }
    if (scored?.complete) break;
    await page.waitForTimeout(150);
  }

  await page.waitForSelector('[class*="sku"]', { timeout: 10000 }).catch(() => null);
  if (simulate) {
    await simulateHumanBrowsing(page, {
      moveCount: 2 + Math.floor(random() * 2),
      scrollSegments: 2,
      dwellMs: [800, 2000],
      noClick: true,
      random,
    });
  }

  const warmRisk = await detectPageRisk(page, { phase: 'source-warmup' });
  if (warmRisk.detected) throw riskToError(warmRisk);

  const observation = await evaluateInMainWorld(page, extractPageData, goodsId);
  return { earlyObservation, observation, pageUrl: page.url() };
}
