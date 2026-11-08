import { start, stop, restart, status, run } from '../daemon.js';

const SUBCOMMANDS = [
  ['start', '后台启动', start],
  ['stop', '停止进程', stop],
  ['restart', '重启进程（更新代码后使用）', restart],
  ['status', '运行状态', status],
  ['run', '前台运行', run],
];

export function register(program, wireAction) {
  const group = program.command('daemon').description('常驻进程管理');
  for (const [name, description, handler] of SUBCOMMANDS) {
    wireAction(group.command(name).description(description), `daemon.${name}`, handler);
  }
}
