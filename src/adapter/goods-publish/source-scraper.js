import { PddCliError, ExitCodes, softRiskControlDetected } from '../../infra/errors.js';
import { isMockEnabled, loadFixture } from '../mock-dispatcher.js';
import { simulateHumanBrowsing } from '../behavior-simulator.js';
import { detectPageRisk } from './risk-detector.js';
import { getSharedSessionHealth } from '../../infra/session-health.js';
import { getSharedScrapeCooldown } from '../../infra/scrape-cooldown.js';
import { getLogger } from '../../infra/logger.js';
import { evaluateInMainWorld } from '../browser.js';
import { normalizeSourceSkuSnapshot } from './source-sku-normalizer.js';

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
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
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
  return dims.filter(d => d.values.length > 0);
}

export function parseGoodsUrl(url) {
  if (!url || typeof url !== 'string') {
    throw new PddCliError({
      code: 'E_USAGE',
      message: '无效的商品链接或 ID',
      hint: '支持格式：商品链接 URL 或纯数字 goods_id',
      exitCode: ExitCodes.USAGE,
    });
  }

  const trimmed = url.trim();

  if (/^\d+$/.test(trimmed)) return trimmed;

  try {
    const parsed = new URL(trimmed);
    const goodsId = parsed.searchParams.get('goods_id');
    if (goodsId && /^\d+$/.test(goodsId)) return goodsId;
  } catch {
    // fall through to error
  }

  throw new PddCliError({
    code: 'E_USAGE',
    message: `无法从链接中提取 goods_id: ${trimmed}`,
    hint: '确认链接包含 goods_id 参数，或直接传入数字 ID',
    exitCode: ExitCodes.USAGE,
  });
}

export function isPriceMasked(price) {
  if (price === null || price === undefined) return true;
  const str = String(price).trim();
  if (str === '') return true;
  if (!/^\d+(\.\d+)?$/.test(str)) return true;
  return Number(str) <= 0; // ¥0 / 0.00 视为占位/脱敏，消费端正常商品价格 > 0
}

export function validateScrapedData(data) {
  // 反爬空壳墙判定：React fiber 未 hydrate + 命中"打开APP"墙 = H5 降级空壳页（body 被零宽字符
  // 填充、真实商品数据只在 APP/未被标记会话渲染）。此时 catID/skuText 必然缺失，但根因是反爬拦
  // 截而非"页面结构变更"，需给出准确 hint 避免误导为选择器过时。2026-07-09 实测 785831857546：
  // fiberFound=false / appWall=true / bodyLen=2336 / title="拼多多"。
  if (data?._fiberFound === false && data?._appWall === true) {
    throw new PddCliError({
      code: 'E_RATE_LIMIT',
      message: '源商品页返回反爬空壳（未渲染商品数据，命中"打开APP"墙）',
      hint: '当前出口 IP/会话被 PDD H5 降级。可尝试更换网络出口或稍后重试；此为上游反爬拦截，非链接错误',
      detail: {
        fiberFound: data._fiberFound,
        appWall: data._appWall,
        bodyLen: data._bodyLen ?? null,
        title: data._title ?? null,
      },
      exitCode: ExitCodes.RATE_LIMIT,
    });
  }

  const missing = [];

  if (!data?.goodsName) missing.push('goodsName (title)');
  if (!data?.catID && !data?.catID3) missing.push('catID / catID3');
  if (!Array.isArray(data?.carousel) || data.carousel.length === 0) missing.push('carousel (轮播图)');

  if (missing.length > 0) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `商品数据不完整，缺少必填字段: ${missing.join(', ')}`,
      hint: '检查商品链接是否正确，或页面结构已变更',
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const skuSnapshot = normalizeSourceSkuSnapshot(data);
  if (!skuSnapshot.complete) {
    throw new PddCliError({
      code: 'E_SOURCE_SKU_UNAVAILABLE',
      message: '源商品规格、逐 SKU 价格或库存数据不完整',
      hint: '已在创建商家草稿前停止；不会使用统一价格、猜测库存或数组顺序继续上货',
      detail: {
        dimension_count: skuSnapshot.skuDimensions.length,
        sku_count: skuSnapshot.skus.length,
        issues: skuSnapshot.issues,
      },
      exitCode: ExitCodes.BUSINESS,
    });
  }
}

function riskToError(signal) {
  const map = {
    'login-redirect': { code: 'E_AUTH_EXPIRED', exit: ExitCodes.AUTH },
    'captcha': { code: 'E_RATE_LIMIT', exit: ExitCodes.RATE_LIMIT },
    'slider': { code: 'E_RATE_LIMIT', exit: ExitCodes.RATE_LIMIT },
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

export async function scrapeSourceGoods(page, goodsId, ctx = {}) {
  if (isMockEnabled()) return loadFixture('goods-publish/source.json');

  const health = ctx.sessionHealth ?? getSharedSessionHealth();
  const cooldown = ctx.scrapeCooldown ?? getSharedScrapeCooldown({
    threshold: ctx.runtimeConfig?.scrapeSoftBlockThreshold,
    cooldownMs: ctx.runtimeConfig?.scrapeSoftBlockCooldownMs,
  });
  const simulate = process.env.PDD_SCRAPE_SIMULATE !== '0';
  const random = ctx.random ?? Math.random;

  function scoreSourceData(candidateData) {
    const source = candidateData?._decodedSkuSource ?? candidateData;
    const snapshot = normalizeSourceSkuSnapshot(source);
    return {
      source,
      snapshot,
      score: (snapshot.complete ? 1_000_000 : 0)
        + (snapshot.skuDimensions.length * 10_000)
        + (snapshot.skus.length * 10)
        - (snapshot.issues.length * 100),
    };
  }

  // Phase 0: Pre-flight — IP 软封冷却期内直接短路退避（不 page.goto，避免继续烧 IP）
  cooldown.check();
  health.check();

  const url = `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}&refer_page_name=search_result&refer_page_id=10033&refer_page_sn=10033`;

  // Phase 1: Navigate
  const [, ] = await Promise.all([
    page.waitForResponse(r => r.url().includes('oak/integration/render'), { timeout: 15000 }).catch(() => null),
    page.goto(url, { waitUntil: 'domcontentloaded' }),
  ]);

  const navRisk = await detectPageRisk(page, { phase: 'source-navigate' });
  if (navRisk.detected) {
    health.recordRisk(navRisk);
    throw riskToError(navRisk);
  }

  // 页面会把初始化期的完整 SKU 对象精简成展示态；通过导航风控检查后短暂轮询，
  // 只保留规范化质量最高的脱敏投影，不保存完整 React 状态。
  let earlyData = null;
  let earlyScore = Number.NEGATIVE_INFINITY;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = await evaluateInMainWorld(page, extractPageData, goodsId);
    const scored = scoreSourceData(candidate);
    if (scored.score > earlyScore) {
      earlyData = candidate;
      earlyScore = scored.score;
    }
    if (scored.snapshot.complete) break;
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(150);
  }

  // Phase 2: Warm-up
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
  if (warmRisk.detected) {
    health.recordRisk(warmRisk);
    throw riskToError(warmRisk);
  }

  // Phase 3: Extract
  function extractPageData(nodeGoodsId) {
    function unwrapObservable(value) {
      let current = value;
      for (let depth = 0; depth < 3; depth += 1) {
        if (!current || typeof current !== 'object' || Array.isArray(current)) break;
        const isObservableValue = Object.hasOwn(current, 'value')
          && (Object.hasOwn(current, 'observers')
            || Object.hasOwn(current, 'enhancer')
            || Object.hasOwn(current, 'diffValue'));
        if (!isObservableValue) break;
        current = current.value;
      }
      return current;
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

    function collectRuntimeRoots() {
      const roots = [];
      if (globalThis.rawData && typeof globalThis.rawData === 'object') roots.push(globalThis.rawData);
      let scannedElements = 0;
      for (const element of document.querySelectorAll('*')) {
        scannedElements += 1;
        if (scannedElements > 10000 || roots.length >= 200) break;
        for (const key of Object.getOwnPropertyNames(element)) {
          if (!key.startsWith('__reactFiber')
            && !key.startsWith('__reactContainer')
            && !key.startsWith('__reactInternalInstance')) continue;
          const root = element[key];
          if (root && typeof root === 'object') roots.push(root);
          break;
        }
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
      while (queue.length > 0 && visited < 15000) {
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
        if (current.depth >= 14) continue;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        let childCount = 0;
        for (const descriptor of Object.values(descriptors)) {
          const child = descriptor?.value;
          if (child && typeof child === 'object') queue.push({ value: child, depth: current.depth + 1 });
          childCount += 1;
          if (childCount >= 300) break;
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
        const fiberKey = Object.keys(el).find(k =>
          k.startsWith('__reactFiber') || k.startsWith('__reactContainer') || k.startsWith('__reactInternalInstance')
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
          .map(i => i.src.split('?')[0])
      )],
      skuText: document.querySelector('[class*="sku"]')?.innerText || '',
      properties: detailIdx > -1 ? body.substring(detailIdx, detailIdx + 500) : '',
      detailImgs: [...new Set(
        Array.from(document.querySelectorAll('img[src*="mms-goods-image"]'))
          .map(i => i.src.split('?')[0])
      )],
      _fiberFound: Boolean(decodedGoods) || fiberStr.length > 0,
      _maskHint: /前往APP查看价格|APP内?查看价格|登录后?查看价格|查看完整价格/i.test(body),
      _url: location.href,
      _title: title,
      _bodyLen: body.length,
      _roots: ['main', 'app', 'root'].filter(id => document.getElementById(id)).join(',') || 'none',
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

  const finalData = await evaluateInMainWorld(page, extractPageData, goodsId);
  const finalScored = scoreSourceData(finalData);
  const selectedSkuSource = earlyScore > finalScored.score
    ? (earlyData?._decodedSkuSource ?? earlyData)
    : finalScored.source;
  const data = finalData;
  data._decodedSkuSource = selectedSkuSource;

  const decodedSkuCount = Array.isArray(data?._decodedSkuSource?.skus)
    ? data._decodedSkuSource.skus.length
    : 0;
  const skuSnapshot = normalizeSourceSkuSnapshot(data?._decodedSkuSource ?? data);
  delete data._decodedSkuSource;
  data.sourceReferencePriceCents = skuSnapshot.sourceReferencePriceCents;
  data.skuDimensions = skuSnapshot.skuDimensions;
  data.skus = skuSnapshot.skus;
  data.goodsProperties = Array.isArray(selectedSkuSource?.goodsProperties)
    ? selectedSkuSource.goodsProperties
    : [];

  // 空壳页是出口 IP/页面渲染降级，不是消费者账号降级。必须先于价格/SKU
  // 脱敏判断处理，否则会被误报为 E_RISK_CONTROL_SOFT 并删除消费者登录态。
  if (data?._fiberFound === false && data?._appWall === true) {
    const signal = { type: 'empty-shell', phase: 'source-extract', reason: 'empty_shell' };
    health.recordRisk(signal);
    const cooldownResult = cooldown.recordSoftBlock(signal);
    try {
      validateScrapedData(data);
    } catch (err) {
      err.detail = {
        ...(err.detail && typeof err.detail === 'object' ? err.detail : {}),
        reason: signal.reason,
        cooldown_triggered: cooldownResult.cooldownTriggered,
        cooldown_remaining_ms: cooldownResult.cooldownRemainingMs,
      };
      throw err;
    }
  }

  // Phase 3.5: 只有结构化 SKU 不完整时，DOM 价格或通用 APP 引导文案才作为脱敏证据。
  // 页面可能同时展示 APP 引导和完整 React 商品状态，后者已由目标 goods_id、逐 SKU
  // 价格/库存和规格组合共同校验，不能再被非特异性的展示文案覆盖。
  const priceMasked = !skuSnapshot.complete && (isPriceMasked(data.price) || data._maskHint);
  const skuMissing = decodedSkuCount === 0 && !String(data.skuText ?? '').trim();
  if (priceMasked || skuMissing) {
    const signal = {
      type: 'desensitized',
      phase: 'source-extract',
      reason: priceMasked
        ? (data._maskHint ? 'app_redirect_placeholder' : 'price_masked')
        : 'sku_missing',
      priceRaw: data.price ?? null,
      skuEmpty: skuMissing,
      dimensionCount: skuSnapshot.skuDimensions.length,
      skuCount: skuSnapshot.skus.length,
      skuIssues: skuSnapshot.issues,
      path: (() => {
        try {
          return new URL(page.url()).pathname;
        } catch {
          return null;
        }
      })(),
    };
    health.recordRisk(signal);
    throw softRiskControlDetected(signal);
  }

  getLogger().debug({
    fiberFound: data._fiberFound,
    catID: data.catID,
    catID1: data.catID1,
    catID2: data.catID2,
    catID3: data.catID3,
    carouselCount: Array.isArray(data.carousel) ? data.carousel.length : 0,
    skuTextLen: data.skuText?.length ?? 0,
    dimensionCount: skuSnapshot.skuDimensions.length,
    skuCount: skuSnapshot.skus.length,
    skuIssues: skuSnapshot.issues,
    bodyLen: data._bodyLen,
    roots: data._roots,
    appWall: data._appWall,
  }, 'source-scrape extracted fields');

  validateScrapedData(data);

  // Phase 4: Post-flight
  health.recordSuccess();
  cooldown.recordSuccess();
  return data;
}
