import { describe, expect, it } from 'vitest';
import { renderDoctor } from '../src/commands/doctor.js';

describe('doctor human output', () => {
  it('成功时只显示关键状态，不输出底层详情', () => {
    const output = renderDoctor({
      command: 'doctor',
      data: {
        chromium: {
          ok: true,
          detail: { path: 'C:\\secret\\chrome.exe' },
        },
        auth_file: {
          ok: true,
          detail: { path: 'D:\\secret\\auth-state.json', cookies: 12, origins: 1 },
        },
        logged_in: {
          ok: true,
          detail: { url: 'https://mms.pinduoduo.com/', shops: 2, mall_source: 'state' },
        },
        consumer_auth_file: { ok: true, detail: { exists: true } },
        consumer_logged_in: {
          ok: true,
          detail: { url: 'https://mobile.yangkeduo.com/' },
        },
        daemon: {
          ok: true,
          detail: { running: true, pid: 1234 },
        },
        accounts: [
          { slug: 'shop-a', auth_file: { ok: true } },
          { slug: 'shop-b', auth_file: { ok: false } },
        ],
      },
    });

    expect(output).toBe([
      'OK  doctor',
      '✓ Chromium 可用',
      '✓ 商家端凭据可用',
      '✓ 商家端登录态有效（2 个店铺）',
      '✓ 用户端登录态有效',
      '✓ 后台续期运行中',
      '账号凭据 1/2 可用',
    ].join('\n'));
    expect(output).not.toContain('chrome.exe');
    expect(output).not.toContain('auth-state.json');
    expect(output).not.toContain('https://');
    expect(output).not.toContain('1234');
  });

  it('守护进程未运行时显示中性提示，并省略未知店铺数', () => {
    const output = renderDoctor({
      command: 'doctor',
      data: {
        logged_in: { ok: true, detail: { shops: null } },
        consumer_auth_file: { ok: false, detail: { exists: false } },
        consumer_logged_in: { ok: false, detail: { configured: false } },
        daemon: { ok: false, detail: { running: false } },
      },
    });

    expect(output).toContain('✓ 商家端登录态有效');
    expect(output).not.toContain('个店铺');
    expect(output).toContain('· 用户端未配置');
    expect(output).toContain('· 后台续期未运行');
    expect(output).not.toContain('账号凭据');
  });
});
