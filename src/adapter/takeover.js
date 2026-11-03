import { abortableSleep } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { createLatestFrames } from './latest-frames.js';
import { readDialog, captureDialog } from './takeover-dialog.js';

const KEYS = Object.freeze({ Enter: ['Enter', 13], Backspace: ['Backspace', 8], Tab: ['Tab', 9] });
const SMS_CODE = /^\d{4,8}$/;
const NO_DIALOG = Object.freeze({ jpeg: null, width: null, height: null });
const FOCUS_EXPRESSION = `(() => {
  let element = document.activeElement;
  while (['IFRAME', 'FRAME'].includes(element?.tagName)) {
    try {
      const active = element.contentDocument?.activeElement;
      if (!active) break;
      element = active;
    } catch { break; }
  }
  const tag = element?.tagName;
  const type = (element?.getAttribute('type') || 'text').toLowerCase();
  const inputMode = (element?.getAttribute('inputmode') || '').toLowerCase();
  const editable = !!element && !element.disabled && !element.readOnly
    && (tag === 'TEXTAREA' || element.contentEditable === 'true' || element.isContentEditable === true
      || (tag === 'INPUT' && ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].includes(type)));
  const numeric = editable && ((tag === 'INPUT' && ['tel', 'number'].includes(type))
    || ['numeric', 'tel', 'decimal'].includes(inputMode));
  return { editable, numeric };
})()`;

async function readFocus(cdp) {
  try {
    const response = await cdp.send('Runtime.evaluate', { expression: FOCUS_EXPRESSION, returnByValue: true });
    const value = response?.result?.value;
    if (!response?.exceptionDetails && typeof value?.editable === 'boolean' && typeof value?.numeric === 'boolean') {
      return { editable: value.editable, numeric: value.numeric };
    }
  } catch { /* Focus detection is best-effort; pointer replay errors still propagate. */ }
  return { editable: null, numeric: null };
}

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

export function validateSmsCode(code) {
  if (typeof code !== 'string' || !SMS_CODE.test(code)) throw invalidTakeoverInput();
  return code;
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

async function replay(cdp, events, state, signal, area) {
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
      x: area.x + event.x * area.width, y: area.y + event.y * area.height,
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

// screencast 帧只用作页面重绘信号，画面本身来自弹窗区域截图。
function receiveFrame(channel, event) {
  void channel.cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  void refresh(channel);
}

// 页面每重绘一次就刷新一次弹窗画面；刷新进行中到达的帧合并为一次补刷。
async function refresh(channel) {
  const { state, controller } = channel;
  if (state.refreshing) { state.dirty = true; return; }
  state.refreshing = true;
  try {
    do {
      state.dirty = false;
      await refreshOnce(channel);
    } while (state.dirty && !controller.signal.aborted);
  } finally { state.refreshing = false; }
}

// 按住期间锁定弹窗区域，保证一次拖动内坐标映射不变；截图偶发失败时保留上一张画面。
async function refreshOnce({ cdp, frames, state }) {
  if (!state.pressed) state.dialog = await readDialog(cdp);
  const dialog = state.dialog;
  if (!dialog) {
    state.shown = null;
    frames.publish(NO_DIALOG);
    return;
  }
  const jpeg = await captureDialog(cdp, dialog);
  if (!jpeg) return;
  state.shown = dialog;
  frames.publish({ jpeg, width: dialog.width, height: dialog.height });
}

export async function openTakeover(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = createLatestFrames();
  const controller = new AbortController();
  const enqueue = inputQueue(controller.signal);
  const state = { pressed: false, lastT: null, dialog: null, shown: null };
  const channel = { cdp, frames, state, controller };
  const onFrame = (event) => receiveFrame(channel, event);
  const close = async () => {
    if (controller.signal.aborted) return;
    controller.abort();
    frames.close();
    cdp.off('Page.screencastFrame', onFrame);
    try { await cdp.send('Page.stopScreencast'); } catch { /* Browser may already be closed. */ }
    try { await cdp.detach(); } catch { /* Keep cleanup idempotent. */ }
  };
  cdp.on('Page.screencastFrame', onFrame);
  try { await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 10, maxWidth: 320, everyNthFrame: 1 }); }
  catch (error) { await close(); throw error; }
  return takeoverControls({ ...channel, enqueue, close });
}

function takeoverControls(channel) {
  const { cdp, frames, enqueue, state, controller, close } = channel;
  return {
    frames, close,
    dispatchPointer(input) {
      const events = validatePointer(input);
      const area = state.shown;
      if (!area) throw invalidTakeoverInput();
      return enqueue(async () => {
        await replay(cdp, events, state, controller.signal, area);
        if (!events.some((event) => event.type === 'up')) return { editable: null, numeric: null };
        await abortableSleep(150, controller.signal);
        return readFocus(cdp);
      });
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
