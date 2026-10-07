import { ORDER_DETAIL, ORDER_LIST, ORDER_STATS } from '../../src/adapter/endpoints/orders.js';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import { GOODS_PUBLISH_COST_TEMPLATE_LIST } from '../../src/adapter/endpoints/goods-publish.js';
import { PROMO_ENTITY_REPORT } from '../../src/adapter/endpoints/promo.js';

export const SAMPLE_LIST_STATS = Object.freeze({
  total: 4,
  refund_count: 1,
  refund_rate: 0.25,
  shipping_seconds: { p95: 36000 },
  status_distribution: { '已发货，待收货': 4 },
});

// 上游 recentOrderList.pageItems[] 的真实字段结构（research/upstream-schema-2026-10.md §1），值均为合成数据。
// 金额为分、时间为 unix 秒（0 = 未发生）；含平台内部噪声字段与 PII 字段，用于证明视图白名单丢弃它们。
export const SYNTHETIC_PII_VALUES = Object.freeze([
  'SYN-RECEIVER', 'SYN-MOBILE-13800000000', 'SYN-CONTACT-MOBILE', 'SYN-NICK', 'SYN-PROVINCE',
  'SYN-CITY', 'SYN-DISTRICT', 'SYN-ADDRESS', 'SYN-REFUND-ADDR', 'SYN-REFUND-PHONE',
  'SYN-SHIPPING-PHONE', 'SYN-DELIVERY-PHONE',
]);

export function createUpstreamOrder(overrides = {}) {
  return {
    order_sn: 'SYN-1',
    order_status: 1,
    order_status_str: '已发货，待收货',
    goods_id: 101,
    goods_name: 'Tea',
    spec: '默认',
    goods_number: 2,
    goods_price: 1250,
    goods_amount: 2500,
    merchant_discount: 100,
    platform_discount: 50,
    duoduo_pay_discount: 0,
    shipping_amount: 0,
    order_amount: 2350,
    order_time: 1700000000,
    promise_shipping_time: 1700172800,
    shipping_time: 1700003600,
    payment_start_time: 0,
    receive_time: 0,
    tracking_number: 'SYNTRACK001',
    buyer_memo: '',
    after_sales_status: null,
    waybillDTOList: [{ shippingName: 'SYN 快递', shippingPhone: 'SYN-SHIPPING-PHONE' }],
    // 平台内部噪声字段
    isLuckyFlag: 0, mallRemarkTag: null, groupStatus: 1, risk_status: 0, showPrepareTag: false,
    // PII（D5：不得进入视图）
    receive_name: 'SYN-RECEIVER',
    receive_mobile: 'SYN-MOBILE-13800000000',
    contactMobile: 'SYN-CONTACT-MOBILE',
    nickname: 'SYN-NICK',
    province_name: 'SYN-PROVINCE',
    city_name: 'SYN-CITY',
    district_name: 'SYN-DISTRICT',
    consumerAddress: 'SYN-ADDRESS',
    refundAddressInfo: { address: 'SYN-REFUND-ADDR', phone: 'SYN-REFUND-PHONE' },
    deliveryManPhone: 'SYN-DELIVERY-PHONE',
    ...overrides,
  };
}

// 上游 goods_list[] 的真实字段结构（research §3），值均为合成数据：价格为分的数组（多 SKU），含平台噪声字段
export function createUpstreamGoods(overrides = {}) {
  return {
    goods_id: 101,
    goods_name: 'Tea',
    quantity: 10,
    sku_price: [1590, 1990],
    sku_group_price: [1290, 1690],
    origin_sku_group_price: [1290, 1690],
    promotion_goods: {
      min_price: 1190, max_price: 1590, activity_id: 9001, activity_type: 3,
      activity_name: 'Synthetic 限时折扣', enroll_id: 9002, activity_url_id: 'SYN-URL', activity_id_for_b: 9003,
    },
    mall_id: 900001,
    thumb_url: 'https://example.invalid/thumb.jpg', is_onsale: 1, out_goods_sn: 'SYN-OUT', sold_quantity: 3,
    ...overrides,
  };
}

// 上游 orderDetail 结构：快递公司为 shipping_name，另含支付 / 成团 / 签收时间与开票状态
export function createUpstreamOrderDetail(overrides = {}) {
  const { waybillDTOList: _waybills, ...base } = createUpstreamOrder();
  return {
    ...base,
    order_sn: 'SYN-DETAIL',
    shipping_name: 'SYN 快递',
    pay_time: 1700000060,
    group_time: 1700000120,
    invoice_apply_status_str: '未申请',
    ...overrides,
  };
}

export const SAMPLE_GOODS = Object.freeze([
  { goods_id: 101, goods_name: 'Tea', quantity: 0 },
  { goods_id: 202, goods_name: 'Cup', quantity: 9 },
  { goods_id: 303, goods_name: 'Plate', quantity: 10 },
  { goods_id: 404, goods_name: 'Bag', quantity: 15 },
]);

export const SAMPLE_PROMO_ENTITIES = Object.freeze([
  { planId: 'p1', adId: 'a1', goodsId: '101', scenesType: 1, impression: 100, click: 10, spend: 100, gmv: 300 },
  { plan_id: 'p1', ad_id: 'a1', goods_id: '101', scenesType: 1, impression: 300, click: 30, cost: '300', gmv: '300' },
  { planId: 'p2', adId: 'a2', goodsId: '202', scenesType: 2, impression: 100, click: 0, spend: 100, gmv: 0 },
]);

export const SAMPLE_SEGMENTATION_INPUT = Object.freeze({
  goods: [
    { goods_id: '101', goods_name: 'Tea', quantity: 12 },
    { goods_id: '202', goods_name: 'Cup', quantity: 0 },
  ],
  orders30d: [
    { items: [{ goodsId: 101, goodsName: 'Tea', goodsQuantity: 2 }, { goods_id: '202', goods_name: 'Cup', quantity: 3 }] },
    { goods_id: '101', goods_name: 'Tea', quantity: 4 },
  ],
});

export function createFactResponses() {
  return {
    'endpoints/orders.list.json': {
      success: true,
      result: { totalItemNum: 1, pageItems: [createUpstreamOrder()] },
    },
    'endpoints/orders.detail.json': { success: true, result: createUpstreamOrderDetail() },
    'endpoints/orders.stats.json': { success: true, result: { unship: 1, unship12h: 0, delay: 0, unreceive: 0 } },
    'endpoints/goods.list.json': { success: true, result: { total: 1, goods_list: [createUpstreamGoods()] } },
    'endpoints/goods.publish.cost_template_list.json': {
      cost_template_list: [{ id: 3001, name: 'Synthetic 包邮', free_province_need: null }, { id: 3002, name: 'Synthetic 偏远', free_province_need: null }],
    },
    'endpoints/promo.entityReport.json': {
      success: true,
      result: {
        entityReportList: [{ planId: 'p1', adId: 'a1', goodsId: '101', goodsName: 'Tea', reportInfo: {
          cost: { value: '100' }, gmv: { value: '125' }, impression: 100, click: 10,
        } }],
        totalSumReport: { cost: { value: '100' }, gmv: { value: '125' }, impression: 100, click: 10 },
      },
    },
  };
}

export function createFactFixtures() {
  const responses = createFactResponses();
  // The legacy subprocess adapter expects service-facing data; exercise real parsing first.
  return Object.fromEntries([ORDER_LIST, ORDER_DETAIL, ORDER_STATS, GOODS_LIST, GOODS_PUBLISH_COST_TEMPLATE_LIST, PROMO_ENTITY_REPORT].map((spec) => {
    const path = `endpoints/${spec.name}.json`;
    return [path, spec.normalize(responses[path])];
  }));
}

// goods publish fixture 流程（PDD_TEST_ADAPTER=fixture）：发布结果 + 提交回执，值均为合成数据
export function createPublishFixtures() {
  return {
    'goods-publish/publish-result.json': {
      goods_id: 5001, goods_commit_id: 7001, source_goods_id: '123456', source_title: 'Synthetic Source', warnings: [],
    },
    'endpoints/goods.publish.submit.json': { success: true },
  };
}

// 商家账号 registry（version 1），值均为合成数据；第一个账号为默认账号
export function createAccountRegistry(slugs = ['shop-a', 'shop-b']) {
  const accounts = Object.fromEntries(slugs.map((slug, index) => [slug, {
    slug, displayName: `Synthetic ${slug}`, mallId: String(900001 + index), credential: null,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    lastLoginAt: '2026-10-06T16:30:05.000Z', lastRefreshAt: null, disabled: false, migratedFrom: null,
  }]));
  return { version: 1, defaultAccount: slugs[0] ?? null, updatedAt: '2026-10-01T00:00:00.000Z', accounts };
}
