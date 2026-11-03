import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import { afterEach, it, vi } from 'vitest';
import { openTakeover, validateSmsCode, validatePointerBatch } from '../../src/adapter/takeover.js';

const DIALOG = { x: 100, y: 50, width: 400, height: 300, scrollX: 0, scrollY: 20 };
const channels = [];
const focusCalls = (cdp) => cdp.send.mock.calls
  .filter(([method, body]) => method === 'Runtime.evaluate' && body.expression.includes('activeElement'));
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
afterEach(async () => { for (const channel of channels.splice(0)) await channel.close(); });

// 默认页面上有弹窗；改写 page.dialog / page.data 可模拟弹窗消失、定位异常或截图失败。
function fakeCdp() {
  const cdp = new EventEmitter();
  cdp.page = { dialog: DIALOG, data: 'crop' };
  cdp.send = vi.fn(async (method, body) => {
    if (method === 'Runtime.evaluate' && body.expression.includes('captcha-wrapper')) return { result: { value: cdp.page.dialog } };
    if (method === 'Page.captureScreenshot') {
      if (cdp.page.data instanceof Error) throw cdp.page.data;
      return { data: cdp.page.data };
    }
    return {};
  });
  cdp.detach = vi.fn(async () => {});
  return cdp;
}

async function setup() {
  const cdp = fakeCdp();
  const context = { newCDPSession: vi.fn(async () => cdp) };
  const page = { context: () => context };
  const channel = await openTakeover(page);
  channels.push(channel);
  const dispatch = channel.dispatchPointer.bind(channel);
  let gesture = 0;
  let seq = 0;
  // 旧用例只关心回放；默认补齐协议字段，协议用例显式指定。
  channel.dispatchPointer = (events, batch) => {
    if (!gesture || events?.[0]?.type === 'down') { gesture++; seq = 0; }
    return dispatch(events, { gesture_id: `gesture-${gesture}`, seq: seq++, ...batch });
  };
  const frame = (data = 'screencast', sessionId = 1) => cdp.emit('Page.screencastFrame', { data, sessionId });
  const show = async () => { frame(); await settle(); };
  return { cdp, channel, frame, show, context, page };
}

const mouse = (cdp) => cdp.send.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent').map(([, body]) => body);
const captures = (cdp) => cdp.send.mock.calls.filter(([method]) => method === 'Page.captureScreenshot').map(([, body]) => body);

it('uses screencast only as a repaint signal, acks every frame and publishes the latest dialog crop at five fps', async () => {
  vi.useFakeTimers();
  const { cdp, channel, frame, context, page } = await setup();
  assert.equal(context.newCDPSession.mock.calls[0][0], page);
  assert.deepEqual(cdp.send.mock.calls[0], ['Page.startScreencast', {
    format: 'jpeg', quality: 10, maxWidth: 320, everyNthFrame: 1,
  }]);
  const received = [];
  channel.frames.subscribe((value) => received.push(value));
  const iterator = channel.frames[Symbol.asyncIterator]();
  const pending = iterator.next();
  cdp.page.data = 'old';
  frame('screencast-a', 7);
  await settle();
  cdp.page.data = 'new';
  frame('screencast-b', 8);
  await settle();
  assert.equal(cdp.send.mock.calls.filter(([method]) => method === 'Page.screencastFrameAck').length, 2);
  assert.deepEqual(captures(cdp)[0], { format: 'jpeg', quality: 80, clip: { x: 100, y: 70, width: 400, height: 300, scale: 2 } });
  await vi.advanceTimersByTimeAsync(199);
  assert.equal(received.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.deepEqual((await pending).value, { jpeg: 'new', width: 400, height: 300 });
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(received.length, 1);
  assert.equal(JSON.stringify(received).includes('screencast'), false);
  await channel.close();
  assert.equal((await iterator.next()).done, true);
  assert.equal(received.at(-1), null);
  assert.equal(cdp.listenerCount('Page.screencastFrame'), 0);
  assert.equal(cdp.detach.mock.calls.length, 1);
});

it('maps normalized coordinates into the dialog and preserves timestamp gaps across serialized batches', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  const first = channel.dispatchPointer([{ t: 10, type: 'down', x: 0.5, y: 0.25 }, { t: 60, type: 'move', x: 1, y: 1 }]);
  const second = channel.dispatchPointer([{ t: 110, type: 'up', x: 0, y: 0 }]);
  await vi.advanceTimersByTimeAsync(0);
  assert.deepEqual(mouse(cdp), [{ type: 'mousePressed', x: 300, y: 125, button: 'left', buttons: 1, clickCount: 1 }]);
  await vi.advanceTimersByTimeAsync(49);
  assert.equal(mouse(cdp).length, 1);
  await vi.advanceTimersByTimeAsync(1);
  await first;
  assert.deepEqual(mouse(cdp)[1], { type: 'mouseMoved', x: 500, y: 350, button: 'none', buttons: 1 });
  await vi.advanceTimersByTimeAsync(50);
  assert.deepEqual(mouse(cdp)[2], { type: 'mouseReleased', x: 100, y: 50, button: 'left', buttons: 0, clickCount: 1 });
  await vi.advanceTimersByTimeAsync(150);
  await second;
});

it('reads boolean focus once 150ms after an up batch, before later queued input', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  cdp.send.mockClear();
  cdp.send.mockImplementation(async () => ({ result: { value: { editable: true, numeric: true, extra: 'discard' } } }));
  const pointer = channel.dispatchPointer(['down', 'up', 'up'].map((type) => ({ t: 0, type, x: 0, y: 0 })));
  const text = channel.insertText('queued');
  await vi.advanceTimersByTimeAsync(149);
  assert.deepEqual(cdp.send.mock.calls.map(([method]) => method), Array(3).fill('Input.dispatchMouseEvent'));
  await vi.advanceTimersByTimeAsync(1);
  assert.deepEqual(await pointer, { editable: true, numeric: true });
  await text;
  const calls = cdp.send.mock.calls;
  assert.deepEqual(calls.map(([method]) => method), [
    ...Array(3).fill('Input.dispatchMouseEvent'), 'Runtime.evaluate', 'Input.insertText',
  ]);
  assert.equal(calls[3][1].returnByValue, true);
  assert.equal(typeof calls[3][1].expression, 'string');
});

it('returns null focus without evaluating a move-only batch', async () => {
  const { cdp, channel, show } = await setup();
  await show();
  const result = await channel.dispatchPointer([{ t: 0, type: 'move', x: 0, y: 0 }]);
  assert.deepEqual(result, { editable: null, numeric: null });
  assert.equal(focusCalls(cdp).length, 0);
});

it('resolves pointer dispatch with null focus when evaluation rejects', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  cdp.send.mockImplementation(async (method) => {
    if (method === 'Runtime.evaluate') throw new Error('evaluate failed');
    return {};
  });
  const pointer = channel.dispatchPointer([{ t: 0, type: 'up', x: 0, y: 0 }]);
  await vi.advanceTimersByTimeAsync(150);
  assert.deepEqual(await pointer, { editable: null, numeric: null });
});

it.each([undefined, {}, { result: { value: null } }, { result: { value: { editable: true } } },
  { result: { value: { editable: 'true', numeric: false } } },
  { result: { value: { editable: false, numeric: 0 } } },
  { exceptionDetails: {}, result: { value: { editable: true, numeric: true } } },
])('returns null focus for an exceptional or malformed evaluation result: %j', async (response) => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  cdp.send.mockResolvedValue(response);
  const pointer = channel.dispatchPointer([{ t: 0, type: 'up', x: 0, y: 0 }]);
  await vi.advanceTimersByTimeAsync(150);
  assert.deepEqual(await pointer, { editable: null, numeric: null });
});

function focusedElement(tagName, attributes = {}, properties = {}) {
  return { tagName, getAttribute: (name) => attributes[name] ?? null, ...properties,
    get value() { throw new Error('Unexpected value read'); },
    get name() { throw new Error('Unexpected name read'); },
    get textContent() { throw new Error('Unexpected text read'); } };
}

it('uses a fixed expression that detects editable and numeric focus using only boolean output', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  const pointer = channel.dispatchPointer([{ t: 0, type: 'up', x: 0, y: 0 }]);
  await vi.advanceTimersByTimeAsync(150);
  await pointer;
  const expression = focusCalls(cdp)[0][1].expression;
  const cases = [
    [null, false, false], [focusedElement('BODY'), false, false],
    [focusedElement('TEXTAREA'), true, false], [focusedElement('INPUT'), true, false],
    [focusedElement('DIV', {}, { contentEditable: 'true' }), true, false],
    [focusedElement('DIV', {}, { isContentEditable: true }), true, false],
    [focusedElement('INPUT', { type: 'checkbox' }), false, false],
    [focusedElement('TEXTAREA', {}, { disabled: true }), false, false],
    [focusedElement('TEXTAREA', {}, { readOnly: true }), false, false],
    [focusedElement('INPUT', { type: 'tel' }, { disabled: true }), false, false],
    [focusedElement('INPUT', { type: 'number' }, { readOnly: true }), false, false],
    [focusedElement('BODY', { inputmode: 'numeric' }), false, false],
  ];
  for (const type of ['text', 'search', 'url', 'email', 'password', 'tel', 'number']) {
    cases.push([focusedElement('INPUT', { type }), true, ['tel', 'number'].includes(type)]);
  }
  for (const inputmode of ['numeric', 'tel', 'decimal']) {
    cases.push([focusedElement('TEXTAREA', { inputmode }), true, true]);
  }
  for (const [activeElement, editable, numeric] of cases) {
    const result = runInNewContext(expression, { document: { activeElement } });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { editable, numeric });
  }
});

it('descends through same-origin frames and tolerates inaccessible frame documents', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  const pointer = channel.dispatchPointer([{ t: 0, type: 'up', x: 0, y: 0 }]);
  await vi.advanceTimersByTimeAsync(150);
  await pointer;
  const expression = focusCalls(cdp)[0][1].expression;
  const input = focusedElement('INPUT', { type: 'number' });
  const inner = focusedElement('FRAME', {}, { contentDocument: { activeElement: input } });
  const outer = focusedElement('IFRAME', {}, { contentDocument: { activeElement: inner } });
  const inaccessible = focusedElement('IFRAME');
  Object.defineProperty(inaccessible, 'contentDocument', { get() { throw new Error('cross-origin'); } });
  for (const [activeElement, expected] of [[outer, true], [inaccessible, false], [focusedElement('FRAME'), false]]) {
    const result = runInNewContext(expression, { document: { activeElement } });
    assert.deepEqual(JSON.parse(JSON.stringify(result)), { editable: expected, numeric: expected });
  }
});

it('preserves pointer replay failures without attempting focus detection', async () => {
  const { cdp, channel, show } = await setup();
  await show();
  const error = new Error('replay failed');
  cdp.send.mockRejectedValue(error);
  await assert.rejects(channel.dispatchPointer([{ t: 0, type: 'up', x: 0, y: 0 }]), (result) => result === error);
  assert.equal(focusCalls(cdp).length, 0);
});

it('aborts the focus delay on close without evaluating the page', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  const pending = channel.dispatchPointer([{ t: 0, type: 'up', x: 0, y: 0 }]);
  const rejected = assert.rejects(pending);
  await vi.advanceTimersByTimeAsync(100);
  await channel.close();
  await rejected;
  assert.equal(focusCalls(cdp).length, 0);
});

it('inserts text and sends whitelisted keyDown/keyUp events with native key codes', async () => {
  const { cdp, channel } = await setup();
  await channel.insertText('123456');
  for (const [key, code] of [['Enter', 13], ['Backspace', 8], ['Tab', 9]]) {
    await channel.pressKey(key);
    assert.deepEqual(cdp.send.mock.calls.slice(-2), ['keyDown', 'keyUp'].map((type) => [
      'Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code },
    ]));
  }
  assert.ok(cdp.send.mock.calls.some(([method, body]) => method === 'Input.insertText' && body.text === '123456'));
});

it('accepts a reset frontend timestamp origin after returning to the session page', async () => {
  vi.useFakeTimers();
  const { channel, cdp, show } = await setup();
  await show();
  const first = channel.dispatchPointer([{ t: 5000, type: 'down', x: 0, y: 0 }, { t: 5000, type: 'up', x: 0, y: 0 }]);
  await vi.advanceTimersByTimeAsync(150);
  await first;
  const replay = channel.dispatchPointer([{ t: 0, type: 'down', x: 1, y: 1 }, { t: 50, type: 'up', x: 1, y: 1 }]);
  await vi.advanceTimersByTimeAsync(0);
  const mouse = () => cdp.send.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent');
  assert.equal(mouse().length, 3);
  await vi.advanceTimersByTimeAsync(50);
  await vi.advanceTimersByTimeAsync(150);
  await replay;
  assert.equal(mouse().length, 4);
  assert.equal(mouse().at(-1)[1].type, 'mouseReleased');
});

it('rejects malformed batches, coordinates, time, text and keys without echoing input', async () => {
  const { channel, show } = await setup();
  const event = { t: 0, type: 'down', x: 0, y: 1 };
  assert.throws(() => channel.dispatchPointer([event]), { code: 'E_USAGE' });
  await show();
  const bad = [null, {}, Array(201).fill(event), [{ ...event, x: -0.1 }], [{ ...event, y: 1.1 }],
    [{ ...event, t: Infinity }], [{ ...event, t: NaN }], [{ ...event, x: '0' }],
    [{ ...event, t: -1 }], [{ ...event, t: 1e12 }], [event, { ...event, t: 5001 }],
    [{ ...event, type: 'secret-input' }], [{ ...event, t: 2 }, event]];
  for (const events of bad) assert.throws(() => channel.dispatchPointer(events), { code: 'E_USAGE' });
  for (const text of [null, 12, 'x'.repeat(65)]) assert.throws(() => channel.insertText(text), { code: 'E_USAGE' });
  for (const key of ['Escape', 'secret-input', '__proto__', null]) assert.throws(() => channel.pressKey(key), { code: 'E_USAGE' });
});

const pointerEvent = (type, t = 0) => ({ type, t, x: 0.5, y: 0.5 });
const interrupted = { editable: null, numeric: null, result: 'interrupted' };

it('validates gesture metadata and snapshots events before queueing', async () => {
  for (const metadata of [null, {}, { gesture_id: '', seq: 0 }, { gesture_id: 'x'.repeat(65), seq: 0 },
    { gesture_id: 'drag', seq: -1 }, { gesture_id: 'drag', seq: 0.1 }, { gesture_id: 'drag', seq: Infinity },
    { gesture_id: 'drag', seq: 0, cancel: 'yes' }]) {
    assert.throws(() => validatePointerBatch([pointerEvent('down')], metadata), { code: 'E_USAGE' });
  }
  assert.throws(() => validatePointerBatch([], { gesture_id: 'empty', seq: 0 }), { code: 'E_USAGE' });
  const { channel, cdp, show } = await setup();
  await show();
  const events = [pointerEvent('down')];
  const metadata = { gesture_id: 'snapshot', seq: 0 };
  const pending = channel.dispatchPointer(events, metadata);
  events[0].x = 99;
  metadata.seq = 50;
  await pending;
  assert.equal(mouse(cdp)[0].x, 300);
});

it('ends an unknown gesture arriving out of order and rejects its delayed first batch', async () => {
  const { channel, cdp, show } = await setup();
  await show();
  for (const seq of [1, 0]) {
    assert.deepEqual(await channel.dispatchPointer([pointerEvent('down')], { gesture_id: 'reordered', seq }), interrupted);
  }
  assert.equal(mouse(cdp).length, 0);
});

it('resets timing for a new gesture, releases the old press and ignores its delayed cancellation', async () => {
  const { channel, cdp, show } = await setup();
  await show();
  await channel.dispatchPointer([pointerEvent('down', 5000)], { gesture_id: 'old', seq: 0 });
  await channel.dispatchPointer([pointerEvent('down', 0)], { gesture_id: 'new', seq: 0 });
  assert.deepEqual(mouse(cdp).map((event) => event.type), ['mousePressed', 'mouseReleased', 'mousePressed']);
  await channel.dispatchPointer([], { gesture_id: 'old', seq: 1, cancel: true });
  assert.equal(mouse(cdp).length, 3);
  assert.deepEqual(await channel.dispatchPointer([], { gesture_id: 'new', seq: 1, cancel: true }), interrupted);
  assert.equal(mouse(cdp).at(-1).type, 'mouseReleased');
});

it.each([0, 2])('releases and ends a gesture on duplicate or missing sequence %s', async (seq) => {
  const { channel, cdp, show } = await setup();
  await show();
  await channel.dispatchPointer([pointerEvent('down')], { gesture_id: 'drag', seq: 0 });
  assert.deepEqual(await channel.dispatchPointer([pointerEvent('move')], { gesture_id: 'drag', seq }), interrupted);
  assert.deepEqual(mouse(cdp).map((event) => event.type), ['mousePressed', 'mouseReleased']);
  assert.deepEqual(await channel.dispatchPointer([pointerEvent('up')], { gesture_id: 'drag', seq: 1 }), interrupted);
  assert.equal(mouse(cdp).length, 2);
});

it('releases a lost up after idle timeout and resumes dialog relocation', async () => {
  vi.useFakeTimers();
  const { channel, cdp, show } = await setup();
  await show();
  await channel.dispatchPointer([pointerEvent('down')], { gesture_id: 'lost', seq: 0 });
  cdp.page.dialog = { ...DIALOG, x: 0 };
  await vi.advanceTimersByTimeAsync(3000);
  assert.equal(mouse(cdp).at(-1).type, 'mouseReleased');
  await show();
  assert.equal(captures(cdp).at(-1).clip.x, 0);
  assert.deepEqual(await channel.dispatchPointer([pointerEvent('up', 10)], { gesture_id: 'lost', seq: 1 }), interrupted);
});

it('keeps the original timing anchor after a late batch and interrupts excessive backlog', async () => {
  vi.useFakeTimers();
  const { channel, cdp, show } = await setup();
  await show();
  await channel.dispatchPointer([pointerEvent('down')], { gesture_id: 'late', seq: 0 });
  await vi.advanceTimersByTimeAsync(200);
  await channel.dispatchPointer([pointerEvent('move', 50)], { gesture_id: 'late', seq: 1 });
  const next = channel.dispatchPointer([pointerEvent('move', 250)], { gesture_id: 'late', seq: 2 });
  await vi.advanceTimersByTimeAsync(50);
  assert.equal(mouse(cdp).length, 3);
  await next;
  await vi.advanceTimersByTimeAsync(1100);
  assert.deepEqual(await channel.dispatchPointer([pointerEvent('move', 300)], { gesture_id: 'late', seq: 3 }), interrupted);
  assert.equal(mouse(cdp).at(-1).type, 'mouseReleased');
});

it('rejects excessive cross-batch waits and releases the previous press', async () => {
  const { channel, cdp, show } = await setup();
  await show();
  await channel.dispatchPointer([pointerEvent('down')], { gesture_id: 'gap', seq: 0 });
  await assert.rejects(channel.dispatchPointer([pointerEvent('up', 5001)], { gesture_id: 'gap', seq: 1 }), { code: 'E_USAGE' });
  assert.equal(mouse(cdp).at(-1).type, 'mouseReleased');
});

it('attempts release if dispatching up fails while pressed', async () => {
  const { channel, cdp, show } = await setup();
  await show();
  await channel.dispatchPointer([pointerEvent('down')], { gesture_id: 'release', seq: 0 });
  cdp.send.mockRejectedValueOnce(new Error('release failed'));
  await assert.rejects(channel.dispatchPointer([pointerEvent('up')], { gesture_id: 'release', seq: 1 }), /release failed/);
  assert.deepEqual(mouse(cdp).map((event) => event.type), ['mousePressed', 'mouseReleased', 'mouseReleased']);
});

it('cancels queued replay on close and detaches even after screencast startup failure', async () => {
  const { channel, show, cdp } = await setup();
  await show();
  const pending = channel.dispatchPointer([{ t: 0, type: 'down', x: 0, y: 0 }, { t: 5000, type: 'up', x: 0, y: 0 }]);
  const rejected = assert.rejects(pending);
  await channel.close();
  await rejected;
  await channel.close();
  assert.equal(cdp.detach.mock.calls.length, 1);
  const failing = new EventEmitter();
  failing.send = vi.fn(async (method) => { if (method === 'Page.startScreencast') throw new Error('start failed'); });
  failing.detach = vi.fn();
  await assert.rejects(openTakeover({ context: () => ({ newCDPSession: async () => failing }) }));
  assert.equal(failing.listenerCount('Page.screencastFrame'), 0);
  assert.equal(failing.detach.mock.calls.length, 1);
});

it('keeps the dialog area locked while the pointer is pressed', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  await channel.dispatchPointer([{ t: 0, type: 'down', x: 0, y: 0 }]);
  cdp.page.dialog = { ...DIALOG, x: 0 };
  await show();
  assert.deepEqual(captures(cdp).map((body) => body.clip.x), [100, 100]);
  const released = channel.dispatchPointer([{ t: 10, type: 'up', x: 1, y: 1 }]);
  await vi.advanceTimersByTimeAsync(160);
  await released;
  assert.deepEqual([mouse(cdp).at(-1).x, mouse(cdp).at(-1).y], [500, 350]);
  await show();
  assert.equal(captures(cdp).at(-1).clip.x, 0);
});

it('publishes an empty frame and rejects pointers while no valid dialog is found', async () => {
  vi.useFakeTimers();
  for (const dialog of [null, { ...DIALOG, width: 0 }, { ...DIALOG, x: Number.NaN }, { ...DIALOG, scrollY: '20' }]) {
    const { cdp, channel, show } = await setup();
    cdp.page.dialog = dialog;
    await show();
    await vi.advanceTimersByTimeAsync(200);
    assert.deepEqual((await channel.frames[Symbol.asyncIterator]().next()).value, { jpeg: null, width: null, height: null });
    assert.equal(captures(cdp).length, 0);
    assert.throws(() => channel.dispatchPointer([{ t: 0, type: 'move', x: 0, y: 0 }]), { code: 'E_USAGE' });
  }
});

it('clears the dialog when it disappears and keeps the last picture on a failed capture', async () => {
  vi.useFakeTimers();
  const { cdp, channel, show } = await setup();
  await show();
  await vi.advanceTimersByTimeAsync(200);
  const iterator = channel.frames[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.jpeg, 'crop');
  for (const data of [new Error('capture failed'), '']) {
    cdp.page.data = data;
    await show();
    await vi.advanceTimersByTimeAsync(200);
    await channel.dispatchPointer([{ t: 0, type: 'move', x: 0, y: 0 }]);
  }
  cdp.page.dialog = null;
  await show();
  await vi.advanceTimersByTimeAsync(200);
  assert.deepEqual((await iterator.next()).value, { jpeg: null, width: null, height: null });
  assert.throws(() => channel.dispatchPointer([{ t: 0, type: 'move', x: 0, y: 0 }]), { code: 'E_USAGE' });
});

it('accepts only 4-8 digit SMS codes', () => {
  for (const code of ['1234', '123456', '12345678']) assert.equal(validateSmsCode(code), code);
  for (const code of [undefined, null, 123456, '123', '123456789', '12a456', ' 123456', '１２３４５６']) {
    assert.throws(() => validateSmsCode(code), { code: 'E_USAGE' });
  }
});

function dialogElement(rect, style = {}) {
  return { style: { display: 'block', visibility: 'visible', ...style },
    getBoundingClientRect: () => ({ left: rect[0], top: rect[1], right: rect[0] + rect[2], bottom: rect[1] + rect[3],
      width: rect[2], height: rect[3] }) };
}

it('locates the first visible, large enough dialog with clamped padding', async () => {
  const { cdp, show } = await setup();
  await show();
  const expression = cdp.send.mock.calls.find(([method, body]) => method === 'Runtime.evaluate'
    && body.expression.includes('captcha-wrapper'))[1].expression;
  const run = (bySelector) => {
    const result = runInNewContext(expression, {
      innerWidth: 1000, innerHeight: 800, scrollX: 0, scrollY: 5,
      document: { querySelectorAll: (selector) => bySelector[selector] ?? [] },
      getComputedStyle: (element) => element.style,
    });
    return result && JSON.parse(JSON.stringify(result));
  };
  assert.equal(run({}), null);
  assert.deepEqual(run({ '.captcha-wrapper': [dialogElement([10, 700, 400, 300])] }),
    { x: 0, y: 676, width: 434, height: 124, scrollX: 0, scrollY: 5 });
  assert.deepEqual(run({
    '.captcha-wrapper': [dialogElement([100, 100, 300, 300], { display: 'none' }), dialogElement([100, 100, 30, 300])],
    '#slide-captcha-dialog': [dialogElement([300, 200, 320, 280], { visibility: 'hidden' }), dialogElement([300, 200, 320, 280])],
  }), { x: 276, y: 176, width: 368, height: 328, scrollX: 0, scrollY: 5 });
});
