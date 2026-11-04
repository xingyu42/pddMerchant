import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { webcrypto } from 'node:crypto';
import { it, vi } from 'vitest';
import htm from '../../src/console/vendor/htm.mjs';

const h = (type, props, ...children) => ({ type, props: { ...props, children } });

const source = readFileSync(new URL('../../src/console/public/app/app.js', import.meta.url), 'utf8')
  .replace(/^import .+;\r?$/gm, '').split("const root = document.getElementById('app');")[0];

// 在无 DOM 的环境驱动实际组件函数，保留 ref/state 并显式重绘。
function frontend(api) {
  const slots = [];
  let cursor = 0;
  const location = {};
  const confirm = vi.fn(() => true);
  const prompt = vi.fn(() => 'shop');
  const useRef = (value) => slots[cursor++] ??= { current: value };
  const useState = (value) => {
    const slot = useRef(value);
    return [slot.current, (next) => { slot.current = next; }];
  };
  const app = runInNewContext(`${source}\napi = request;
    ({ AccountActions, AccountCard, AddAccountForm, PasswordForm, Countdown, SessionStatus, useAccountAction, usePatrol, patrolHint, PatrolSwitch,
      createPointerBatches });`, {
    h, htm, useRef, useState, request: api, crypto: webcrypto, Uint32Array,
    useEffect: () => {}, setInterval, clearInterval, window: { location, confirm, prompt },
  });
  return { ...app, location, confirm, prompt, render: (props, component = 'AccountActions') => {
    cursor = 0;
    return app[component](props);
  } };
}

function buttons(node) {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'button') return [node];
  return [node.props?.children].flat(Infinity).flatMap(buttons);
}

function buttonNamed(node, text) {
  const button = buttons(node).find((item) => item.props.children.join('') === text);
  assert.ok(button, `Missing button: ${text}`);
  return button;
}

const event = (type, t = 0) => ({ type, t, x: 0.5, y: 0.5 });

it('serializes pointer requests, limits batches to 200 and immediately drains backlog', async () => {
  vi.useFakeTimers();
  const pending = [];
  const post = vi.fn(() => new Promise((resolve) => pending.push(resolve)));
  const { createPointerBatches } = frontend(post);
  const sender = createPointerBatches(post, () => {}, () => {});
  try {
    sender.send([event('down'), ...Array.from({ length: 450 }, (_, index) => event('move', index + 1)), event('up', 451)]);
    await vi.advanceTimersByTimeAsync(50);
    assert.equal(post.mock.calls.length, 1);
    assert.equal(post.mock.calls[0][0].events.length, 200);
    await vi.advanceTimersByTimeAsync(200);
    assert.equal(post.mock.calls.length, 1);
    pending.shift()({});
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(post.mock.calls.length, 2);
    assert.equal(post.mock.calls[1][0].events.length, 200);
    assert.equal(post.mock.calls[1][0].seq, 1);
    pending.shift()({});
    await vi.advanceTimersByTimeAsync(0);
    assert.equal(post.mock.calls[2][0].events.length, 52);
    assert.equal(new Set(post.mock.calls.map(([body]) => body.gesture_id)).size, 1);
    pending.shift()({});
    await vi.advanceTimersByTimeAsync(0);
  } finally { sender.close(); }
});

it('shows send failures, cancels the broken gesture and allows a fresh gesture', async () => {
  vi.useFakeTimers();
  const post = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
  const error = vi.fn();
  const sender = frontend(post).createPointerBatches(post, () => {}, error);
  try {
    sender.send([event('down'), event('move', 1)]);
    await vi.advanceTimersByTimeAsync(50);
    assert.equal(error.mock.calls.at(-1)[0].message, '拖动中断，请重新操作');
    assert.equal(post.mock.calls[1][0].cancel, true);
    sender.send([event('up', 2), event('down', 100), event('up', 110)]);
    await vi.advanceTimersByTimeAsync(50);
    const body = post.mock.calls[2][0];
    assert.notEqual(body.gesture_id, post.mock.calls[0][0].gesture_id);
    assert.equal(body.seq, 0);
    assert.deepEqual(Array.from(body.events, (item) => item.t), [0, 10]);
  } finally { sender.close(); }
});

it('starts a fresh gesture after an unsampled up without leaving an empty queue head', async () => {
  vi.useFakeTimers();
  const post = vi.fn().mockResolvedValue({ editable: false, numeric: false });
  const focus = vi.fn();
  const sender = frontend(post).createPointerBatches(post, focus, () => {});
  try {
    sender.send([event('down')]);
    await vi.advanceTimersByTimeAsync(50);
    sender.send([null, event('down', 100), event('up', 110)]);
    await vi.advanceTimersByTimeAsync(50);
    assert.equal(post.mock.calls.length, 2);
    assert.notEqual(post.mock.calls[0][0].gesture_id, post.mock.calls[1][0].gesture_id);
    assert.equal(focus.mock.calls.length, 2);
  } finally { sender.close(); }
});

it('suppresses focus for interrupted gestures and after unmount', async () => {
  vi.useFakeTimers();
  let resolve;
  const post = vi.fn(() => new Promise((done) => { resolve = done; }));
  const focus = vi.fn();
  const error = vi.fn();
  const sender = frontend(post).createPointerBatches(post, focus, error);
  sender.send([event('down'), event('up')]);
  await vi.advanceTimersByTimeAsync(50);
  resolve({ result: 'interrupted', editable: false });
  await vi.advanceTimersByTimeAsync(0);
  assert.equal(error.mock.calls.at(-1)[0].message, '拖动中断，请重新操作');
  assert.equal(focus.mock.calls.length, 0);
  sender.send([event('down'), event('up')]);
  await vi.advanceTimersByTimeAsync(50);
  sender.close();
  resolve({ editable: true, numeric: true });
  await vi.advanceTimersByTimeAsync(100);
  assert.equal(focus.mock.calls.length, 0);
  assert.equal(post.mock.calls.length, 2);
});

it('guards synchronous repeated account actions and disables every button until failure settles', async () => {
  let reject;
  const api = vi.fn(() => new Promise((resolve, fail) => { reject = fail; }));
  const app = frontend(api);
  const onError = vi.fn();
  const props = { account: { slug: 'shop', has_password: true, status_kind: 'relogin_required' }, onError, onDone: () => {} };
  const initial = app.render(props);
  const first = buttonNamed(initial, '重新登录').props.onClick();
  await buttonNamed(initial, '扫码登录').props.onClick();
  assert.equal(api.mock.calls.length, 1);
  assert.ok(buttons(app.render(props)).every((button) => button.props.disabled === true));
  reject(new Error('failed'));
  await first;
  assert.equal(onError.mock.calls.length, 1);
  assert.ok(buttons(app.render(props)).every((button) => button.props.disabled === false));
});

// 按渲染顺序：登录行（次要在左、主按钮在右）、密码行、删除店铺。
const actionCases = [
  ['relogin_paused', true, ['恢复自动登录', '扫码登录', '清除密码', '修改密码', '删除店铺'], '扫码登录'],
  ['relogin_paused', false, ['恢复自动登录', '扫码登录', '设置密码', '删除店铺'], '扫码登录'],
  ['action_required', true, ['扫码登录', '重新登录', '清除密码', '修改密码', '删除店铺'], '重新登录'],
  ['action_required', false, ['扫码登录', '设置密码', '删除店铺'], '扫码登录'],
  ['relogin_required', true, ['扫码登录', '重新登录', '清除密码', '修改密码', '删除店铺'], '重新登录'],
  ['relogin_required', false, ['扫码登录', '设置密码', '删除店铺'], '扫码登录'],
  ['verified', true, ['扫码登录', '重新登录', '清除密码', '修改密码', '删除店铺'], null],
  ['verified', false, ['扫码登录', '设置密码', '删除店铺'], null],
  ['unknown', true, ['扫码登录', '重新登录', '清除密码', '修改密码', '删除店铺'], null],
  ['unknown', false, ['扫码登录', '设置密码', '删除店铺'], null],
];

it.each(actionCases)('maps detail actions for %s with password=%s', async (kind, hasPassword, expected) => {
  const api = vi.fn().mockResolvedValue({});
  const app = frontend(api);
  const onDone = vi.fn();
  const tree = app.render({ account: { slug: 'shop', status_kind: kind, has_password: hasPassword }, onDone, onError: vi.fn() });
  assert.deepEqual(buttons(tree).map((button) => button.props.children.join('')), expected);
  const primary = kind !== 'relogin_paused' && hasPassword ? '重新登录' : '扫码登录';
  const classes = { 清除密码: 'plain', 修改密码: 'secondary disclosure', 设置密码: 'secondary disclosure', 删除店铺: 'danger' };
  const paths = { 扫码登录: 'qr', 重新登录: 'relogin', 恢复自动登录: 'unblock', 清除密码: 'password/clear', 删除店铺: 'remove' };
  for (const text of expected) {
    const button = buttonNamed(tree, text);
    assert.equal(button.props.class, text === primary ? undefined : classes[text] ?? 'secondary');
    if (!paths[text]) continue;
    await button.props.onClick();
    assert.equal(api.mock.calls.at(-1)[0], `/api/accounts/shop/${paths[text]}`);
  }
  if (hasPassword) assert.equal(app.confirm.mock.calls[0][0], '清除已存密码？清除后不再自动登录。');
  if (kind === 'relogin_paused') assert.ok(onDone.mock.calls.some(([text]) => text === '已恢复自动登录'));
});

it.each(actionCases)('maps card action for %s with password=%s', async (kind, hasPassword, expected, quick) => {
  const run = vi.fn();
  const account = { slug: 'shop/name', display_name: '店铺名', status_kind: kind, has_password: hasPassword };
  const tree = frontend(vi.fn()).AccountCard({ account, busy: false, run });
  assert.equal(tree.type, 'li');
  assert.equal(tree.props.class, 'card');
  const link = tree.props.children.flat(Infinity).find((node) => node?.type === 'a');
  assert.equal(link.props.class, 'card-link');
  assert.equal(link.props.href, '#/accounts/shop%2Fname');
  assert.equal(buttons(link).length, 0);
  assert.deepEqual(buttons(tree).map((button) => button.props.children.join('')), quick ? [quick] : []);
  if (!quick) return;
  await buttonNamed(tree, quick).props.onClick();
  assert.deepEqual(run.mock.calls[0], [account.slug, quick === '重新登录' ? 'relogin' : 'qr']);
});

it('keeps paused qr available, guards every action and navigates after success', async () => {
  let resolve;
  const api = vi.fn(() => new Promise((done) => { resolve = done; }));
  const app = frontend(api);
  const props = { account: { slug: 'shop/name', has_password: true, status_kind: 'relogin_paused' }, onError: vi.fn() };
  const tree = app.render(props);
  assert.ok(!buttons(tree).some((button) => button.props.children.join('') === '重新登录'));
  const first = buttonNamed(tree, '扫码登录').props.onClick();
  await buttonNamed(tree, '恢复自动登录').props.onClick();
  await buttonNamed(tree, '清除密码').props.onClick();
  assert.equal(api.mock.calls.length, 1);
  assert.equal(app.confirm.mock.calls.length, 0);
  assert.ok(buttons(app.render(props)).every((button) => button.props.disabled === true));
  resolve({ session_id: 'login/id' });
  await first;
  assert.equal(app.location.hash, '/sessions/login%2Fid/shop%2Fname');
  assert.ok(buttons(app.render(props)).every((button) => button.props.disabled === false));
});

it('shares the quick-action guard and busy state across cards', async () => {
  let resolve;
  const api = vi.fn(() => new Promise((done) => { resolve = done; }));
  const app = frontend(api);
  const props = { onError: vi.fn() };
  const action = app.render(props, 'useAccountAction');
  const accounts = ['first', 'second'].map((slug) => ({ slug, status_kind: 'relogin_paused' }));
  const cards = accounts.map((account) => app.AccountCard({ account, ...action }));
  const first = buttonNamed(cards[0], '扫码登录').props.onClick();
  await buttonNamed(cards[1], '扫码登录').props.onClick();
  assert.equal(api.mock.calls.length, 1);
  const busy = app.render(props, 'useAccountAction');
  for (const account of accounts) assert.equal(buttonNamed(app.AccountCard({ account, ...busy }), '扫码登录').props.disabled, true);
  resolve({ session_id: 'id' });
  await first;
  assert.equal(app.location.hash, '/sessions/id/first');
  assert.equal(app.render(props, 'useAccountAction').busy, false);
});

it('removes a shop only with the typed name and returns to the list', async () => {
  const api = vi.fn().mockResolvedValue({ ok: true, removed: true });
  const app = frontend(api);
  const props = { account: { slug: 'shop/name', display_name: '旗舰店', has_password: false }, onError: vi.fn(), onDone: vi.fn() };
  app.prompt.mockReturnValueOnce(null);
  await buttonNamed(app.render(props), '删除店铺').props.onClick();
  assert.equal(api.mock.calls.length, 0);
  assert.match(app.prompt.mock.calls[0][0], /输入店铺名「旗舰店」确认/);
  app.prompt.mockReturnValueOnce(' 旗舰店 ');
  await buttonNamed(app.render(props), '删除店铺').props.onClick();
  assert.deepEqual(JSON.parse(JSON.stringify(api.mock.calls[0])), ['/api/accounts/shop%2Fname/remove', { confirm_name: '旗舰店' }]);
  assert.equal(app.location.hash, '/');
  assert.equal(props.onDone.mock.calls.length, 0);
});

it('switches patrol through the API and keeps the last server state on failure', async () => {
  const api = vi.fn().mockResolvedValueOnce({ enabled: true, interval_minutes: 30, last_patrol_at: null })
    .mockRejectedValueOnce(new Error('写入失败'));
  const app = frontend(api);
  await app.render({}, 'usePatrol').toggle({ currentTarget: { checked: true } });
  assert.deepEqual(JSON.parse(JSON.stringify(api.mock.calls[0])), ['/api/patrol', { enabled: true }]);
  assert.equal(app.render({}, 'usePatrol').patrol.enabled, true);
  await app.render({}, 'usePatrol').toggle({ currentTarget: { checked: false } });
  const state = app.render({}, 'usePatrol');
  assert.deepEqual([state.patrol.enabled, state.busy, state.error.message], [true, false, '写入失败']);
});

it.each([
  [{ interval_minutes: 30, last_patrol_at: null }, '开启后每 30 分钟检查登录，失效时用已存密码自动登录'],
  [{ interval_minutes: null, last_patrol_at: '2026-11-04 08:00:00' }, '开启后定期检查登录，失效时用已存密码自动登录'],
])('describes patrol %#', (patrol, text) => {
  assert.equal(frontend(vi.fn()).patrolHint(patrol), text);
});

it.each([[true, '巡航中'], [false, '自动巡航']])('shows patrol state on the pill and keeps the panel closed (%s)', (enabled, label) => {
  const tree = frontend(vi.fn()).render({ patrol: { enabled, interval_minutes: 30, last_patrol_at: null } }, 'PatrolSwitch');
  const [pill] = buttons(tree);
  assert.equal(pill.props.class, enabled ? 'patrol-pill is-on' : 'patrol-pill');
  assert.deepEqual([pill.props['aria-expanded'], pill.props.children.flat().at(-1)], ['false', label]);
  assert.equal(JSON.stringify(tree).includes('"class":"patrol-panel"'), false);
});

it('leaves passwords unchanged when clearing is declined', async () => {
  const api = vi.fn();
  const app = frontend(api);
  app.confirm.mockReturnValue(false);
  const tree = app.render({ account: { slug: 'shop', has_password: true }, onError: vi.fn() });
  await buttonNamed(tree, '清除密码').props.onClick();
  assert.equal(api.mock.calls.length, 0);
});

it.each([true, false])('opens the add-shop accordion only for an empty list (%s)', (open) => {
  const add = frontend(vi.fn()).AddAccountForm({ openByDefault: open });
  assert.equal(add.type, 'details');
  assert.equal(add.props.open, open);
});

function passwordForm(node) {
  if (!node || typeof node !== 'object') return null;
  if (node.props?.id === 'password-form') return node;
  return [node.props?.children].flat(Infinity).map(passwordForm).find(Boolean) ?? null;
}

it.each([[true, true], [true, false], [false, true], [false, false]])(
  'expands the password row by default only when paused (paused=%s, password=%s)', (paused, hasPassword) => {
    const app = frontend(vi.fn());
    const onDone = vi.fn();
    const props = { account: { slug: 'shop', has_password: hasPassword, status_kind: paused ? 'relogin_paused' : 'verified' }, onDone, onError: vi.fn() };
    const toggle = buttonNamed(app.render(props), hasPassword ? '修改密码' : '设置密码');
    assert.deepEqual([toggle.props['aria-expanded'], toggle.props['aria-controls']], [String(paused), 'password-form']);
    assert.equal(Boolean(passwordForm(app.render(props))), paused);
    if (!paused) toggle.props.onClick();
    const form = passwordForm(app.render(props)).props.children.flat(Infinity).find((node) => node?.props?.slug);
    assert.equal(form.props.slug, 'shop');
    form.props.onSaved('密码已保存');
    assert.equal(passwordForm(app.render(props)), null);
    assert.deepEqual(onDone.mock.calls, [['密码已保存']]);
  });

it.each([
  ['loading', null, true, true, false],
  ['filling', { state: 'filling', message: null, remaining_seconds: 712 }, false, true, true],
  ['sms', { state: 'sms', message: '验证码已发送', remaining_seconds: 300 }, false, false, true],
  ['failed', { state: 'failed', message: '密码错误', remaining_seconds: 0 }, false, false, false],
])('centres the session status block for %s', (_, session, loading, spinner, countdown) => {
  const app = frontend(vi.fn());
  const tree = app.render({ session, loading }, 'SessionStatus');
  const nodes = tree.props.children.flat(Infinity).filter((node) => node && typeof node === 'object');
  assert.equal(tree.props.class, 'session-status');
  assert.equal(nodes.some((node) => node.props.class === 'spinner'), spinner);
  assert.equal(nodes.some((node) => node.type === app.Countdown), countdown);
  const state = nodes.find((node) => node.type === 'p' && node.props.class.startsWith('state'));
  assert.equal(state.props.children.join(''), { loading: '加载中…', filling: '正在准备登录…', sms: '输入短信验证码', failed: '登录失败' }[_]);
  if (session?.message) assert.ok(nodes.some((node) => node.props.children?.join('') === session.message));
});

it.each([0, 60, 61])('marks the countdown urgent at %s seconds', (seconds) => {
  const node = frontend(vi.fn()).render({ seconds }, 'Countdown');
  assert.equal(node.props.class, seconds <= 60 ? 'muted countdown-urgent' : 'muted');
});
