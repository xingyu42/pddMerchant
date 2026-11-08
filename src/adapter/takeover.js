import { abortableSleep } from '../infra/abort.js';
import { PddCliError, ExitCodes } from '../infra/errors.js';
import { createLatestFrames } from './latest-frames.js';
import { readDialog, captureDialog } from './takeover-dialog.js';

const KEYS = Object.freeze({ Enter: ['Enter', 13], Backspace: ['Backspace', 8], Tab: ['Tab', 9] });
const SMS_CODE = /^\d{4,8}$/;
const NO_DIALOG = Object.freeze({ jpeg: null, width: null, height: null });
const POINTER_WAIT_MS = 5000;
const POINTER_IDLE_MS = 3000;
const POINTER_LAG_MS = 1000;
const POINTER_TIME_MS = 720_000;
const REFRESH_GAP_MS = 200;
const INTERRUPTED = Object.freeze({ editable: null, numeric: null, result: 'interrupted' });
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

function validatePointer(events) {
  if (!Array.isArray(events) || events.length > 200) throw invalidTakeoverInput();
  let previous = -1;
  return events.map((event) => {
    if (!event || !['down', 'move', 'up'].includes(event.type)
      || ![event.t, event.x, event.y].every(Number.isFinite) || event.t < previous
      || event.t < 0 || event.t > POINTER_TIME_MS || event.t - events[0].t > POINTER_WAIT_MS
      || event.x < 0 || event.x > 1 || event.y < 0 || event.y > 1) throw invalidTakeoverInput();
    previous = event.t;
    return { t: event.t, type: event.type, x: event.x, y: event.y };
  });
}

export function validatePointerBatch(input, metadata) {
  if (!metadata || typeof metadata.gesture_id !== 'string' || !/^[\w-]{1,64}$/.test(metadata.gesture_id)
    || !Number.isSafeInteger(metadata.seq) || metadata.seq < 0
    || (metadata.cancel !== undefined && typeof metadata.cancel !== 'boolean')) throw invalidTakeoverInput();
  const events = validatePointer(input);
  if (metadata.cancel ? events.length !== 0 : events.length === 0) throw invalidTakeoverInput();
  return { events, gesture_id: metadata.gesture_id, seq: metadata.seq, cancel: metadata.cancel === true };
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

export function inputQueue(signal) {
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

async function releasePointer(pointer) {
  clearTimeout(pointer.timer);
  if (pointer.gesture) pointer.gesture.ended = true;
  if (pointer.state.pressed) {
    try { await pointer.dispatch({ ...pointer.lastEvent, type: 'up' }, pointer.area, false); }
    finally { pointer.state.pressed = false; }
  }
  return INTERRUPTED;
}

async function beginPointerBatch(pointer, batch, area) {
  const first = batch.events[0];
  if (batch.cancel) {
    pointer.seen.add(batch.gesture_id);
    return pointer.gesture?.id === batch.gesture_id ? releasePointer(pointer) : INTERRUPTED;
  }
  if (pointer.gesture?.id !== batch.gesture_id) {
    if (pointer.seen.has(batch.gesture_id) || batch.seq !== 0) {
      pointer.seen.add(batch.gesture_id);
      return releasePointer(pointer);
    }
    await releasePointer(pointer);
    pointer.seen.add(batch.gesture_id);
    pointer.area = area;
    pointer.gesture = { id: batch.gesture_id, seq: 0, anchor: Date.now() - first.t, lastT: first.t, ended: false };
  }
  const gesture = pointer.gesture;
  if (gesture.ended || batch.seq !== gesture.seq || first.t < gesture.lastT) return releasePointer(pointer);
  if (first.t - gesture.lastT > POINTER_WAIT_MS) {
    await releasePointer(pointer);
    throw invalidTakeoverInput();
  }
  gesture.seq++;
  return null;
}

function armPointerIdle(pointer) {
  clearTimeout(pointer.timer);
  if (!pointer.state.pressed || pointer.signal.aborted) return;
  const gesture = pointer.gesture;
  const sequence = gesture.seq;
  pointer.timer = setTimeout(async () => {
    try {
      await pointer.enqueue(() => {
        if (pointer.gesture === gesture && gesture.seq === sequence) return releasePointer(pointer);
      });
    } catch { /* 通道关闭或浏览器退出时，清理由会话负责。 */ }
  }, Math.max(0, pointer.lastWall + POINTER_IDLE_MS - Date.now()));
  pointer.timer.unref?.();
}

async function replayPointerEvents(pointer, events) {
  for (const event of events) {
    // 固定手势起点，迟到批次只追赶进度，后续轨迹不随之整体后移。
    const wait = pointer.gesture.anchor + event.t - Date.now();
    if (wait < -POINTER_LAG_MS) return releasePointer(pointer);
    if (wait > POINTER_WAIT_MS) { await releasePointer(pointer); throw invalidTakeoverInput(); }
    if (wait > 0) await abortableSleep(wait, pointer.signal);
    if (pointer.signal.aborted) throw invalidTakeoverInput();
    if (Date.now() - pointer.gesture.anchor - event.t > POINTER_LAG_MS) return releasePointer(pointer);
    pointer.lastEvent = event;
    if (event.type === 'down') pointer.state.pressed = true;
    const pressed = event.type === 'up' ? false : pointer.state.pressed;
    await pointer.dispatch(event, pointer.area, pressed);
    pointer.state.pressed = pressed;
    pointer.lastWall = Date.now();
    pointer.gesture.lastT = event.t;
  }
  if (events.some((event) => event.type === 'up')) pointer.gesture.ended = true;
  return null;
}

// 实际 CDP 与离线 fixture 共用顺序、时钟和丢失抬起恢复逻辑。
export function createPointerReplay(options) {
  const pointer = { ...options, seen: new Set(), gesture: null, timer: null };
  pointer.signal.addEventListener('abort', () => clearTimeout(pointer.timer), { once: true });
  return async (batch, area) => {
    clearTimeout(pointer.timer);
    try {
      const interrupted = await beginPointerBatch(pointer, batch, area);
      return interrupted ?? await replayPointerEvents(pointer, batch.events);
    } catch (error) {
      try { await releasePointer(pointer); } catch { /* 保留原始回放错误。 */ }
      throw error;
    } finally { armPointerIdle(pointer); }
  };
}

async function dispatchMouse(cdp, event, area, pressed) {
  await cdp.send('Input.dispatchMouseEvent', {
    type: { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[event.type],
    x: area.x + event.x * area.width, y: area.y + event.y * area.height,
    button: event.type === 'move' ? 'none' : 'left', buttons: pressed ? 1 : 0,
    ...(event.type === 'move' ? {} : { clickCount: 1 }),
  });
}

// screencast 帧只用作页面重绘信号，画面本身来自弹窗区域截图。
function receiveFrame(channel, event) {
  void channel.cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId }).catch(() => {});
  void refresh(channel);
}

// 页面每重绘一次就刷新一次弹窗画面；刷新进行中到达的帧合并为一次补刷。
// 截图本身也会让页面重绘出新帧，两次截图至少间隔 REFRESH_GAP_MS（与画面发布节拍一致），避免自激循环。
async function refresh(channel) {
  const { state, controller } = channel;
  if (state.refreshing) { state.dirty = true; return; }
  state.refreshing = true;
  try {
    do {
      const wait = state.refreshedAt + REFRESH_GAP_MS - Date.now();
      if (wait > 0) await abortableSleep(wait, controller.signal);
      state.dirty = false;
      await refreshOnce(channel);
      state.refreshedAt = Date.now();
    } while (state.dirty && !controller.signal.aborted);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally { state.refreshing = false; }
}

// 画面与上次发布相同时不再发布，弹窗静止时不向手机重复推送。
function publishFrame({ frames, state }, frame) {
  const last = state.published;
  if (last && last.jpeg === frame.jpeg && last.width === frame.width && last.height === frame.height) return;
  state.published = frame;
  frames.publish(frame);
}

// 按住期间锁定弹窗区域，保证一次拖动内坐标映射不变；截图偶发失败时保留上一张画面。
async function refreshOnce(channel) {
  const { cdp, state } = channel;
  if (!state.pressed) state.dialog = await readDialog(cdp);
  const dialog = state.dialog;
  if (!dialog) {
    state.shown = null;
    publishFrame(channel, NO_DIALOG);
    return;
  }
  const jpeg = await captureDialog(cdp, dialog);
  if (!jpeg) return;
  state.shown = dialog;
  publishFrame(channel, { jpeg, width: dialog.width, height: dialog.height });
}

export async function openTakeover(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = createLatestFrames();
  const controller = new AbortController();
  const enqueue = inputQueue(controller.signal);
  const state = { pressed: false, dialog: null, shown: null, published: null, refreshedAt: -Infinity };
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
  const replay = createPointerReplay({ state, enqueue, signal: controller.signal,
    dispatch: (event, area, pressed) => dispatchMouse(cdp, event, area, pressed) });
  let accepted = null;
  return {
    frames, close,
    dispatchPointer(input, metadata) {
      const batch = validatePointerBatch(input, metadata);
      const area = state.shown;
      // 只有新手势要求当前定位到弹窗；已接受手势的后续批次沿用按下时锁定的区域。
      if (!batch.cancel && batch.gesture_id !== accepted) {
        if (!area) throw invalidTakeoverInput();
        accepted = batch.gesture_id;
      }
      return enqueue(async () => {
        const interrupted = await replay(batch, area);
        if (interrupted) return interrupted;
        if (!batch.events.some((event) => event.type === 'up')) return { editable: null, numeric: null };
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
