import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { afterEach, it, vi } from 'vitest';
import { openTakeover } from '../../src/adapter/takeover.js';

const channels = [];
afterEach(async () => { for (const channel of channels.splice(0)) await channel.close(); });

async function setup() {
  const cdp = new EventEmitter();
  cdp.send = vi.fn(async () => ({}));
  cdp.detach = vi.fn(async () => {});
  const context = { newCDPSession: vi.fn(async () => cdp) };
  const page = { context: () => context };
  const channel = await openTakeover(page);
  channels.push(channel);
  const frame = (data = 'jpeg', width = 1902, height = 984, sessionId = 1) => {
    cdp.emit('Page.screencastFrame', { data, sessionId, metadata: { deviceWidth: width, deviceHeight: height } });
  };
  return { cdp, channel, frame, context, page };
}

it('starts CDP screencast, acks every frame and retains latest at five fps for slow consumers', async () => {
  vi.useFakeTimers();
  const { cdp, channel, frame, context, page } = await setup();
  assert.equal(context.newCDPSession.mock.calls[0][0], page);
  assert.deepEqual(cdp.send.mock.calls[0], ['Page.startScreencast', {
    format: 'jpeg', quality: 60, maxWidth: 1280, everyNthFrame: 1,
  }]);
  const received = [];
  channel.frames.subscribe((value) => received.push(value));
  const iterator = channel.frames[Symbol.asyncIterator]();
  const pending = iterator.next();
  frame('old', 100, 200, 7);
  frame('new', 300, 400, 8);
  assert.equal(cdp.send.mock.calls.filter(([method]) => method === 'Page.screencastFrameAck').length, 2);
  await vi.advanceTimersByTimeAsync(199);
  assert.equal(received.length, 0);
  await vi.advanceTimersByTimeAsync(1);
  assert.deepEqual((await pending).value, { jpeg: 'new', width: 300, height: 400 });
  await vi.advanceTimersByTimeAsync(1000);
  assert.equal(received.length, 1);
  frame('discarded');
  await vi.advanceTimersByTimeAsync(200);
  frame('latest');
  await vi.advanceTimersByTimeAsync(200);
  assert.equal((await iterator.next()).value.jpeg, 'latest');
  await channel.close();
  assert.equal((await iterator.next()).done, true);
  assert.equal(received.at(-1), null);
  assert.equal(cdp.listenerCount('Page.screencastFrame'), 0);
  assert.equal(cdp.detach.mock.calls.length, 1);
});

it('maps normalized coordinates and preserves timestamp gaps across serialized batches', async () => {
  vi.useFakeTimers();
  const { cdp, channel, frame } = await setup();
  frame();
  const first = channel.dispatchPointer([{ t: 10, type: 'down', x: 0.5, y: 0.25 }, { t: 60, type: 'move', x: 1, y: 1 }]);
  const second = channel.dispatchPointer([{ t: 110, type: 'up', x: 0, y: 0 }]);
  await vi.advanceTimersByTimeAsync(0);
  const mouse = () => cdp.send.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent').map(([, body]) => body);
  assert.deepEqual(mouse(), [{ type: 'mousePressed', x: 951, y: 246, button: 'left', buttons: 1, clickCount: 1 }]);
  await vi.advanceTimersByTimeAsync(49);
  assert.equal(mouse().length, 1);
  await vi.advanceTimersByTimeAsync(1);
  await first;
  assert.deepEqual(mouse()[1], { type: 'mouseMoved', x: 1902, y: 984, button: 'none', buttons: 1 });
  await vi.advanceTimersByTimeAsync(50);
  await second;
  assert.deepEqual(mouse()[2], { type: 'mouseReleased', x: 0, y: 0, button: 'left', buttons: 0, clickCount: 1 });
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
  const { channel, cdp, frame } = await setup();
  frame();
  await channel.dispatchPointer([{ t: 5000, type: 'down', x: 0, y: 0 }, { t: 5000, type: 'up', x: 0, y: 0 }]);
  const replay = channel.dispatchPointer([{ t: 0, type: 'down', x: 1, y: 1 }, { t: 50, type: 'up', x: 1, y: 1 }]);
  await vi.advanceTimersByTimeAsync(0);
  const mouse = () => cdp.send.mock.calls.filter(([method]) => method === 'Input.dispatchMouseEvent');
  assert.equal(mouse().length, 3);
  await vi.advanceTimersByTimeAsync(50);
  await replay;
  assert.equal(mouse().length, 4);
  assert.equal(mouse().at(-1)[1].type, 'mouseReleased');
});

it('rejects malformed batches, coordinates, time, text and keys without echoing input', async () => {
  const { channel, frame } = await setup();
  const event = { t: 0, type: 'down', x: 0, y: 1 };
  assert.throws(() => channel.dispatchPointer([event]), { code: 'E_USAGE' });
  frame();
  const bad = [null, {}, Array(201).fill(event), [{ ...event, x: -0.1 }], [{ ...event, y: 1.1 }],
    [{ ...event, t: Infinity }], [{ ...event, t: NaN }], [{ ...event, x: '0' }],
    [{ ...event, t: -1 }], [{ ...event, type: 'secret-input' }], [{ ...event, t: 2 }, event]];
  for (const events of bad) assert.throws(() => channel.dispatchPointer(events), { code: 'E_USAGE' });
  for (const text of [null, 12, 'x'.repeat(65)]) assert.throws(() => channel.insertText(text), { code: 'E_USAGE' });
  for (const key of ['Escape', 'secret-input', '__proto__', null]) assert.throws(() => channel.pressKey(key), { code: 'E_USAGE' });
});

it('cancels queued replay on close and detaches even after screencast startup failure', async () => {
  const { channel, frame, cdp } = await setup();
  frame();
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
