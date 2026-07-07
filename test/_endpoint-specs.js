import * as goodsEndpoints from '../src/adapter/endpoints/goods.js';
import * as ordersEndpoints from '../src/adapter/endpoints/orders.js';
import * as promoEndpoints from '../src/adapter/endpoints/promo.js';
import * as goodsPublishEndpoints from '../src/adapter/endpoints/goods-publish.js';

export const allEndpointSpecs = [
  ...Object.values(goodsEndpoints).filter((e) => e?.name && e?.urlPattern),
  ...Object.values(ordersEndpoints).filter((e) => e?.name && e?.urlPattern),
  ...Object.values(promoEndpoints).filter((e) => e?.name && e?.urlPattern),
  ...Object.values(goodsPublishEndpoints).filter((e) => e?.name && e?.urlPattern),
];
