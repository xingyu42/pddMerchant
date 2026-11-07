import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { toCurrentShopView, toShopListView } from '../../src/services/views/shops.js';
import { toDoctorView, toMerchantLoginView } from '../../src/services/views/auth.js';
import { insertAccount, listAccounts, updateAccount } from '../../src/infra/account-store.js';
import { loadAuthState, saveAuthStateSnapshot } from '../../src/adapter/auth-state.js';
import { toAccountView, toAccountListView, toAccountRemovedView, ACCOUNT_VIEW_FIELDS, ACCOUNT_REMOVED_VIEW_FIELDS } from '../../src/services/views/account.js';
import {
  PASSWORD_RELOGIN_STATUS_LABEL, PASSWORD_RELOGIN_REASON_LABEL, formatPasswordReloginStatus,
} from '../../src/services/views/labels.js';
import { toConsoleAccountView, CONSOLE_ACCOUNT_VIEW_FIELDS,
  CONSOLE_STATUS_LABEL, CONSOLE_LOGIN_REASON_LABEL, CONSOLE_CHALLENGE_DETAIL, CONSOLE_VERDICT_DETAIL,
} from '../../src/services/views/console.js';
import { renderDoctor } from '../../src/commands/doctor.js';

describe('management headlines state only known facts', () => {
  it('separates the removed account slug from the following Chinese text', () => {
    const footprint = { hasPassword: false, hasLoginState: true, goodsCostCount: 0 };
    const view = toAccountRemovedView({ slug: 'synthetic-shop', display_name: null, is_default: 0 }, footprint, { confirm: true });
    assert.deepEqual(view.headline, ['已删除账号 synthetic-shop，连同登录态']);
    assert.deepEqual(Object.keys(view).sort(), [...ACCOUNT_REMOVED_VIEW_FIELDS].sort());
  });

  it('does not invent a shop name when it is missing', () => {
    assert.deepEqual(toCurrentShopView({ activeId: '445301049', activeName: '', source: 'state' }).headline, [
      '当前店铺 ID 445301049（未获取到店铺名）',
    ]);
    assert.deepEqual(toShopListView([{ id: '1', name: '' }], '1').headline, ['共 1 个店铺；当前店铺 ID 1（未获取到店铺名）']);
    assert.deepEqual(toCurrentShopView({ activeId: null }).headline, ['未能识别当前店铺']);
    assert.deepEqual(toMerchantLoginView({ identity: { mallId: '1' }, mode: 'qr' }).headline, [
      '商家端授权成功：店铺 ID 1（未获取到店铺名）',
    ]);
  });

  it.each([
    [undefined, '无法判定'],
    [{ ok: true }, '已验证'],
    [{ ok: false }, '无法判定'],
    [{ ok: true, detail: { verdict: null } }, '已验证'],
    [{ ok: false, detail: { verdict: '' } }, '无法判定'],
    [{ ok: true, detail: { verdict: 'rejected' } }, '已失效'],
    [{ ok: false, detail: { verdict: 'verified' } }, '已验证'],
    [{ ok: true, detail: { verdict: 'unrecognized' } }, '未知(unrecognized)'],
  ])('uses the doctor verdict before its ok-based fallback: %j', (loggedIn, verdict) => {
    const view = toDoctorView({ logged_in: loggedIn });
    assert.equal(view.headline[0], `Chromium 不可用；商家端登录态${verdict}；用户端未配置或无效`);
  });

  it('counts auth-state files without calling them saved credentials', () => {
    const first = insertAccount({ identity: '900001', displayName: 'A' });
    insertAccount({ identity: '900002', displayName: 'B' });
    saveAuthStateSnapshot({ cookies: [], origins: [] }, first.id);
    const accounts = listAccounts().map((account) => ({ slug: account.slug, displayName: account.display_name,
      auth_file: { ok: loadAuthState(account.id).exists, detail: { exists: loadAuthState(account.id).exists } } }));
    const view = toDoctorView({
      chromium: { ok: true, detail: {} },
      auth_file: { ok: true, detail: { exists: true, cookies: 1, origins: 0 } },
      logged_in: { ok: true, detail: { configured: true, verdict: 'verified', reason: 'shop_read' } },
      consumer_auth_file: { ok: false, detail: { exists: false } },
      consumer_logged_in: { ok: false, detail: { configured: false } },
      accounts,
    });
    assert.equal(view.headline[1], '账号登录态文件 1/2 可用');
    assert.ok(view.headline.every((line) => !line.includes('凭据')));
    assert.equal(Object.hasOwn(view.accounts[0], 'has_credential'), false);
  });

  it('projects account status and timestamps from database rows without retired fields', () => {
    const first = insertAccount({ identity: '900001', displayName: 'A' }, { setDefault: true });
    updateAccount(first.id, { lastLoginAt: '2026-01-01T00:00:00.000Z' });
    const view = toAccountListView(listAccounts(), first.slug);
    assert.deepEqual(Object.keys(view.items[0]).sort(), [...ACCOUNT_VIEW_FIELDS].sort());
    assert.deepEqual(view.headline, [`共 1 个账号，默认账号：${first.slug}`]);
    assert.equal(view.items[0].is_default, true);
    assert.equal(view.items[0].last_login_at, '2026-01-01 08:00:00');
    assert.equal(Object.hasOwn(view.items[0], 'has_credential'), false);
    assert.equal(Object.hasOwn(view.items[0], 'last_refresh_at'), false);
  });
});

function assertConsoleStatus(input, expected) {
  const account = { slug: 'synthetic-shop', display_name: 'Shop', identity: '900001' };
  const metadata = input.metadata ?? { check_verdict: input.verdict };
  const summary = { has_password: true, status: 'available', ...input.summary };
  const actions = input.actions ?? [];
  const before = structuredClone({ account, metadata, summary, actions });
  const view = toConsoleAccountView(account, metadata, summary, actions);
  assert.deepEqual([view.status_kind, view.status, view.status_detail], expected);
  assert.deepEqual(Object.keys(view), [...CONSOLE_ACCOUNT_VIEW_FIELDS]);
  assert.doesNotMatch(`${view.status} ${view.status_detail}`, /熔断|接管|会话|重登/);
  assert.deepEqual({ account, metadata, summary, actions }, before);
  const privateFields = { password: 'private-password', login_name: 'private-login', unrelated: 'private-field' };
  assert.deepEqual(toConsoleAccountView({ ...account, ...privateFields }, { ...metadata, ...privateFields },
    { ...summary, ...privateFields }, actions.map((action) => ({ ...action, ...privateFields }))), view);
  return view;
}

function consoleAction(reason, kind = 'human_takeover', status = 'open') {
  return { reason, kind, status, created_at: '2026-01-01T00:00:00.000Z' };
}

describe('console account status view', () => {
  it('freezes the four console-only label tables', () => {
    for (const table of [CONSOLE_STATUS_LABEL, CONSOLE_LOGIN_REASON_LABEL, CONSOLE_CHALLENGE_DETAIL, CONSOLE_VERDICT_DETAIL]) {
      assert.equal(Object.isFrozen(table), true);
    }
  });

  it.each([true, false])('projects verified with has_password=%s', (hasPassword) => {
    assertConsoleStatus({ verdict: 'verified', summary: { has_password: hasPassword } }, ['verified', '正常', null]);
  });

  it.each([
    ['rejected', 'relogin_required', '失效', null],
    ['verified', 'verified', '正常', null],
    ['indeterminate', 'unknown', '未知', '上次核验无法判定'],
    [null, 'unknown', '未知', '暂无核验记录'],
    [undefined, 'unknown', '未知', '暂无核验记录'],
    ['', 'unknown', '未知', '暂无核验记录'],
    ['failed', 'unknown', '未知', '上次核验未通过'],
    ['not_configured', 'unknown', '未知', '尚未配置登录信息'],
    ['private-verdict', 'unknown', '未知', '上次核验结果未知'],
    ['constructor', 'unknown', '未知', '上次核验结果未知'],
  ])('projects verdict %s with a fixed detail or none', (verdict, kind, status, detail) => {
    assertConsoleStatus({ verdict }, [kind, status, detail]);
  });

  it.each([true, false])('prioritizes blocked over verified and pending actions with has_password=%s', (hasPassword) => {
    const view = assertConsoleStatus({ verdict: 'verified', summary: { has_password: hasPassword,
      status: 'blocked', reason: 'wrong_password' }, actions: [consoleAction('sms')] },
    ['relogin_paused', '暂停', '自动登录暂停：密码错误']);
    assert.equal(view.password_relogin_status, hasPassword ? '已熔断：密码错误' : null);
  });

  it.each([
    ['sms', '短信验证'], ['slider', '滑块验证'], ['click', '点选验证'],
    ['risk_confirm', '安全确认'], ['unknown', '安全验证'],
  ])('uses the current challenge %s before an older SMS action', (reason, detail) => {
    for (const actions of [[], [consoleAction('sms')]]) {
      assertConsoleStatus({ verdict: 'rejected', summary: { status: 'awaiting_human', reason }, actions },
        ['action_required', '需验证', `需要完成${detail}`]);
    }
  });

  it.each([
    [[consoleAction('sms')], '待处理：短信验证'],
    [[consoleAction('wrong_password', 'relogin_blocked'), consoleAction('slider'), consoleAction('sms')], '待处理：滑块验证'],
    [[consoleAction('slider', 'human_takeover', 'resolved'), consoleAction('sms')], '待处理：短信验证'],
    [[consoleAction('wrong_password', 'relogin_blocked')], '待处理：密码错误'],
    [[consoleAction('click', 'other_action'), consoleAction('sms', 'other_action')], '待处理：点选验证'],
  ])('uses the first open human action, falling back to the first open action: %j', (actions, detail) => {
    assertConsoleStatus({ verdict: 'verified', actions }, ['action_required', '需验证', detail]);
  });

  it('ignores resolved actions when selecting the overall status', () => {
    const view = assertConsoleStatus({ verdict: 'verified', actions: [consoleAction('sms', 'human_takeover', 'resolved')] },
      ['verified', '正常', null]);
    assert.deepEqual(view.pending_actions, []);
  });

  it.each([undefined, null, '', 'private-reason', 'constructor', '__proto__'])('uses fixed fallbacks for reason %s', (reason) => {
    assertConsoleStatus({ summary: { status: 'blocked', reason } }, ['relogin_paused', '暂停', '自动登录已暂停']);
    assertConsoleStatus({ summary: { status: 'awaiting_human', reason } }, ['action_required', '需验证', '需要完成安全验证']);
    assertConsoleStatus({ actions: [consoleAction(reason)] }, ['action_required', '需验证', '有待处理事项']);
  });

  it.each([
    ['wrong_password', '密码错误'], ['account_locked', '账号被锁'], ['takeover_timeout', '验证超时'],
  ])('labels blocked reason %s', (reason, detail) => {
    assertConsoleStatus({ summary: { status: 'blocked', reason } }, ['relogin_paused', '暂停', `自动登录暂停：${detail}`]);
  });

  it.each([
    ['rejected', '已失效', 'relogin_required', '失效', null],
    [null, '已验证', 'verified', '正常', null],
    ['', null, 'unknown', '未知', '暂无核验记录'],
  ])('shares the verdict precedence with session_status for last_check=%s', (verdict, sessionStatus, kind, status, detail) => {
    const view = assertConsoleStatus({ metadata: { last_check: { verdict }, check_verdict: 'verified' } }, [kind, status, detail]);
    assert.equal(view.session_status, sessionStatus);
  });
});

describe('password relogin output labels', () => {
  it('freezes both label tables', () => {
    assert.equal(Object.isFrozen(PASSWORD_RELOGIN_STATUS_LABEL), true);
    assert.equal(Object.isFrozen(PASSWORD_RELOGIN_REASON_LABEL), true);
  });

  it.each([
    [undefined, null],
    [{ has_password: false, status: 'blocked', reason: 'wrong_password' }, null],
    [{ has_password: true, status: 'available', reason: 'sms' }, '可用'],
    [{ has_password: true, status: 'awaiting_human', reason: 'sms' }, '等待人工：短信验证'],
    [{ has_password: true, status: 'awaiting_human', reason: 'slider' }, '等待人工：滑块验证'],
    [{ has_password: true, status: 'awaiting_human', reason: 'click' }, '等待人工：点选验证'],
    [{ has_password: true, status: 'awaiting_human', reason: 'risk_confirm' }, '等待人工：风控确认'],
    [{ has_password: true, status: 'awaiting_human', reason: 'unknown' }, '等待人工：未识别的验证'],
    [{ has_password: true, status: 'blocked', reason: 'wrong_password' }, '已熔断：密码错误'],
    [{ has_password: true, status: 'blocked', reason: 'account_locked' }, '已熔断：账号被锁'],
    [{ has_password: true, status: 'blocked', reason: 'takeover_timeout' }, '已熔断：接管超时'],
    [{ has_password: true, status: 'awaiting_human', reason: 'new_reason' }, '等待人工'],
    [{ has_password: true, status: 'blocked', reason: null }, '已熔断'],
    [{ has_password: true, status: 'blocked', reason: 'constructor' }, '已熔断'],
    [{ has_password: true, status: 'new_status', reason: 'sms' }, null],
  ])('formats %j as %s without raw enum fallbacks', (summary, expected) => {
    assert.equal(formatPasswordReloginStatus(summary), expected);
  });
});

describe('account password relogin views', () => {
  it('projects doctor relogin summaries in the view layer', () => {
    const passwordRelogin = { has_password: true, status: '可用' };
    const view = toDoctorView({
      password_relogin: passwordRelogin,
      accounts: [
        { slug: 'available', relogin: { has_password: true, status: 'available' } },
        { slug: 'awaiting', relogin: { has_password: true, status: 'awaiting_human', reason: 'sms' } },
        { slug: 'blocked', relogin: { has_password: true, status: 'blocked', reason: 'wrong_password' } },
        { slug: 'no-password' },
      ],
    });
    assert.deepEqual(view.password_relogin, passwordRelogin);
    assert.deepEqual(Object.keys(view), [
      'headline', 'chromium', 'auth_file', 'logged_in', 'password_relogin',
      'consumer_auth_file', 'consumer_logged_in', 'accounts',
    ]);
    assert.deepEqual(view.accounts.map((account) => [account.has_password, account.password_relogin_status]), [
      [true, '可用'], [true, '等待人工：短信验证'], [true, '已熔断：密码错误'], [false, null],
    ]);
    for (const account of view.accounts) {
      assert.deepEqual(Object.keys(account), ['slug', 'display_name', 'auth_file', 'has_password', 'password_relogin_status']);
    }
  });

  it.each([
    [undefined, false, null],
    [{ has_password: false, status: 'available' }, false, null],
    [{ has_password: true, status: 'available' }, true, '可用'],
    [{ has_password: true, status: 'awaiting_human', reason: 'sms' }, true, '等待人工：短信验证'],
    [{ has_password: true, status: 'blocked', reason: 'wrong_password' }, true, '已熔断：密码错误'],
  ])('projects only account and relogin view fields for %j', (relogin, hasPassword, status) => {
    const account = { slug: 'synthetic-shop', relogin };
    const view = toAccountView(account);
    assert.deepEqual(Object.keys(view), [...ACCOUNT_VIEW_FIELDS]);
    assert.equal(view.has_password, hasPassword);
    assert.equal(view.password_relogin_status, status);
    assert.deepEqual(toAccountView({ ...account, login_name: 'private-login', password: 'private-password',
      receiver: 'private-receiver', relogin: relogin && { ...relogin, login_name: 'private-login' } }), view);
    assert.equal(toAccountListView([account]).items[0].password_relogin_status, status);
  });

  it.each([null, '可用', '等待人工：短信验证', '已熔断：密码错误'])(
    'renders one human-readable password relogin line for %s', (status) => {
      const output = renderDoctor({ data: { password_relogin: { has_password: status != null, status } } });
      assert.equal(output.split('\n').filter((line) => line.startsWith('密码重登：')).length, 1);
      assert.ok(output.includes(`密码重登：${status ?? '未保存密码'}`));
    },
  );
});
