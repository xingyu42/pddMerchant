import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { isMockEnabled, loadFixture } from '../mock-dispatcher.js';

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

export function validateScrapedData(data) {
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
}

export async function scrapeSourceGoods(page, goodsId, ctx = {}) {
  if (isMockEnabled()) return loadFixture('goods-publish/source.json');

  const url = `https://mobile.yangkeduo.com/goods.html?goods_id=${goodsId}&refer_page_name=search_result&refer_page_id=10033&refer_page_sn=10033`;

  const [, ] = await Promise.all([
    page.waitForResponse(r => r.url().includes('oak/integration/render'), { timeout: 15000 }).catch(() => null),
    page.goto(url, { waitUntil: 'domcontentloaded' }),
  ]);

  await page.waitForSelector('[class*="sku"]', { timeout: 10000 }).catch(() => null);

  const data = await page.evaluate(() => {
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

    const fiberName = get('goodsName') || get('goodsDesc');
    const domTitle = title.replace(/[-–—|].*/g, '').trim();
    const metaTitle = document.querySelector('meta[property="og:title"]')?.content || '';

    return {
      goodsID: get('goodsID') || String(goodsId),
      goodsName: fiberName || domTitle || metaTitle || '',
      catID: get('catID'),
      catID1: get('catID1'),
      catID2: get('catID2'),
      catID3: get('catID3'),
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
    };
  });

  validateScrapedData(data);
  return data;
}
