// 🏬 Shops 分组注册（design D-3）
import * as list from '../shops/list.js';

export function register(program, wireAction) {
  const shops = program.command('shops').description('🏬 店铺管理');
  wireAction(
    shops.command('list').description('列出当前账号下所有店铺并标记当前店铺'),
    'shops.list',
    list.run
  );
}
