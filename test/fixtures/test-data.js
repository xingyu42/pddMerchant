import { toLocalDate } from '../../src/infra/units.js';

const success = (result) => ({ success: true, errorCode: 1000000, result });

export function createTrafficFixtures() {
  const end = '2026-10-30';
  return {
    'endpoints/traffic.readyTime.json': success(end),
    'endpoints/traffic.overviewList.json': success([
      { statDate: '2026-10-29', uv: 10, pv: 20, guv: 8, gpv: 15, payOrdrUsrCnt: 2, payOrdrCnt: 3,
        payOrdrAmt: 12.34, payUvRto: 0.2, payOrdrAup: 4.11, uvCfmVal: 1.234, uv1dPln: 5, uv1dOst: 20 },
      { statDate: end, uv: 20, pv: 30, guv: 18, gpv: 25, payOrdrUsrCnt: 4, payOrdrCnt: 5,
        payOrdrAmt: 23.45, payUvRto: 0.2, payOrdrAup: 4.69, uvCfmVal: 1.1725, uv1dPln: 8, uv1dOst: 25 },
    ]),
    'endpoints/traffic.todayFlow.json': success({ muvRt: 377, mpvRt: 912, guvRt: 350, gpvRt: 801 }),
    // todayRtList 为按小时累计；yesterdayRtList、退款字段与 *Pct 不在输出范围内
    'endpoints/traffic.todayTrade.json': success({ dayList: null, delayData: false,
      todayRtList: [
        { hr: '00', payOrdrAmt: 12.5, payOrdrCnt: 1, payOrdrUsrCnt: 1, payOrdrAup: 12.5, payUvRto: 0.0125 },
        { hr: '01', payOrdrAmt: 745.364, payOrdrCnt: 39, payOrdrUsrCnt: 36, payOrdrAup: 19.112, payUvRto: 0.09549,
          sucRfOrdrAmt1d: null, sucRfOrdrCnt1d: null, mallFavCnt: 3, uvCfmVal: 1.98, payOrdrAmtPct: null },
      ],
      yesterdayRtList: [{ hr: '00', payOrdrAmt: 99, payOrdrCnt: 9, payOrdrUsrCnt: 9 }],
      todayPerHourRtList: [{ hr: '01', payOrdrAmt: 732.86, payOrdrCnt: 38, payOrdrUsrCnt: 35 }] }),
  };
}

export function createGoodsTrafficFixtures({ promo = true, count = 3 } = {}) {
  const fixtures = { 'endpoints/traffic.readyTime.json': success('2026-10-30') };
  for (let page = 1; page <= Math.max(1, Math.ceil(count / 50)); page += 1) {
    const items = Array.from({ length: Math.min(50, count - (page - 1) * 50) }, (_unused, index) => ({
      goodsId: String(101 + (page - 1) * 50 + index), goodsName: '合成商品', goodsUv: 100, goodsPv: 200,
      goodsFavCnt: 3, ordrCrtUsrCnt: 5, ordrVstrRto: 0.05, goodsVcr: 0.02, payOrdrRto: 0.4,
      payOrdrCnt: 4, payOrdrGoodsQty: 5, payOrdrUsrCnt: 2, payOrdrAmt: 20, cnsltUsrQty: 1,
      cate3Name: '合成类目', hdThumbUrl: 'SYN-PRIVATE', adStrategyJumpUrl: 'SYN-PRIVATE', peerPerfUv: 5,
    }));
    const suffix = page === 1 ? '' : `.page${page}`;
    fixtures[`endpoints/traffic.goodsDetailList${suffix}.json`] = success({ goodsDetailList: items, totalNum: count });
  }
  // Same synthetic response for both scenes exercises cross-scene addition; 103 exceeds goods totals.
  fixtures['endpoints/promo.goodsPromotionList.json'] = success(promo ? { adInfos: [
    { goodsId: '101', reportInfo: { directOrderNum: 1, indirectOrderNum: 1, directGmv: 1230,
      indirectGmv: { value: 2 }, spend: { value: 123, unit: 'PERCENT', unitCode: 100 }, click: 3 } },
    { goodsId: '103', reportInfo2: { directOrderNum: 10, indirectOrderNum: 0, directGmv: 30000,
      indirectGmv: 0, spend: 1000, click: 20 } },
  ] } : { adInfos: null, totalAdNum: 0 });
  fixtures['endpoints/traffic.goodsTodayOverview.json'] = success({
    payOrdrAmt: '99.99', payOrdrCnt: '9', payUvRto: '8.88%', gpv: '999', guv: '888', vstGoodsCnt: '5',
    payOrdrAmtRt: '1,203.64', payOrdrCntRt: '39', payUvRtoRt: '9.55%', gpvRt: '801', guvRt: '350',
    vstGoodsCntRt: '2', newMerchant: false,
  });
  fixtures['endpoints/traffic.goodsTodayStat.json'] = success({
    todayGoodsDetail: {
      statDate: '2026-10-31', statHr: null, payOrdrAmt: 745.364, payOrdrAmtCent: 74536, payOrdrCnt: 39,
      payOrdrUsrCnt: 37, payOrdrGoodsQty: 42, goodsUv: 350, goodsPv: 801, ordrVstrRto: 0.12,
      payOrdrRto: 0.85, goodsVcr: 0.1057, goodsFavCnt: 14, imprUsrCnt: 1200, cnsltUsrQty: 6,
    },
    yesterdayGoodsDetail: { payOrdrAmt: 8888, payOrdrCnt: 999 },
    todayGoodsDetailList: [
      { statDate: '2026-10-31', statHr: '02', payOrdrAmt: 200.5, payOrdrAmtCent: 20050, payOrdrCnt: 10,
        payOrdrUsrCnt: 10, payOrdrGoodsQty: 11, goodsUv: 120, goodsPv: 300, ordrVstrRto: 0.1,
        payOrdrRto: 0.8, goodsVcr: 0.0833, goodsFavCnt: 5, imprUsrCnt: 500, cnsltUsrQty: 2 },
      { statDate: '2026-10-31', statHr: '00', payOrdrAmt: null, payOrdrAmtCent: null, payOrdrCnt: null,
        payOrdrUsrCnt: null, payOrdrGoodsQty: null, goodsUv: 15, goodsPv: 25, ordrVstrRto: null,
        payOrdrRto: null, goodsVcr: null, goodsFavCnt: 1, imprUsrCnt: 40, cnsltUsrQty: 0 },
    ],
    yesterdayGoodsDetailList: [{ statDate: '2026-10-30', statHr: '23', payOrdrAmt: 9999 }],
  });
  return fixtures;
}

export function createCustomerServiceFixtures() {
  const summary = { consultUserCnt: 3, needManuReplyConsultUserCnt: 3, receiveUserCnt: 3,
    manuReplyRate3Min: 1, manuReplyRate30s: 0.666666, artificialResponseTime: 14.666,
    unsatisfiedServeScoreCnt: 0, serveRefundCnt: 0, complainCsUserCnt: 0 };
  const empty = Object.fromEntries(Object.keys(summary).map((key) => [key, null]));
  const reference = { avgReplyTimeTop10: 5.555, avgReplyTimeTotal: 20,
    cs_name: 'SYN-CS-PRIVATE', consultUserCntCompare: 99, reply30sRateStapleRank: 5 };
  // 销售数据截至今天往前第 3 天；逐日四种空值形态照实测：无询单记录、询单 0 人、成团 0 人、尚未出数。
  const daysAgo = (count) => toLocalDate(Date.now() - count * 86400000);
  const salesNoise = { csCanImproveSalesAmount: 23.14, inquiryOrderUserCntCompare: 0.5 };
  const salesAverages = { inquiryConfirmRateTop10Avg: 0.817113, inquiryConfirmRateTotalAvg: 0.278309 };
  const salesRow = (count, values, averages = salesAverages) => ({ statDate: daysAgo(count),
    inquiryOrderUserCnt: null, groupUserCnt: null, inquiryOrderTransformRate: null, csSalesAmount: null,
    csCanImproveSalesAmount: 0, ...averages, ...values });
  return {
    'endpoints/cs.overview.json': success({ ...summary, ...reference }),
    'endpoints/cs.monthTrend.json': success([
      { ...empty, ...reference, statDate: daysAgo(2) },
      { ...summary, ...reference, statDate: daysAgo(1) },
    ]),
    'endpoints/cs.salesOverview.json': success({ inquiryOrderUserCnt: 12, groupUserCnt: 6,
      inquiryOrderTransformRate: 0.5, csSalesAmount: 153.666, ...salesNoise }),
    'endpoints/cs.monthSalesTrend.json': success([
      salesRow(7, { inquiryOrderUserCnt: 12, groupUserCnt: 6, inquiryOrderTransformRate: 0.5,
        csSalesAmount: 153.666, csCanImproveSalesAmount: 23.14 }),
      salesRow(6, {}),
      salesRow(5, { inquiryOrderUserCnt: 0, groupUserCnt: 0 }),
      salesRow(4, { inquiryOrderUserCnt: 2, groupUserCnt: 0, inquiryOrderTransformRate: 0 }),
      salesRow(3, { csCanImproveSalesAmount: null },
        { inquiryConfirmRateTop10Avg: null, inquiryConfirmRateTotalAvg: null }),
    ]),
    'endpoints/cs.todayRealtime.json': success({ consultUserCnt: 18, needReplyUserCnt: 2,
      manuReceiveUserCnt: 16, replyRate3Min: 0.875, replyRate3MinThreshold: 0.5, cs_name: 'SYN-CS-PRIVATE' }),
    'endpoints/cs.todayUnreply.json': success({ unreply_num: 1, cs_name: 'SYN-CS-PRIVATE' }),
    'endpoints/cs.todayHourConsult.json': success({
      total: 3,
      list: [
        { hour: 10, replyUser3Min: 4, unReplyUser3Min: 1, extra: 'SYN-CS-PRIVATE' },
        { hour: 0, replyUser3Min: 0, unReplyUser3Min: 0 },
        { hour: 9, replyUser3Min: 3, unReplyUser3Min: 0 },
      ],
    }),
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

const REVIEW_PAGE_SIZE = 40;
const GOODS_SCORES_PAGE_SIZE = 10;

function syntheticGoodsScore(index) {
  const excluded = {
    todayEvaluationCount: 3, avgDescRank: 12, avgLgstRank: 15, avgServRank: 18,
    starless4OrdrDfltRevCnt1m: 4, avgUapplDescRevScr1m: 4.8947, avgAntiDescCtgrpRevScrPct1m: 0,
    hdThumbUrl: 'https://img.example.test/SYN-GOODS-THUMB.jpg', goodsStatus: 1,
  };
  if (index === 1) {
    return { goodsId: 202, goodsName: '零评价商品', goodsUnfkUndfltRevCnt1m: 0,
      avgDescRevScr1m: 0, avgLgstRevScr1m: 0, avgServRevScr1m: 0, ...excluded };
  }
  return { goodsId: 201 + index, goodsName: `合成商品${index + 1}`, goodsUnfkUndfltRevCnt1m: 38,
    avgDescRevScr1m: 4.89473684, avgLgstRevScr1m: 4.756, avgServRevScr1m: 4.912, ...excluded };
}

function addPagedFixtures(fixtures, endpointName, total, pageSize, buildPayload) {
  for (let pageNo = 1; pageNo <= Math.max(1, Math.ceil(total / pageSize)); pageNo += 1) {
    const offset = (pageNo - 1) * pageSize;
    const size = Math.min(pageSize, total - offset);
    const suffix = pageNo === 1 ? '' : `.page${pageNo}`;
    fixtures[`endpoints/${endpointName}${suffix}.json`] = success(buildPayload(offset, size));
  }
}

export function createReviewFixtures({ count = 41, goodsScoresCount = 2 } = {}) {
  const fixtures = {
    'endpoints/reviews.keywordAgg.json': success({
      positiveKeywordList: [{ keywordName: '做工好', num: 4 }], negativeKeywordList: [{ keywordName: '描述不符', num: 2 }],
    }),
    'endpoints/reviews.typeAgg.json': success({ typeList:
      ['商品质量', '商品描述', '商品价格', '商家服务', '物流问题'].map((typeName, index) =>
        ({ typeName, positive: index === 0 ? 4 : 0, negative: index === 1 ? 5 : 0, proportion: index === 0 ? 44 : 14 })),
    }),
  };
  addPagedFixtures(fixtures, 'reviews.list', count, REVIEW_PAGE_SIZE, (offset, size) => ({
    totalRows: count,
    data: Array.from({ length: size }, (_unused, index) => syntheticReview(offset + index)),
  }));
  addPagedFixtures(fixtures, 'reviews.goodsScores', goodsScoresCount, GOODS_SCORES_PAGE_SIZE, (offset, size) => ({
    mallOprGoodsCntStd: goodsScoresCount,
    goodsEvaluates: Array.from({ length: size }, (_unused, index) => syntheticGoodsScore(offset + index)),
  }));
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
// 省 / 市 / 区名称（province_name / city_name / district_name）可输出（D5 修订），不在此列。
export const SYNTHETIC_PII_VALUES = Object.freeze([
  'SYN-RECEIVER', 'SYN-MOBILE-13800000000', 'SYN-CONTACT-MOBILE', 'SYN-NICK',
  'SYN-ADDRESS', 'SYN-REFUND-ADDR', 'SYN-REFUND-PHONE',
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
    // 收货省 / 市 / 区名称（D5 修订：可输出）
    province_name: 'SYN-PROVINCE',
    city_name: 'SYN-CITY',
    district_name: 'SYN-DISTRICT',
    // PII（D5：不得进入视图）
    receive_name: 'SYN-RECEIVER',
    receive_mobile: 'SYN-MOBILE-13800000000',
    contactMobile: 'SYN-CONTACT-MOBILE',
    nickname: 'SYN-NICK',
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
    sku_list: [
      createUpstreamSku(),
      createUpstreamSku({ skuId: 1012, spec: '蓝色-L', skuQuantity: 4, isOnsale: 0 }),
    ],
    ...overrides,
  };
}

// 上游 goods_list[].sku_list[] 的合成规格：字段名来自 issue #3 的真实响应观察，另含平台噪声字段
export function createUpstreamSku(overrides = {}) {
  return {
    skuId: 1011, spec: '红色-M', skuQuantity: 6, isOnsale: 1,
    thumbUrl: 'https://example.invalid/sku.jpg', skuPrice: 1590, outSkuSn: 'SYN-SKU-OUT',
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
  return createFactResponses();
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
  const rows = ['2026-10-30', '2026-10-24'].map((date) => createUpstreamExperience({ pt: date }));
  return {
    'endpoints/experience.navigatorInfo.json': success(createUpstreamExperience()),
    'endpoints/experience.navigatorReadyDate.json': success('2026-10-30'),
    'endpoints/experience.navigatorList.json': success(rows),
  };
}

// 消费者体验提升计划服务费：rfreight 模块成功码为 1000；订单号、收费编号均为合成值
const rfreightSuccess = (result) => ({ success: true, errorCode: 1000, errorMsg: null, result });
const yuanVO = (value, unit = 'YUAN') => ({ unit, value, unitCode: 1 });

export function createUpstreamOrderInsurance(overrides = {}) {
  return {
    orderSn: 'SYN-PLAN-ORDER-1', sn: 'SYN-PLAN-ORDER-1-MI', batchSn: 'SYN-PLAN-BATCH-1', mallId: 'SYN-PLAN-MALL',
    uid: 'SYN-PLAN-UID', serviceAmountVO: yuanVO('1.11'), costVO: yuanVO('1.11'), status: 2,
    feeStatusDesc: '收费成功', displayStatus: 1, effectiveTime: 1762500000000, ineffectiveTime: 0,
    shippingTime: 1762490000000, isFree: false, hasDiscount: false, discount: null, insuranceMode: 1, ...overrides,
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
    last_login_at: '2026-10-06T16:30:05.000Z', is_default: index === 0,
  }));
}

export function createProfitOrders(overrides = [{}]) {
  const now = Math.floor(Date.now() / 1000);
  const end = Math.floor((now + 8 * 3600) / 86400) * 86400 - 8 * 3600;
  return overrides.map((fields, index) => createUpstreamOrder({
    order_sn: `SYN-PROFIT-${index}`, confirm_time: end - 3600, order_time: end - 40 * 86400, pay_status: 2, ...fields,
  }));
}

// insurance：体验提升计划收费记录（按订单号对齐运费险），默认为空列表（全部订单运费险 0）。
export function createProfitFixtures({ orders = createProfitOrders(),
  entities = [{ goodsId: '101', goodsName: 'Tea', spend: 1, gmv: 24, impression: 10, click: 1 }], totalSpend = 1.5,
  insurance = [] } = {}) {
  return {
    'endpoints/orders.list.json': success({ totalItemNum: orders.length, pageItems: orders }),
    'endpoints/promo.entityReport.json': success({
      entityReportList: entities, totalSumReport: { spend: totalSpend, gmv: 24, impression: 10, click: 1 },
    }),
    'endpoints/experiencePlan.orderInsuranceList.json': rfreightSuccess({ total: insurance.length,
      orderInsurances: insurance }),
  };
}

// 商品价格管理列表：结构参照抓包（分、场景 7/8），数值与 ID 全部合成；噪声字段用于断言白名单。
export function receiptDiscount(name, desc, fen) {
  return { promotion_sn: 'SYN-PRIVATE-SN', source_type: 659, source_type_str: name, promo_desc: desc, number: 1,
    discount_amount: fen, mms_link_url: 'https://mms.pinduoduo.com/SYN-PRIVATE' };
}

// 件数只在调用方给出时出现：单件场景与外口径场景可以不带件数。
export function receiptScene(scene, { avg, receipt, number, discounts = [] }) {
  return { consult_price_scene: scene, consult_price_scene_desc: '多件件实收最低场景', merge_promo_detail_list: discounts,
    promo_detail_list: [{ promotion_sn: 'SYN-PRIVATE-SN', discount_amount: avg }], discount_amount_desc: 'SYN-PRIVATE-DESC',
    avg_discount_amount: avg, promo_price_list: [receipt], ...(number === undefined ? {} : { number }),
    same_promo_price_any_number: number === undefined || number === 1 };
}

export function receiptSku(skuId, { spec = '合成规格', group = 2130, activity, scenes }) {
  return { sku_id: skuId, sku_spec: spec, thumb_url: 'https://img.pddpic.com/SYN-PRIVATE.jpeg', group_price: group,
    ...(activity === undefined ? {} : { activity_price_info: activity }), calculate_price_detail_list: scenes };
}

export function receiptGoods(goodsId, skus, { remain = 0, name = '合成商品' } = {}) {
  return { goods_id: goodsId, goods_name: name, thumb_url: 'https://img.pddpic.com/SYN-PRIVATE.jpeg',
    sold_quantity_for_thirty_days: 37, created_at: 1746347634, sku_promo_list: skus, remain_sku_num: remain,
    low_price_warn_sku_count: 0, red_line_price_warn_sku_count: 0, has_red_line_price: false,
    effect_promotion: { promotion_id: 'SYN-PRIVATE' } };
}

// 价格管理接口沿用上游 snake_case 成功码 error_code。
const priceSuccess = (result) => ({ success: true, error_code: 1000000, result });

export const receiptSuccess = (total, goods) => priceSuccess({ total, goods_price_info_list: goods });

function defaultReceiptGoods() {
  const fullReduce = receiptDiscount('全店满减活动', '满50减4', 170);
  const multiDiscounts = [receiptDiscount('全店满减活动', '满100减11', 1100), receiptDiscount('多件优惠', '2件9.5折', 400)];
  return [
    receiptGoods(101, [
      receiptSku(1001, { spec: '黑色-90', activity: {}, scenes: [
        receiptScene(7, { avg: 170, receipt: 1960, discounts: [fullReduce] }),
        receiptScene(8, { avg: 300, receipt: 1830, number: 5, discounts: multiDiscounts }),
      ] }),
      receiptSku(1002, { spec: '黑色-100', activity: { activity_price: 1790, activity_type: 43,
        activity_type_desc: '限量折扣', mms_link_url: 'https://mms.pinduoduo.com/SYN-PRIVATE' },
      scenes: [receiptScene(7, { avg: 0, receipt: 1790 })] }),
    ], { remain: 3 }),
    receiptGoods(102, [
      receiptSku(2001, { spec: '均码', group: 990, scenes: [
        receiptScene(8, { avg: 50, receipt: 940, number: 2, discounts: [receiptDiscount('多件优惠', '2件减1元', 100)] }),
        receiptScene(10, { avg: 99, receipt: 891, discounts: [receiptDiscount('非公开优惠', '合成文案', 99)] }),
      ] }),
    ]),
  ];
}

// 「商家出资所有优惠」口径（场景 10/11）的合成样本，混入常规口径场景 7 用于断言忽略与告警。
export function allCaliberReceiptGoods() {
  return [receiptGoods(101, [receiptSku(1001, { scenes: [
    receiptScene(10, { avg: 270, receipt: 1860, discounts: [receiptDiscount('非公开优惠', '合成文案', 270)] }),
    receiptScene(11, { avg: 420, receipt: 1710, number: 3, discounts: [receiptDiscount('多单立减', '合成立减', 1260)] }),
    receiptScene(7, { avg: 170, receipt: 1960 }),
  ] })])];
}

export const receiptExpandSuccess = (goodsId, skus, name = '合成商品') =>
  priceSuccess({ goods_id: goodsId, goods_name: name, sku_promo_list: skus });

// 默认商品 101 的 remain_sku_num = 3，对应补全接口按 goods_id 变体返回其余 3 个 SKU。
function defaultReceiptExpansions() {
  return { 101: [1003, 1004, 1005].map((skuId) => receiptSku(skuId, { spec: `白色-${skuId}`,
    scenes: [receiptScene(7, { avg: 0, receipt: 2130 })] })) };
}

export function createGoodsReceiptFixtures({ total = 2, goods = defaultReceiptGoods(), pages = {},
  expansions = defaultReceiptExpansions() } = {}) {
  const fixtures = { 'endpoints/goodsPrice.list.json': receiptSuccess(total, goods) };
  for (const [page, list] of Object.entries(pages)) {
    fixtures[`endpoints/goodsPrice.list.page${page}.json`] = receiptSuccess(total, list);
  }
  for (const [goodsId, skus] of Object.entries(expansions)) {
    fixtures[`endpoints/goodsPrice.expand.${goodsId}.json`] = Array.isArray(skus)
      ? receiptExpandSuccess(Number(goodsId), skus) : skus;
  }
  return fixtures;
}
