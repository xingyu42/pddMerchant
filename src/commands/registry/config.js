// 🛠️ 项目内运行配置维护（无需鉴权、浏览器或有效运行配置）
import * as configCmd from '../config.js';

const maintenance = { runtimeConfigPolicy: 'maintenance' };

export function register(program, wireAction) {
  const config = program.command('config').description('🛠️ 查看、校验和修改项目内运行配置');
  wireAction(
    config.command('show').description('显示有效配置、本地覆盖和字段来源'),
    'config.show',
    configCmd.show,
    maintenance,
  );
  wireAction(
    config.command('set')
      .description('设置一个本地公开配置项')
      .argument('<key>', '配置字段')
      .argument('<value>', '配置值'),
    'config.set',
    configCmd.set,
    maintenance,
  );
  wireAction(
    config.command('unset')
      .description('删除一个本地覆盖项')
      .argument('<key>', '配置字段'),
    'config.unset',
    configCmd.unset,
    maintenance,
  );
  wireAction(
    config.command('validate').description('校验基线、本地、环境变量和合并配置'),
    'config.validate',
    configCmd.validate,
    maintenance,
  );
}
