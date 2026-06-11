// 🔄 Daemon 分组注册（design D-3）
import * as daemonCmd from '../daemon.js';

export function register(program, wireAction) {
  const daemon = program.command('daemon').description('🔄 后台 auth 自动续期');
  wireAction(
    daemon.command('start').description('启动 daemon（后台定时刷新 cookie）'),
    'daemon.start',
    daemonCmd.start
  );
  wireAction(
    daemon.command('stop').description('停止 daemon'),
    'daemon.stop',
    daemonCmd.stop
  );
  wireAction(
    daemon.command('status').description('查看 daemon 状态'),
    'daemon.status',
    daemonCmd.status
  );
}
