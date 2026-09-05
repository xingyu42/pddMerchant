export const SAMPLE_LIST_STATS = Object.freeze({
  total: 4,
  refund_count: 1,
  refund_rate: 0.25,
  shipping_seconds: { p95: 36000 },
  status_distribution: { paid: 4 },
});

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

export function createFactFixtures() {
  return {
    'endpoints/orders.list.json': {
      total: 1,
      orders: [{
        order_sn: 'SYN-1',
        goods_id: '101',
        goods_name: 'Tea',
        quantity: 2,
        order_status: 'paid',
        order_time: 1700000000,
        ship_time: 1700003600,
        refund_status: 0,
      }],
    },
    'endpoints/orders.stats.json': { unship: 1, unship12h: 0, delay: 0, unreceive: 0 },
    'endpoints/goods.list.json': { total: 1, goods: [{ goods_id: '101', goods_name: 'Tea', quantity: 10 }] },
    'endpoints/promo.entityReport.json': {
      entities: [{ planId: 'p1', adId: 'a1', goodsId: '101', goodsName: 'Tea', spend: 100, gmv: 125, impression: 100, click: 10 }],
      totals: { spend: 100, gmv: 125, impression: 100, click: 10 },
    },
  };
}
