import { listMalls } from '../adapter/mall-reader.js';
import { toShopListView } from './views/shops.js';

// shops.list：优先使用 runner 已解析的店铺列表，缺失时再读取
export async function getShopListView(ctx) {
  const cached = ctx.mallCtx?.malls;
  const records = Array.isArray(cached) && cached.length > 0
    ? cached
    : await (ctx.runtime?.ports?.mall?.listMalls
      ? ctx.runtime.ports.mall.listMalls(ctx.page)
      : listMalls(ctx.page));
  return toShopListView(records, ctx.mallCtx?.activeId ?? null);
}
