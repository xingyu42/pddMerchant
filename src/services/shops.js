import { listMalls } from '../adapter/mall-reader.js';
import { toCurrentShopView, toShopListView } from './views/shops.js';

// shops.list：优先使用 runner 已解析的店铺列表，缺失时再读取
export async function getShopListView(ctx) {
  const cached = ctx.mallCtx?.malls;
  const records = Array.isArray(cached) && cached.length > 0 ? cached : await listMalls(ctx.page);
  return toShopListView(records, ctx.mallCtx?.activeId ?? null);
}

export function getCurrentShopView(ctx) {
  return toCurrentShopView(ctx.mallCtx);
}
