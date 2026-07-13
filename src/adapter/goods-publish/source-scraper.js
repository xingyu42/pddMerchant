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
  const cooldown = ctx.scrapeCooldown ?? getSharedScrapeCooldown();
  const simulate = process.env.PDD_SCRAPE_SIMULATE !== '0';
  const random = ctx.random ?? Math.random;

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

  // Phase 2: Warm-up
  if (simulate) {
    await simulateHumanBrowsing(page, {
      moveCount: 2 + Math.floor(random() * 2),
      scrollSegments: 2,
      dwellMs: [800, 2000],
      noClick: true,
      random,
    });
  }

  await page.waitForSelector('[class*="sku"]', { timeout: 10000 }).catch(() => null);

  const warmRisk = await detectPageRisk(page, { phase: 'source-warmup' });
  if (warmRisk.detected) {
    health.recordRisk(warmRisk);
    throw riskToError(warmRisk);
  }

  // Phase 3: Extract
  const data = await evaluateInMainWorld(page, (nodeGoodsId) => {
    function projectDimensionValue(rawValue) {
      if (typeof rawValue === 'string' || typeof rawValue === 'number') return rawValue;
      if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return null;
      return {
        id: rawValue.id ?? rawValue.valueId ?? rawValue.specValueId
          ?? rawValue.spec_value_id ?? rawValue.specValueID ?? null,
        text: rawValue.text ?? rawValue.name ?? rawValue.value ?? rawValue.label
          ?? rawValue.spec_value ?? rawValue.specValue ?? rawValue.value_name ?? null,
      };
    }

    function projectDimensions(goods) {
      const candidates = [
        goods?.skuDimensions,
        goods?.sku_dimensions,
        goods?.skuProperty,
        goods?.newOptions,
        goods?.options,
      ];
      for (const rawDimensions of candidates) {
        if (!Array.isArray(rawDimensions) || rawDimensions.length === 0) continue;
        const nested = rawDimensions.map((rawDimension) => {
          if (!rawDimension || typeof rawDimension !== 'object' || Array.isArray(rawDimension)) return null;
          const rawValues = rawDimension.values ?? rawDimension.options
            ?? rawDimension.children ?? rawDimension.valueList
            ?? rawDimension.value_list ?? rawDimension.specValues ?? rawDimension.spec_values;
          return {
            name: rawDimension.name ?? rawDimension.key ?? rawDimension.specName
              ?? rawDimension.spec_name ?? rawDimension.specKey ?? rawDimension.spec_key ?? null,
            values: Array.isArray(rawValues)
              ? rawValues.map(projectDimensionValue).filter((value) => value?.text)
              : [],
          };
        }).filter((dimension) => dimension?.name && dimension.values.length > 0);
        if (nested.length > 0) return nested;

        const grouped = new Map();
        for (const rawOption of rawDimensions) {
          if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) continue;
          const name = rawOption.name ?? rawOption.key ?? rawOption.specName
            ?? rawOption.spec_name ?? rawOption.specKey ?? rawOption.spec_key;
          const value = projectDimensionValue(rawOption);
          if (!name || !value?.text) continue;
          if (!grouped.has(String(name))) grouped.set(String(name), []);
          grouped.get(String(name)).push(value);
        }
        if (grouped.size > 0) {
          return [...grouped.entries()].map(([name, values]) => ({ name, values }));
        }
      }
      return [];
    }

    function projectSku(rawSku) {
      return {
        skuID: rawSku?.skuID ?? rawSku?.skuId ?? null,
        groupPrice: rawSku?.groupPrice ?? rawSku?.group_price ?? null,
        normalPrice: rawSku?.normalPrice ?? rawSku?.normal_price ?? null,
        quantity: rawSku?.quantity ?? rawSku?.stock ?? rawSku?.inventory ?? null,
        specValues: rawSku?.specValues ?? rawSku?.spec_values ?? null,
        specs: Array.isArray(rawSku?.specs) ? rawSku.specs : null,
        properties: Array.isArray(rawSku?.properties) ? rawSku.properties : null,
      };
    }

    function findDecodedGoods(root, targetGoodsId) {
      const queue = [{ value: root, depth: 0 }];
      const seen = new WeakSet();
      let visited = 0;
      let fallback = null;
      while (queue.length > 0 && visited < 5000) {
        const current = queue.shift();
        const value = current?.value;
        if (!value || typeof value !== 'object') continue;
        if (seen.has(value)) continue;
        seen.add(value);
        visited += 1;
        const candidateGoodsId = value.goodsID ?? value.goodsId ?? value.goods_id;
        if (String(candidateGoodsId ?? '') === String(targetGoodsId)) {
          if (Array.isArray(value.skus) && value.skus.length > 0) return { goods: value, visited };
          fallback ??= value;
        }
        if (current.depth >= 8) continue;
        const children = Array.isArray(value)
          ? value.slice(0, 500)
          : Object.values(value).slice(0, 500);
        for (const child of children) {
          if (child && typeof child === 'object') queue.push({ value: child, depth: current.depth + 1 });
        }
      }
      return { goods: fallback, visited };
    }

    const decodedSearch = findDecodedGoods(globalThis.rawData, nodeGoodsId);
    const decodedGoodsCandidate = decodedSearch.goods;
    const decodedGoodsId = decodedGoodsCandidate?.goodsID ?? decodedGoodsCandidate?.goodsId
      ?? decodedGoodsCandidate?.goods_id;
    const decodedGoods = String(decodedGoodsId ?? '') === String(nodeGoodsId)
      ? decodedGoodsCandidate
      : null;
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

    const fiberName = decodedGoods?.goodsName || get('goodsName') || get('goodsDesc');
    const domTitle = title.replace(/[-–—|].*/g, '').trim();
    const metaTitle = document.querySelector('meta[property="og:title"]')?.content || '';

    return {
      goodsID: decodedGoodsId || get('goodsID') || String(nodeGoodsId),
      goodsName: fiberName || domTitle || metaTitle || '',
      catID: decodedGoods?.catID ?? get('catID'),
      catID1: decodedGoods?.catID1 ?? get('catID1'),
      catID2: decodedGoods?.catID2 ?? get('catID2'),
      catID3: decodedGoods?.catID3 ?? get('catID3'),
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
      _fiberFound: fiberStr.length > 0,
      _maskHint: /前往APP查看价格|APP内?查看价格|登录后?查看价格|查看完整价格/i.test(body),
      _url: location.href,
      _title: title,
      _bodyLen: body.length,
      _roots: ['main', 'app', 'root'].filter(id => document.getElementById(id)).join(',') || 'none',
      _appWall: /打开(拼多多)?APP|在APP(内|中)?(打开|查看)|下载拼多多|立即打开/i.test(body),
      _decodedSkuSource: decodedGoods ? {
        goodsID: decodedGoodsId,
        skuDimensions: projectDimensions(decodedGoods),
        skus: Array.isArray(decodedGoods.skus) ? decodedGoods.skus.map(projectSku) : [],
        visitedObjects: decodedSearch.visited,
      } : null,
    };
  }, goodsId);

  const decodedSkuCount = Array.isArray(data?._decodedSkuSource?.skus)
    ? data._decodedSkuSource.skus.length
    : 0;
  const skuSnapshot = normalizeSourceSkuSnapshot(data?._decodedSkuSource ?? data);
  delete data._decodedSkuSource;
  data.skuDimensions = skuSnapshot.skuDimensions;
  data.skus = skuSnapshot.skus;

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

  // Phase 3.5: 软风控脱敏判定（激进：price 缺失/非正数，或出现"前往APP查看价格"类价格占位即拦截）
  const hasStructuredPrice = skuSnapshot.skus.some((sku) => sku.sourcePriceCents > 0);
  const priceMasked = (!hasStructuredPrice && isPriceMasked(data.price)) || data._maskHint;
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
      url: page.url(),
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
