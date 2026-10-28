// 控制台单页：账号列表 → 账号详情 → 登录会话（接管画面 / 二维码）。
import { h, render } from '../vendor/preact.mjs';
import { useCallback, useEffect, useRef, useState } from '../vendor/hooks.mjs';
import htm from '../vendor/htm.mjs';
import Panzoom from '../vendor/panzoom.mjs';

const html = htm.bind(h);
const POINTER_FLUSH_MS = 50;
const SESSION_POLL_MS = 1000;
const MAX_ZOOM = 6;
const PINCH_STEP = 0.8;
const TOUCH_HOLD_MS = 120;
const TOUCH_SLOP_PX = 8;
const IME_SENTINEL = '\u200b';
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
const STATE_TEXT = {
  filling: '正在自动填写账号密码…',
  takeover: '需要你在下方画面中完成验证',
  qr: '请用商家版 App 扫码，或长按保存二维码后从相册识别',
  verifying: '登录成功，正在核验并保存…',
  succeeded: '登录完成，已保存',
  failed: '登录未完成',
  timed_out: '接管超时，已结束',
  cancelled: '已取消',
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api(path, body) {
  const init = body === undefined
    ? { method: 'GET', credentials: 'same-origin' }
    : {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-PDD-Console': '1' },
      body: JSON.stringify(body),
    };
  const response = await fetch(path, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, payload?.error?.code ?? null, payload?.error?.message ?? `请求失败（${response.status}）`);
  }
  return payload;
}

function errorText(error) {
  if (error?.status === 401) return '访问已过期，请让助手重新发送控制台链接';
  return error?.message ?? '请求失败';
}

function parseRoute(hash) {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'accounts' && parts[1]) return { name: 'account', slug: parts[1] };
  if (parts[0] === 'sessions' && parts[1]) return { name: 'session', id: parts[1], slug: parts[2] ?? null };
  return { name: 'list' };
}

function navigate(path) {
  window.location.hash = path;
}

function useRoute() {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function useAccounts() {
  const [state, setState] = useState({ loading: true, items: [], error: null });
  const reload = useCallback(async () => {
    try {
      const payload = await api('/api/accounts');
      setState({ loading: false, items: payload.items ?? [], error: null });
    } catch (error) {
      setState((previous) => ({ ...previous, loading: false, error }));
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function Notice({ error, message }) {
  if (error) return html`<p class="notice notice-error" role="alert">${errorText(error)}</p>`;
  if (message) return html`<p class="notice" role="status">${message}</p>`;
  return null;
}

function StatusChips({ account }) {
  const pending = account.pending_actions ?? [];
  return html`
    <ul class="chips">
      <li class="chip">会话：${account.session_status ?? '未知'}</li>
      <li class="chip">${account.has_password ? '已保存密码' : '未保存密码'}</li>
      ${account.password_relogin_status && html`<li class="chip">重登：${account.password_relogin_status}</li>`}
      ${pending.length > 0 && html`<li class="chip chip-alert">待处理 ${pending.length} 项</li>`}
    </ul>`;
}

function AccountList() {
  const { loading, items, error } = useAccounts();
  return html`
    <section>
      <h1>商家账号</h1>
      <${Notice} error=${error} />
      ${loading && html`<p class="muted">加载中…</p>`}
      ${!loading && items.length === 0 && !error && html`<p class="muted">尚未注册账号，请先在命令行执行 pdd login</p>`}
      <ul class="cards">
        ${items.map((account) => html`
          <li key=${account.slug}>
            <a class="card" href=${`#/accounts/${encodeURIComponent(account.slug)}`}>
              <strong>${account.display_name ?? account.slug}</strong>
              <span class="muted">${account.slug}</span>
              <${StatusChips} account=${account} />
            </a>
          </li>`)}
      </ul>
    </section>`;
}

function PasswordForm({ slug, onSaved }) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/api/accounts/${encodeURIComponent(slug)}/password`, { login_name: loginName, password });
      onSaved('密码已保存');
    } catch (failure) {
      setError(failure);
    } finally {
      // 无论成败都清空，页面不保留已输入的值。
      setLoginName('');
      setPassword('');
      setBusy(false);
    }
  };
  return html`
    <form class="panel" onSubmit=${submit} autocomplete="off">
      <h2>录入或重设密码</h2>
      <p class="muted">只能写入，保存后不会再显示。</p>
      <label>登录名（手机号）
        <input name="pdd-login-name" value=${loginName} onInput=${(e) => setLoginName(e.currentTarget.value)}
          autocomplete="off" inputmode="tel" required maxlength="128" />
      </label>
      <label>密码
        <input name="pdd-password" type="password" value=${password} onInput=${(e) => setPassword(e.currentTarget.value)}
          autocomplete="new-password" required maxlength="128" />
      </label>
      <${Notice} error=${error} />
      <button type="submit" disabled=${busy}>${busy ? '保存中…' : '保存'}</button>
    </form>`;
}

function AccountActions({ account, onDone, onError }) {
  const slug = encodeURIComponent(account.slug);
  const blocked = account.password_relogin_status?.startsWith('已熔断') ?? false;
  const run = async (path, message) => {
    try {
      const payload = await api(`/api/accounts/${slug}/${path}`, {});
      if (payload.session_id) navigate(`/sessions/${encodeURIComponent(payload.session_id)}/${slug}`);
      else onDone(message);
    } catch (error) {
      onError(error);
    }
  };
  return html`
    <div class="panel actions">
      <h2>操作</h2>
      ${blocked && html`<button onClick=${() => run('unblock', '已解除熔断')}>解除熔断</button>`}
      ${account.has_password && !blocked && html`<button onClick=${() => run('relogin')}>开始重登</button>`}
      ${!blocked && html`<button class="secondary" onClick=${() => run('qr')}>改用扫码登录</button>`}
      ${blocked && html`<p class="muted">已熔断：先解除熔断或重设密码，再开始重登或扫码。</p>`}
      ${account.has_password && html`
        <button class="danger" onClick=${() => window.confirm('确定清除已保存的密码？') && run('password/clear', '密码已清除')}>清除密码</button>`}
    </div>`;
}

function AccountDetail({ slug }) {
  const { loading, items, error, reload } = useAccounts();
  const [message, setMessage] = useState(null);
  const [actionError, setActionError] = useState(null);
  const account = items.find((item) => item.slug === slug);
  const done = (text) => { setMessage(text); setActionError(null); reload(); };
  return html`
    <section>
      <a class="back" href="#/">← 账号列表</a>
      <${Notice} error=${error ?? actionError} message=${message} />
      ${loading && html`<p class="muted">加载中…</p>`}
      ${!loading && !account && !error && html`<p class="muted">找不到账号 ${slug}</p>`}
      ${account && html`
        <h1>${account.display_name ?? account.slug}</h1>
        <${StatusChips} account=${account} />
        ${(account.pending_actions ?? []).map((action) => html`
          <p class="notice notice-alert" key=${`${action.kind}-${action.created_at}`}>
            ${action.kind}：${action.reason}（${action.created_at}）
          </p>`)}
        <${AccountActions} account=${account} onDone=${done} onError=${setActionError} />
        <${PasswordForm} slug=${account.slug} onSaved=${done} />`}
    </section>`;
}

function useSession(id) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let stopped = false;
    let timer = null;
    const poll = async () => {
      try {
        const payload = await api(`/api/sessions/${encodeURIComponent(id)}`);
        if (stopped) return;
        setSession(payload);
        setError(null);
        if (TERMINAL_STATES.has(payload.state)) return;
      } catch (failure) {
        if (stopped) return;
        setError(failure);
        if (failure.status === 401 || failure.status === 404) return;
      }
      timer = setTimeout(poll, SESSION_POLL_MS);
    };
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, [id]);
  return { session, error };
}

function useFrames(id, enabled) {
  const [frame, setFrame] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const source = new EventSource(`/api/sessions/${encodeURIComponent(id)}/frames`);
    source.addEventListener('frame', (event) => {
      try { setFrame(JSON.parse(event.data)); } catch { /* 丢弃损坏的帧。 */ }
    });
    return () => source.close();
  }, [id, enabled]);
  return frame;
}

function usePointerBatches(id, image, onFocus) {
  const queue = useRef([]);
  const origin = useRef(performance.now());
  useEffect(() => {
    const timer = setInterval(async () => {
      if (queue.current.length === 0) return;
      const events = queue.current.splice(0);
      try {
        const result = await api(`/api/sessions/${encodeURIComponent(id)}/pointer`, { events });
        if (typeof result.editable === 'boolean') onFocus.current?.(result);
      } catch { /* 丢失的批次由用户重新操作。 */ }
    }, POINTER_FLUSH_MS);
    return () => clearInterval(timer);
  }, [id]);
  // 坐标按缩放后的图片位置归一化，缩放平移不影响映射。
  const sample = useCallback((type, event) => {
    const rect = image.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const clamp = (value) => Math.min(1, Math.max(0, value));
    return {
      t: Math.round(performance.now() - origin.current), type,
      x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height),
    };
  }, []);
  const send = useCallback((records) => { queue.current.push(...records.filter(Boolean)); }, []);
  return { sample, send };
}

function usePanzoom(image, ready) {
  const panzoom = useRef(null);
  useEffect(() => {
    if (!ready || !image.current) return undefined;
    const instance = Panzoom(image.current, {
      noBind: true, contain: 'outside', minScale: 1, maxScale: MAX_ZOOM, step: PINCH_STEP,
      cursor: 'default',
    });
    panzoom.current = instance;
    return () => { instance.destroy(); instance.resetStyle(); panzoom.current = null; };
  }, [ready]);
  return panzoom;
}

// 单指：点击或拖动远端页面；双指：本地缩放平移。按下后短暂等待，第二指到达则整次手势归本地。
function routeToRemote(router) {
  clearTimeout(router.timer);
  router.mode = 'remote';
  router.send(router.held.splice(0));
}

function routeToPanzoom(router) {
  clearTimeout(router.timer);
  if (router.mode === 'remote') router.send([router.sample('up', router.last)]);
  router.held = [];
  router.mode = 'panzoom';
  router.middle = middleOf(router.pointers);
  for (const event of router.pointers.values()) router.panzoom.current?.handleDown(event);
}

function middleOf(pointers) {
  const [first, second = first] = pointers.values();
  return { x: (first.clientX + second.clientX) / 2, y: (first.clientY + second.clientY) / 2 };
}

// Panzoom 自带的双指平移会覆盖捏合焦点，这里按双指中点的增量自行平移。
function panzoomMove(router, event) {
  const instance = router.panzoom.current;
  if (!instance) return;
  instance.handleMove(event);
  if (router.pointers.size < 2) return;
  const middle = middleOf(router.pointers);
  const scale = instance.getScale();
  instance.pan((middle.x - router.middle.x) / scale, (middle.y - router.middle.y) / scale, { relative: true, animate: false });
  router.middle = middle;
}

function routerDown(router, event) {
  event.preventDefault();
  event.currentTarget.setPointerCapture?.(event.pointerId);
  router.pointers.set(event.pointerId, event);
  if (router.pointers.size > 1) return routeToPanzoom(router);
  router.last = event;
  router.origin = event;
  router.held = [router.sample('down', event)];
  if (event.pointerType === 'mouse') return routeToRemote(router);
  router.mode = 'pending';
  router.timer = setTimeout(() => routeToRemote(router), TOUCH_HOLD_MS);
}

function routerMove(router, event) {
  if (!router.pointers.has(event.pointerId)) return;
  router.pointers.set(event.pointerId, event);
  if (router.mode === 'panzoom') return panzoomMove(router, event);
  router.last = event;
  const record = router.sample('move', event);
  if (router.mode === 'remote') return router.send([record]);
  router.held.push(record);
  const moved = Math.hypot(event.clientX - router.origin.clientX, event.clientY - router.origin.clientY);
  if (moved > TOUCH_SLOP_PX) routeToRemote(router);
}

function routerUp(router, event) {
  if (!router.pointers.delete(event.pointerId)) return;
  if (router.mode === 'panzoom') {
    router.panzoom.current?.handleUp(event);
    const rest = [...router.pointers.values()];
    if (rest.length === 0) router.mode = 'idle';
    else router.panzoom.current?.handleDown(rest[0]);
    if (rest.length > 1) router.middle = middleOf(router.pointers);
    return;
  }
  if (router.mode === 'pending') routeToRemote(router);
  router.send([router.sample('up', event)]);
  router.mode = 'idle';
}

function useGestureRouter(sample, send, panzoom) {
  const router = useRef(null);
  if (!router.current) router.current = { mode: 'idle', pointers: new Map(), held: [], timer: null, origin: null, last: null };
  Object.assign(router.current, { sample, send, panzoom });
  useEffect(() => () => clearTimeout(router.current.timer), []);
  const up = (event) => routerUp(router.current, event);
  return {
    onPointerDown: (event) => routerDown(router.current, event),
    onPointerMove: (event) => routerMove(router.current, event),
    onPointerUp: up, onPointerCancel: up,
    onWheel: (event) => panzoom.current?.zoomWithWheel(event),
  };
}

// 隐藏输入框承接手机输入法：始终保留一个占位字符，占位被删即视为退格。
function useRemoteKeyboard(id) {
  const input = useRef(null);
  const chain = useRef(Promise.resolve());
  const composing = useRef(false);
  const [numeric, setNumeric] = useState(false);
  const post = (body) => {
    chain.current = chain.current.then(() => api(`/api/sessions/${encodeURIComponent(id)}/text`, body)).catch(() => {});
  };
  const flush = () => {
    const element = input.current;
    if (!element || composing.current) return;
    const text = element.value.replaceAll(IME_SENTINEL, '');
    if (text) post({ text });
    else if (!element.value.includes(IME_SENTINEL)) post({ key: 'Backspace' });
    element.value = IME_SENTINEL;
    element.setSelectionRange(1, 1);
  };
  const onFocus = useCallback((focus) => {
    setNumeric(focus.numeric === true);
    if (focus.editable) input.current?.focus({ preventScroll: true });
    else input.current?.blur();
  }, []);
  const props = {
    ref: input, value: IME_SENTINEL, onInput: flush,
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd: () => { composing.current = false; flush(); },
    onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); post({ key: 'Enter' }); } },
  };
  return { input, numeric, onFocus, props };
}

function TakeoverScreen({ id }) {
  const frame = useFrames(id, true);
  const image = useRef(null);
  const keyboard = useRemoteKeyboard(id);
  const onFocus = useRef(keyboard.onFocus);
  const { sample, send } = usePointerBatches(id, image, onFocus);
  const panzoom = usePanzoom(image, frame !== null);
  const handlers = useGestureRouter(sample, send, panzoom);
  const toggleKeyboard = () => {
    const element = keyboard.input.current;
    if (document.activeElement === element) element.blur();
    else element?.focus({ preventScroll: true });
  };
  if (!frame) return html`<div class="screen-wrap screen-empty">等待画面…</div>`;
  return html`
    <p class="muted">单指点击或拖动页面；双指缩放、移动画面。点中页面输入框后会弹出键盘。</p>
    <div class="screen-box">
      <div class="screen-wrap" ...${handlers}>
        <img ref=${image} class="screen" alt="登录页画面" draggable="false"
          src=${`data:image/jpeg;base64,${frame.jpeg}`} width=${frame.width} height=${frame.height}
          onContextMenu=${(event) => event.preventDefault()} />
      </div>
      <div class="screen-tools">
        <button type="button" class="tool" onClick=${toggleKeyboard}>键盘</button>
        <button type="button" class="tool" onClick=${() => panzoom.current?.reset({ animate: false })}>复位</button>
      </div>
      <input class="ime" ...${keyboard.props} aria-label="向页面输入文字" autocomplete=${keyboard.numeric ? 'one-time-code' : 'off'}
        inputmode=${keyboard.numeric ? 'numeric' : 'text'} autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="enter" />
    </div>`;
}

function Countdown({ seconds }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => { setLeft(seconds); }, [seconds]);
  useEffect(() => {
    const timer = setInterval(() => setLeft((value) => (value > 0 ? value - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!Number.isFinite(left)) return null;
  const minutes = Math.floor(left / 60);
  return html`<span class="muted">剩余 ${minutes}:${String(left % 60).padStart(2, '0')}</span>`;
}

function QrPanel({ id, image }) {
  const [error, setError] = useState(null);
  const refresh = () => api(`/api/sessions/${encodeURIComponent(id)}/qr/refresh`, {}).catch(setError);
  return html`
    <div class="panel qr">
      ${image ? html`<img class="qr-image" src=${image} alt="登录二维码，长按保存" />` : html`<p class="muted">正在获取二维码…</p>`}
      <p class="muted">长按图片保存到相册，在商家版 App 扫一扫中选择相册识别。</p>
      <button class="secondary" onClick=${refresh}>刷新二维码</button>
      <${Notice} error=${error} />
    </div>`;
}

function SessionView({ id, slug }) {
  const { session, error } = useSession(id);
  const state = session?.state ?? null;
  const finished = state !== null && TERMINAL_STATES.has(state);
  const cancel = () => api(`/api/sessions/${encodeURIComponent(id)}/cancel`, {}).catch(() => {});
  const back = slug ? `#/accounts/${encodeURIComponent(slug)}` : '#/';
  return html`
    <section>
      <a class="back" href=${back}>← 返回</a>
      <h1>登录会话</h1>
      <${Notice} error=${error} />
      ${state && html`<p class=${`state state-${state}`}>${STATE_TEXT[state] ?? state}</p>`}
      ${session?.message && html`<p class="muted">${session.message}</p>`}
      ${!finished && session && html`<${Countdown} seconds=${session.remaining_seconds} />`}
      ${state === 'takeover' && html`<${TakeoverScreen} id=${id} />`}
      ${state === 'qr' && html`<${QrPanel} id=${id} image=${session.qr_image} />`}
      ${!finished && session && html`<button class="danger" onClick=${cancel}>结束会话</button>`}
      ${finished && html`<a class="button" href=${back}>完成</a>`}
    </section>`;
}

function App() {
  const route = useRoute();
  if (route.name === 'account') return html`<${AccountDetail} slug=${route.slug} />`;
  if (route.name === 'session') return html`<${SessionView} id=${route.id} slug=${route.slug} />`;
  return html`<${AccountList} />`;
}

const root = document.getElementById('app');
root.textContent = '';
render(html`<${App} />`, root);
