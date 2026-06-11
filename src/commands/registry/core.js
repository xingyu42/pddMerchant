// ⚙️ Utility 顶层命令注册：init / login / doctor（design D-3）
import * as init from '../init.js';
import * as login from '../login.js';
import * as doctor from '../doctor.js';

export function register(program, wireAction) {
  wireAction(
    program
      .command('init')
      .description('⚙️ 首次交互式登录（默认弹浏览器；加 --qr 则无头扫码）')
      .option('--qr', '无头模式：终端渲染二维码 + 保存 PNG 到 data/'),
    'init',
    init.run
  );

  wireAction(
    program
      .command('login')
      .description('⚙️ 重新登录（刷新 auth-state）')
      .option('--qr', '无头模式：终端渲染二维码 + 保存 PNG 到 data/')
      .option('--password', '密码登录模式（交互式输入手机号+密码）')
      .option('--consumer', '消费端登录（mobile.yangkeduo.com）'),
    'login',
    login.run
  );

  wireAction(
    program
      .command('doctor')
      .description('⚙️ 环境自检（Chromium / auth-state / 登录态）')
      .option('--probe <mode>', 'mall context 探测策略：xhr = state 探测 miss 时主动 reload 激活 XHR 兜底；默认不额外探测'),
    'doctor',
    doctor.run
  );
}
