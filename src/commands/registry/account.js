// 👤 Account 分组注册（design D-3）
import * as accountCmd from '../account.js';

export function register(program, wireAction) {
  const account = program.command('account').description('👤 多账号管理');
  wireAction(
    account.command('remove')
      .description('删除账号及其登录态、密码和商品成本（需 --confirm）')
      .requiredOption('--slug <slug>', '账号 slug')
      .option('--confirm', '确认删除，默认预演'),
    'account.remove',
    accountCmd.remove
  );
  wireAction(
    account.command('list').description('列出所有账号'),
    'account.list',
    accountCmd.list
  );
  wireAction(
    account.command('default')
      .description('设置默认账号')
      .requiredOption('--slug <slug>', '账号 slug'),
    'account.default',
    accountCmd.setDefault
  );
}
