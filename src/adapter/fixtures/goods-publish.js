// fixture goods-publish provider（design D-4）：商品发布、源商品采集、类目解析 mock。
import { loadFixture } from './core.js';

export function mockPublishGoods() {
  return loadFixture('goods-publish/publish-result.json');
}

export function mockScrapeSourceGoods() {
  return loadFixture('goods-publish/source.json');
}

export function mockResolvePddCategory() {
  return loadFixture('goods-publish/category.json');
}
