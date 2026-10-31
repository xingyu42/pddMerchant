import { ORDER_DETAIL, ORDER_LIST, ORDER_STATS } from '../../src/adapter/endpoints/orders.js';
import { GOODS_LIST } from '../../src/adapter/endpoints/goods.js';
import { GOODS_PUBLISH_COST_TEMPLATE_LIST } from '../../src/adapter/endpoints/goods-publish.js';
import { PROMO_ENTITY_REPORT } from '../../src/adapter/endpoints/promo.js';
import { NAVIGATOR_INFO, NAVIGATOR_READY_DATE, NAVIGATOR_LIST } from '../../src/adapter/endpoints/experience.js';
import { CS_OVERVIEW, CS_MONTH_TREND } from '../../src/adapter/endpoints/customer-service.js';
import { REVIEWS_LIST, REVIEWS_KEYWORD_AGG, REVIEWS_TYPE_AGG } from '../../src/adapter/endpoints/reviews.js';
import { toLocalDate } from '../../src/infra/units.js';

export function createCustomerServiceFixtures() {
  const summary = { consultUserCnt: 3, needManuReplyConsultUserCnt: 3, receiveUserCnt: 3,
    manuReplyRate3Min: 1, manuReplyRate30s: 0.666666, artificialResponseTime: 14.666,
    unsatisfiedServeScoreCnt: 0, serveRefundCnt: 0, complainCsUserCnt: 0 };
  const empty = Object.fromEntries(Object.keys(summary).map((key) => [key, null]));
  const reference = { avgReplyTimeTop10: 5.555, avgReplyTimeTotal: 20,
    cs_name: 'SYN-CS-PRIVATE', consultUserCntCompare: 99, reply30sRateStapleRank: 5 };
  const success = (result) => ({ success: true, errorCode: 1000000, result });
  return {
    'endpoints/cs.overview.json': CS_OVERVIEW.normalize(success({ ...summary, ...reference })),
    'endpoints/cs.monthTrend.json': CS_MONTH_TREND.normalize(success([
      { ...empty, ...reference, statDate: toLocalDate(Date.now() - 2 * 86400000) },
      { ...summary, ...reference, statDate: toLocalDate(Date.now() - 86400000) },
    ])),
  };
}

function syntheticReview(index) {
  return { goodsId: 101 + index, createTime: 1793376000, score: index === 1 ? 3 : 0,
    descScore: 3, logisticsScore: 2, serviceScore: 1, comment: '联系13812345678，描述不符',
    appendReview: index % 2 ? '追评13987654321' : { comment: '追评13987654321', name: 'SYN-REVIEW-PRIVATE' },
    keywords: ['描述不符'], reply: index % 2 ? '' : 'SYN-REVIEW-PRIVATE',
    pictures: ['SYN-REVIEW-PRIVATE/photo1', 'SYN-REVIEW-PRIVATE/photo2'], video: 'SYN-REVIEW-PRIVATE/video',
    name: 'SYN-REVIEW-PRIVATE', avatar: 'SYN-REVIEW-PRIVATE', orderSn: 'SYN-REVIEW-PRIVATE',
    orderId: 'SYN-REVIEW-PRIVATE', specs: 'SYN-REVIEW-PRIVATE', thumbUrl: 'SYN-REVIEW-PRIVATE',
    goodsInfoUrl: 'SYN-REVIEW-PRIVATE', orderSnapshotInfo: { name: 'SYN-REVIEW-PRIVATE' } };
}

export function createReviewFixtures({ count = 11 } = {}) {
  const success = (result) => ({ success: true, errorCode: 1000000, result });
  const fixtures = {
    'endpoints/reviews.keywordAgg.json': REVIEWS_KEYWORD_AGG.normalize(success({
      positiveKeywordList: [{ keywordName: '做工好', num: 4 }], negativeKeywordList: [{ keywordName: '描述不符', num: 2 }],
    })),
    'endpoints/reviews.typeAgg.json': REVIEWS_TYPE_AGG.normalize(success({ typeList:
      ['商品质量', '商品描述', '商品价格', '商家服务', '物流问题'].map((typeName, index) =>
        ({ typeName, positive: index === 0 ? 4 : 0, negative: index === 1 ? 5 : 0, proportion: index === 0 ? 44 : 14 })),
    })),
  };
  for (let pageNo = 1; pageNo <= Math.max(1, Math.ceil(count / 10)); pageNo += 1) {
    const offset = (pageNo - 1) * 10;
    const data = Array.from({ length: Math.min(10, count - offset) }, (_unused, index) => syntheticReview(offset + index));
    const suffix = pageNo === 1 ? '' : `.page${pageNo}`;
    fixtures[`endpoints/reviews.list${suffix}.json`] = REVIEWS_LIST.normalize(success({ totalRows: count, data }));
  }
  return fixtures;
}

export const SAMPLE_LIST_STATS = Object.freeze({
  total: 4,
  refund_count: 1,
  after_sales_count: 1,
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

// Recon metric values; shop identity, dates in the sparse series and noise are synthetic.
export function createUpstreamExperience(overrides = {}) {
  return {
    mallId: 'SYN-EXPERIENCE-ID', mallName: 'SYN-EXPERIENCE-NAME', imageUrl: 'https://example.invalid/experience.png',
    timestamp: '2026-10-29', mallStarTomms: 4.6, mallStarTommsChange: 0,
    mallStarTommsNext: 4.7, mallStarTommsNextPct: 50, scoreRk: 46.136,
    scoreDsc: '良', mallStarDesc: '已超越40%同行', stplName: '母婴', normalFlag: true, delayData: null,
    ptHelpRate1m: 0.0323, ptHelpRate1mNextPctThreshold: null, ptHelpRate1mNextStarRkDesc: null,
    aprsIn3minRplyUsrRto1m: 0.5, aprsIn3minRplyUsrRto1mNextPctThreshold: 0.8,
    aprsIn3minRplyUsrRto1mNextStarRkDesc: 1,
    rfSignTime1m: 27.77, rfSignTime1mNextPctThreshold: 3.995, rfSignTime1mNextStarRkDesc: null,
    rfProcTime1m: null, rfProcTime1mNextPctThreshold: null, rfProcTime1mNextStarRkDesc: null,
    dsr3m: null, dsr3mNextPctThreshold: null, dsr3mNextStarRkDesc: null,
    posTypeRto1m: 0.9091, posTypeRto1mNextPctThreshold: 0.9444, posTypeRto1mNextStarRkDesc: null,
    seriousInferiorRto1m: 0.0013, seriousInferiorRto1mNextPctThreshold: null, seriousInferiorRto1mNextStarRkDesc: null,
    adjNfkAvgCfmSignTime1m: 2.04, adjNfkAvgCfmSignTime1mNextPctThreshold: null, adjNfkAvgCfmSignTime1mNextStarRkDesc: null,
    lgstMergeFine1m: 0.0194, lgstMergeFine1mNextPctThreshold: null, lgstMergeFine1mNextStarRkDesc: null,
    gmvRk: 22.24, gmvRkNextPctThreshold: 50, gmvRkNextStarRkDesc: null,
    isRps: false, isRequireRps: true, isRpsNextStarRkDesc: null,
    mallStarToc: 4.5, avgDescRevScrRcatePct3m: null, ptHelpRate1mRk: 52.92,
    ptHelpRate1mRkDesc: 1, ptHelpRate1m4p5Standard: 0, ptHelpRate1m5Standard: 0, ptHelpRate1mRkStage: 2,
    ...overrides,
  };
}

export function createExperienceFixtures() {
  const success = (result) => ({ success: true, errorCode: 1000000, result });
  const rows = ['2026-10-30', '2026-10-24'].map((date) => createUpstreamExperience({ pt: date }));
  return {
    'endpoints/experience.navigatorInfo.json': NAVIGATOR_INFO.normalize(success(createUpstreamExperience())),
    'endpoints/experience.navigatorReadyDate.json': NAVIGATOR_READY_DATE.normalize(success('2026-10-30')),
    'endpoints/experience.navigatorList.json': NAVIGATOR_LIST.normalize(success(rows)),
  };
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

// 合成数据库账号；第一个账号为默认账号。
export function createAccounts(slugs = ['shop-a', 'shop-b']) {
  return slugs.map((slug, index) => ({
    slug, display_name: `Synthetic ${slug}`, identity: String(900001 + index),
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.000Z',
    last_login_at: '2026-10-06T16:30:05.000Z', disabled: false, is_default: index === 0,
  }));
}

export function createProfitOrders(overrides = [{}]) {
  const now = Math.floor(Date.now() / 1000);
  const end = Math.floor((now + 8 * 3600) / 86400) * 86400 - 8 * 3600;
  return overrides.map((fields, index) => createUpstreamOrder({
    order_sn: `SYN-PROFIT-${index}`, group_time: end - 3600, order_time: end - 40 * 86400, pay_status: 2, ...fields,
  }));
}

export function createProfitFixtures({ orders = createProfitOrders(),
  entities = [{ goodsId: '101', goodsName: 'Tea', spend: 1, gmv: 24, impression: 10, click: 1 }], totalSpend = 1.5 } = {}) {
  return {
    'endpoints/orders.list.json': ORDER_LIST.normalize({ success: true, result: { totalItemNum: orders.length, pageItems: orders } }),
    'endpoints/promo.entityReport.json': PROMO_ENTITY_REPORT.normalize({ success: true, result: {
      entityReportList: entities, totalSumReport: { spend: totalSpend, gmv: 24, impression: 10, click: 1 },
    } }),
  };
}
