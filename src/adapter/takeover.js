import { abortableSleep } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { createLatestFrames } from './latest-frames.js';

const KEYS = Object.freeze({ Enter: ['Enter', 13], Backspace: ['Backspace', 8], Tab: ['Tab', 9] });

export function invalidTakeoverInput() {
  return new PddCliError({ code: 'E_USAGE', message: '接管输入参数无效', exitCode: ExitCodes.USAGE });
}

export function validatePointer(events) {
  if (!Array.isArray(events) || events.length > 200) throw invalidTakeoverInput();
  let previous = -1;
  return events.map((event) => {
    if (!event || !['down', 'move', 'up'].includes(event.type)
      || ![event.t, event.x, event.y].every(Number.isFinite) || event.t < previous
      || event.t < 0 || event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1) throw invalidTakeoverInput();
    previous = event.t;
    return { t: event.t, type: event.type, x: event.x, y: event.y };
  });
}

export function validateText(text) {
  if (typeof text !== 'string' || [...text].length > 64) throw invalidTakeoverInput();
  return text;
}

export function validateKey(key) {
  if (typeof key !== 'string' || !Object.hasOwn(KEYS, key)) throw invalidTakeoverInput();
  return { key, code: KEYS[key][0], windowsVirtualKeyCode: KEYS[key][1] };
}

function inputQueue(signal) {
  let pending = Promise.resolve();
  return (operation) => {
    const previous = pending;
    pending = (async () => {
      try { await previous; } catch { /* A rejected batch does not poison later input. */ }
      if (signal.aborted) throw invalidTakeoverInput();
      return operation();
    })();
    return pending;
  };
}

async function replay(cdp, events, state, signal) {
  for (const event of events) {
    // Remounting the frontend resets its performance.now() origin.
    const wait = state.lastT == null ? 0 : state.lastWall + event.t - state.lastT - Date.now();
    if (wait > 0) await waitForPointerTime(wait, signal);
    if (signal.aborted) throw invalidTakeoverInput();
    const dispatchedAt = Date.now();
    if (event.type === 'down') state.pressed = true;
    if (event.type === 'up') state.pressed = false;
    await cdp.send('Input.dispatchMouseEvent', {
      type: { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[event.type],
      x: event.x * state.width, y: event.y * state.height,
      button: event.type === 'move' ? 'none' : 'left', buttons: state.pressed ? 1 : 0,
      ...(event.type === 'move' ? {} : { clickCount: 1 }),
    });
    state.lastT = event.t;
    state.lastWall = dispatchedAt;
  }
}

async function waitForPointerTime(wait, signal) {
  const deadline = Date.now() + wait;
  while (Date.now() < deadline) await abortableSleep(Math.min(1000, deadline - Date.now()), signal);
}

function receiveFrame(cdp, frames, state, event) {
  void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  const { deviceWidth: width, deviceHeight: height } = event.metadata ?? {};
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)) return;
  state.width = width;
  state.height = height;
  frames.publish({ jpeg: event.data, width, height });
}

export async function openTakeover(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = createLatestFrames();
  const controller = new AbortController();
  const enqueue = inputQueue(controller.signal);
  const state = { width: 0, height: 0, pressed: false, lastT: null };
  const onFrame = (event) => receiveFrame(cdp, frames, state, event);
  const close = async () => {
    if (controller.signal.aborted) return;
    controller.abort();
    frames.close();
    cdp.off('Page.screencastFrame', onFrame);
    try { await cdp.send('Page.stopScreencast'); } catch { /* Browser may already be closed. */ }
    try { await cdp.detach(); } catch { /* Keep cleanup idempotent. */ }
  };
  cdp.on('Page.screencastFrame', onFrame);
  try { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, everyNthFrame: 1 }); }
  catch (error) { await close(); throw error; }
  return takeoverControls({ cdp, frames, enqueue, state, controller, close });
}

function takeoverControls({ cdp, frames, enqueue, state, controller, close }) {
  return {
    frames, close,
    dispatchPointer(input) {
      const events = validatePointer(input);
      if (!state.width) throw invalidTakeoverInput();
      return enqueue(() => replay(cdp, events, state, controller.signal));
    },
    insertText(input) {
      const text = validateText(input);
      return enqueue(() => cdp.send('Input.insertText', { text }));
    },
    pressKey(input) {
      const key = validateKey(input);
      return enqueue(async () => {
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
      });
    },
  };
}
