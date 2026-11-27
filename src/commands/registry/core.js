// ⚙️ Utility 顶层命令注册：login / doctor（design D-3）
import * as login from '../login.js';
import * as doctor from '../doctor.js';

export function register(program, wireAction) {
  wireAction(
    program
      .command('login')
      .description('⚙️ 登录或刷新登录态（默认弹浏览器；加 --qr 终端扫码，加 --consumer 消费端登录）')
      .option('--qr', '无头模式：终端渲染二维码 + 保存 PNG 到 data/')
      .option('--consumer', '消费端登录（mobile.yangkeduo.com）'),
    'login',
    login.run
  );

  wireAction(
    program
      .command('doctor')
      .description('⚙️ 环境自检（Chromium / auth-state / 登录态）'),
    'doctor',
    doctor.run
  );
}
