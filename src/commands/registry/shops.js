// 🏬 Shops 分组注册（design D-3）
import * as list from '../shops/list.js';
import * as current from '../shops/current.js';

export function register(program, wireAction) {
  const shops = program.command('shops').description('🏬 店铺管理');
  wireAction(
    shops.command('list').description('列出当前账号下所有店铺'),
    'shops.list',
    list.run
  );
  wireAction(
    shops.command('current').description('显示当前店铺'),
    'shops.current',
    current.run
  );
}
