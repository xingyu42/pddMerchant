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
  const useRef = (value) => slots[cursor++] ??= { current: value };
  const useState = (value) => {
    const slot = useRef(value);
    return [slot.current, (next) => { slot.current = next; }];
  };
  const app = runInNewContext(`${source}\napi = request; ({ AccountActions, createPointerBatches });`, {
    h, htm, useRef, useState, request: api, crypto: webcrypto, Uint32Array,
    setInterval, clearInterval, window: { location: {}, confirm: () => true },
  });
  return { ...app, render: (props) => { cursor = 0; return app.AccountActions(props); } };
}

function buttons(node) {
  if (!node || typeof node !== 'object') return [];
  if (node.type === 'button') return [node];
  return [node.props?.children].flat(Infinity).flatMap(buttons);
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
  const props = { account: { slug: 'shop', has_password: true }, onError, onDone: () => {} };
  const initial = buttons(app.render(props));
  const first = initial[0].props.onClick();
  await initial[1].props.onClick();
  assert.equal(api.mock.calls.length, 1);
  assert.ok(buttons(app.render(props)).every((button) => button.props.disabled === true));
  reject(new Error('failed'));
  await first;
  assert.equal(onError.mock.calls.length, 1);
  assert.ok(buttons(app.render(props)).every((button) => button.props.disabled === false));
});
