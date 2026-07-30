import * as goodsEndpoints from '../src/adapter/endpoints/goods.js';
import * as ordersEndpoints from '../src/adapter/endpoints/orders.js';
import * as promoEndpoints from '../src/adapter/endpoints/promo.js';
import * as goodsPublishEndpoints from '../src/adapter/endpoints/goods-publish.js';

function isEndpointSpec(value) {
  return value?.name && (value.urlPattern || value.strategy === 'page-api');
}

export const allEndpointSpecs = [
  ...Object.values(goodsEndpoints).filter(isEndpointSpec),
  ...Object.values(ordersEndpoints).filter(isEndpointSpec),
  ...Object.values(promoEndpoints).filter(isEndpointSpec),
  ...Object.values(goodsPublishEndpoints).filter(isEndpointSpec),
];
