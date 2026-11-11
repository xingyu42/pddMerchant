import { evaluateInMainWorld } from '../browser.js';
import { responseShapeError } from '../../infra/errors.js';
import { isSuccessfulResponse, mapWriteBusinessError, WRITE_SUCCESS_RULE } from '../response-interpreter.js';

function isCount(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
    && Number.isFinite(Number(value)) && Number(value) >= 0;
}

// 规格白名单投影：只保留四个字段；sku_list 缺失或非数组 → null（规格数据不可用，区别于零个规格）
function normalizeSkuList(list) {
  if (!Array.isArray(list)) return null;
  return list.map((sku) => ({
    skuId: sku?.skuId ?? null,
    spec: sku?.spec ?? null,
    skuQuantity: isCount(sku?.skuQuantity) ? Number(sku.skuQuantity) : null,
    isOnsale: sku?.isOnsale ?? null,
  }));
}

export const GOODS_LIST = {
  name: 'goods.list',
  fixtureListKey: 'result.goods_list',
  urlPattern: /vodka\/v2\/mms\/query\/display\/mall\/goodsList/,
  apiUrl: '/vodka/v2/mms/query/display/mall/goodsList',
  nav: {
    url: 'https://mms.pinduoduo.com/goods/goods_list/v2',
    readyEl: 'table, [class*="goods"], [class*="list"]',
  },
  trigger: async () => {
    // 页面自动加载，collector 在导航前已挂载
  },
  buildPayload: (params = {}) => ({
    pre_sale_type: 4,
    page: params.page ?? 1,
    out_goods_sn_gray_flag: true,
    shipment_time_type: 3,
    is_onsale: params.status === 'offline' ? 0 : 1,
    sold_out: 0,
    size: params.size ?? 10,
  }),
  normalize: (raw) => {
    const result = raw?.result;
    if (!isCount(result?.total) || !Array.isArray(result?.goods_list)) {
      throw responseShapeError('goods.list', 'result.total/result.goods_list');
    }
    if (result.goods_list.some((goods) => !goods || !isCount(goods.quantity))) {
      throw responseShapeError('goods.list', 'goods_list[].quantity');
    }
    return {
      total: Number(result.total),
      goods: result.goods_list.map((g) => ({
        goods_id: g.goods_id ?? g.goodsId ?? g.id ?? null,
        goods_name: g.goods_name,
        quantity: Number(g.quantity),
        sku_price: g.sku_price,
        sku_group_price: g.sku_group_price,
        origin_sku_group_price: g.origin_sku_group_price,
        promotion: g.promotion_goods,
        mall_id: g.mall_id,
        sku_list: normalizeSkuList(g.sku_list),
      })),
      sessionId: result.sessionId,
      raw,
    };
  },
  successRule: { mode: 'flag' },
};

// --- Write endpoints (recon 2026-05-07, goods_id=673182058048) ---

export const GOODS_UPDATE_STATUS = {
  name: 'goods.update.status',
  urlPattern: /vodka\/v2\/mms\/pc\/(onSale|offSale)/,
  nav: {
    url: (params) => {
      const tab = params.status === 'onsale' ? 'key_4' : 'key_2';
      return `https://mms.pinduoduo.com/goods/goods_list?activeKeyNew=${tab}`;
    },
    readyEl: 'table, [class*="goods"], [class*="list"]',
  },
  trigger: async (page, params) => {
    const goodsId = String(params.goods_id);
    const btnText = params.status === 'onsale' ? '上架' : '下架';

    const searchInput = page.locator('input[placeholder*="多个查询"]').first();
    await searchInput.fill(goodsId);
    await page.locator('button:has-text("查询")').click();
    await page.waitForResponse((r) => r.url().includes('goodsList') && r.status() === 200);

    const row = page.locator(`tr:has-text("${goodsId}")`).first();
    await row.waitFor({ timeout: 10000 });
    await row.locator(`a:has-text("${btnText}")`).click();

    const confirmBtn = page.locator('[class*="MDL_okBtn"], button:has-text("确认")').first();
    await confirmBtn.waitFor({ timeout: 5000 });
    await confirmBtn.click();
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    success: isSuccessfulResponse(raw, WRITE_SUCCESS_RULE),
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapWriteBusinessError,
};

export const GOODS_UPDATE_PRICE = {
  name: 'goods.update.price',
  urlPattern: /guide-api\/mms\/sync\/edit\/price/,
  nav: {
    url: 'https://mms.pinduoduo.com/goods/goods_list/v2',
    readyEl: 'table, [class*="goods"], [class*="list"]',
  },
  trigger: async (page, params) => {
    await evaluateInMainWorld(page, ({ goods_id, sku_id, price }) => {
      return fetch('/guide-api/mms/sync/edit/price', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goods_list: [{
            goods_id,
            sku_info_list: [{ sku_id, price, multi_price: price }],
          }],
        }),
      });
    }, {
      goods_id: params.goods_id,
      sku_id: params.sku_id ?? null,
      price: params.price,
    });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    success: isSuccessfulResponse(raw, WRITE_SUCCESS_RULE),
    fail_goods_num: raw?.fail_goods_num ?? 0,
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapWriteBusinessError,
};

export const GOODS_UPDATE_STOCK = {
  name: 'goods.update.stock',
  urlPattern: /guide-api\/mms\/sync\/edit\/quantity/,
  nav: {
    url: 'https://mms.pinduoduo.com/goods/goods_list/v2',
    readyEl: 'table, [class*="goods"], [class*="list"]',
  },
  trigger: async (page, params) => {
    await evaluateInMainWorld(page, ({ goods_id, sku_id, quantity }) => {
      return fetch('/guide-api/mms/sync/edit/quantity', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goods_list: [{
            goods_id,
            sku_info_list: [{ sku_id, quantity }],
          }],
        }),
      });
    }, {
      goods_id: params.goods_id,
      sku_id: params.sku_id ?? null,
      quantity: params.quantity,
    });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    success: isSuccessfulResponse(raw, WRITE_SUCCESS_RULE),
    fail_goods_num: raw?.fail_goods_num ?? 0,
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapWriteBusinessError,
};

export const GOODS_UPDATE_TITLE = {
  name: 'goods.update.title',
  urlPattern: /guide-api\/mms\/goodsName\/batch_edit/,
  nav: {
    url: 'https://mms.pinduoduo.com/goods/goods_list/v2',
    readyEl: 'table, [class*="goods"], [class*="list"]',
  },
  trigger: async (page, params) => {
    const goods_id2_name = {};
    goods_id2_name[String(params.goods_id)] = params.title;
    await evaluateInMainWorld(page, ({ payload }) => {
      return fetch('/guide-api/mms/goodsName/batch_edit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }, { payload: { goods_id2_name } });
  },
  requiredTrigger: true,
  normalize: (raw) => ({
    success: isSuccessfulResponse(raw, WRITE_SUCCESS_RULE),
    raw,
  }),
  successRule: WRITE_SUCCESS_RULE,
  errorMapper: mapWriteBusinessError,
};

export const GOODS_AD_STRATEGY = {
  name: 'goods.adStrategy',
  urlPattern: /mms-gateway\/mms\/home\/goods\/queryMmsGoodsListAdStrategy/,
  apiUrl: '/mms-gateway/mms/home/goods/queryMmsGoodsListAdStrategy',
  nav: {
    url: 'https://mms.pinduoduo.com/goods/goods_list/v2',
    readyEl: 'table, [class*="goods"], [class*="list"]',
  },
  trigger: async () => {
    // 与 GOODS_LIST 并行自动加载
  },
  buildPayload: (params = {}) => ({
    clientType: 1,
    goodsIds: params.goodsIds ?? [],
  }),
  normalize: (raw) => ({
    strategies: raw?.result ?? raw?.data ?? [],
    raw,
  }),
  successRule: { mode: 'flag' },
};
