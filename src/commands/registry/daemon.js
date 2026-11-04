import * as daemon from '../daemon.js';

export function register(program, wireAction) {
  const group = program.command('daemon').description('常驻进程管理');
  for (const [name, description] of Object.entries({ start: '后台启动', stop: '停止进程', restart: '重启进程（更新代码后使用）', status: '运行状态', run: '前台运行' })) {
    wireAction(group.command(name).description(description), `daemon.${name}`, daemon[name]);
  }
}
