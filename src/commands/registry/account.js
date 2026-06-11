// 👤 Account 分组注册（design D-3）
import * as accountCmd from '../account.js';

export function register(program, wireAction) {
  const account = program.command('account').description('👤 多账号管理');
  wireAction(
    account.command('add').description('添加新账号（密码登录 + 自动注册）'),
    'account.add',
    accountCmd.add
  );
  wireAction(
    account.command('remove')
      .description('移除账号')
      .requiredOption('--slug <slug>', '账号 slug')
      .option('--remove-files', '同时删除账号目录'),
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
