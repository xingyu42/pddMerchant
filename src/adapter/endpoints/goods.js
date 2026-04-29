export const GOODS_LIST = {
  name: 'goods.list',
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
  normalize: (raw) => ({
    total: raw?.result?.total ?? 0,
    goods: (raw?.result?.goods_list ?? []).map((g) => ({
      goods_id: g.goods_id,
      goods_name: g.goods_name,
      quantity: g.quantity,
      sku_price: g.sku_price,
      sku_group_price: g.sku_group_price,
      origin_sku_group_price: g.origin_sku_group_price,
      promotion: g.promotion_goods,
      mall_id: g.mall_id,
    })),
    sessionId: raw?.result?.sessionId,
    raw,
  }),
  isSuccess: (raw) => raw?.success === true,
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
  isSuccess: (raw) => raw?.success === true,
};
