// 控制台单页：账号列表 → 账号详情 → 登录会话（接管画面 / 二维码）。
import { h, render } from '../vendor/preact.mjs';
import { useCallback, useEffect, useRef, useState } from '../vendor/hooks.mjs';
import htm from '../vendor/htm.mjs';

const html = htm.bind(h);
const POINTER_FLUSH_MS = 50;
const SESSION_POLL_MS = 1000;
const IME_SENTINEL = '\u200b';
const TERMINAL_STATES = new Set(['succeeded', 'failed', 'timed_out', 'cancelled']);
const STATE_TEXT = {
  filling: '正在准备登录…',
  takeover: '完成验证码',
  sms: '输入短信验证码',
  qr: '扫码登录',
  verifying: '正在核验并保存…',
  succeeded: '登录成功',
  failed: '登录失败',
  timed_out: '登录超时',
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
  if (error?.status === 401) return '链接已失效，请让助手重新发送';
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

function StatusBadge({ account }) {
  return html`<span class=${`badge badge-${account.status_kind ?? 'unknown'}`}>
    <span class="badge-dot"></span>${account.status ?? '未知'}
  </span>`;
}

function AccountCard({ account, busy, run }) {
  const paused = account.status_kind === 'relogin_paused';
  const actionable = paused || ['action_required', 'relogin_required'].includes(account.status_kind);
  const passwordLogin = !paused && account.has_password;
  return html`
    <li class="card">
      <a class="card-link" href=${`#/accounts/${encodeURIComponent(account.slug)}`}>
        <div class="card-header">
          <strong class="card-title">${account.display_name ?? account.slug}</strong>
          <${StatusBadge} account=${account} />
        </div>
        ${account.status_detail && html`<div class="card-detail muted">${account.status_detail}</div>`}
      </a>
      ${actionable && html`<div class="card-action">
        <button class="secondary button-sm" disabled=${busy}
          onClick=${() => run(account.slug, passwordLogin ? 'relogin' : 'qr')}>
          ${passwordLogin ? '重新登录' : '扫码登录'}
        </button>
      </div>`}
    </li>`;
}

function patrolHint(patrol) {
  const every = patrol.interval_minutes ? `每 ${patrol.interval_minutes} 分钟` : '定期';
  return `开启后${every}检查登录，失效时用已存密码自动登录`;
}

// 开关失败时重绘会把复选框复位到服务端状态。
function usePatrol() {
  const [patrol, setPatrol] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const payload = await api('/api/patrol'); if (active) setPatrol(payload); }
      catch (failure) { if (active) setError(failure); }
    };
    void load();
    return () => { active = false; };
  }, []);
  const toggle = async (event) => {
    const enabled = event.currentTarget.checked;
    setBusy(true);
    setError(null);
    try { setPatrol(await api('/api/patrol', { enabled })); }
    catch (failure) { setError(failure); }
    finally { setBusy(false); }
  };
  return { patrol, busy, error, toggle };
}

// 弹出面板：点面板外或按 Esc 收起。
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !ref.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return { open, ref, toggleOpen: () => setOpen(!open) };
}

// 标题行右侧的胶囊显示巡航状态，点开面板里切换。
function PatrolSwitch({ patrol, busy, toggle }) {
  const { open, ref, toggleOpen } = usePopover();
  if (!patrol) return null;
  return html`
    <div class="patrol" ref=${ref}>
      <button type="button" class=${`patrol-pill${patrol.enabled ? ' is-on' : ''}`}
        aria-expanded=${String(open)} aria-controls="patrol-panel" onClick=${toggleOpen}>
        <span class="patrol-dot"></span>${patrol.enabled ? '巡航中' : '自动巡航'}
      </button>
      ${open && html`
        <div id="patrol-panel" class="patrol-panel">
          <label class="switch">自动巡航
            <input type="checkbox" role="switch" checked=${patrol.enabled} disabled=${busy} onChange=${toggle} />
          </label>
          <p>${patrolHint(patrol)}</p>
          ${patrol.last_patrol_at && html`<p class="muted">上次 ${patrol.last_patrol_at}</p>`}
        </div>`}
    </div>`;
}

function AccountList() {
  const { loading, items, error } = useAccounts();
  const [actionError, setActionError] = useState(null);
  const { busy, run } = useAccountAction({ onError: setActionError });
  const patrol = usePatrol();
  return html`
    <section>
      <div class="page-header">
        <h1>店铺</h1>
        <${PatrolSwitch} ...${patrol} />
      </div>
      <${Notice} error=${error ?? actionError ?? patrol.error} />
      ${loading && html`<p class="muted">加载中…</p>`}
      ${!loading && items.length === 0 && !error && html`<p class="muted">还没有店铺</p>`}
      <ul class="cards">
        ${items.map((account) => html`<${AccountCard} key=${account.slug} account=${account} busy=${busy} run=${run} />`)}
      </ul>
      ${!loading && html`<${AddAccountForm} openByDefault=${items.length === 0} />`}
    </section>`;
}

// 登录名 + 密码表单，只写不读。
function CredentialForm({ hint, submitText, busyText, submitCredential }) {
  const [loginName, setLoginName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitCredential({ login_name: loginName, password });
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
    <form onSubmit=${submit} autocomplete="off">
      <p class="muted">${hint}</p>
      <label>登录名
        <small class="muted">手机号或账号名；子账号填账号名</small>
        <input name="pdd-login-name" value=${loginName} onInput=${(e) => setLoginName(e.currentTarget.value)}
          autocomplete="off" autocapitalize="off" spellcheck="false" required maxlength="128" />
      </label>
      <label>密码
        <input name="pdd-password" type="password" value=${password} onInput=${(e) => setPassword(e.currentTarget.value)}
          autocomplete="new-password" required maxlength="128" />
      </label>
      <${Notice} error=${error} />
      <button type="submit" disabled=${busy}>${busy ? busyText : submitText}</button>
    </form>`;
}

function PasswordForm({ slug, hasPassword, paused, onSaved }) {
  const save = async (body) => {
    await api(`/api/accounts/${encodeURIComponent(slug)}/password`, body);
    onSaved('密码已保存');
  };
  return html`
    <details class="panel accordion" open=${paused}>
      <summary>${hasPassword ? '修改密码' : '设置密码'}</summary>
      <div class="accordion-body">
        <${CredentialForm} hint="仅用于自动登录，保存后不再显示"
          submitText="保存" busyText="保存中…" submitCredential=${save} />
      </div>
    </details>`;
}

// 新增账号：用登录名和密码登录，核验通过后按店铺登记账号并保存密码；短信、验证码在会话页完成。
function AddAccountForm({ openByDefault = false }) {
  const add = async (body) => {
    const { session_id: id } = await api('/api/accounts/add', body);
    navigate(`/sessions/${encodeURIComponent(id)}`);
  };
  return html`
    <details class="panel accordion" open=${openByDefault}>
      <summary>+ 添加店铺</summary>
      <div class="accordion-body">
        <${CredentialForm} hint="登录验证通过后添加，并保存密码"
          submitText="登录并添加" busyText="提交中…" submitCredential=${add} />
      </div>
    </details>`;
}

function useAccountAction({ onDone, onError }) {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = async (accountSlug, path, message, body = {}) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const slug = encodeURIComponent(accountSlug);
    try {
      const payload = await api(`/api/accounts/${slug}/${path}`, body);
      if (payload.session_id) navigate(`/sessions/${encodeURIComponent(payload.session_id)}/${slug}`);
      else if (payload.removed) navigate('/');
      else onDone?.(message);
    } catch (error) {
      onError(error);
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, running, run };
}

function AccountActions({ account, onDone, onError }) {
  const { busy, running, run: runAction } = useAccountAction({ onDone, onError });
  const run = (path, message, body) => runAction(account.slug, path, message, body);
  const paused = account.status_kind === 'relogin_paused';
  const passwordLogin = !paused && account.has_password;
  const clear = () => {
    if (running.current) return;
    if (window.confirm('清除已存密码？清除后不再自动登录。')) return run('password/clear', '密码已清除');
  };
  const remove = () => {
    if (running.current) return;
    const name = account.display_name ?? account.slug;
    const typed = window.prompt(`删除后登录态、密码和商品成本都会清除，无法恢复。输入店铺名「${name}」确认：`);
    if (typed != null) return run('remove', null, { confirm_name: typed.trim() });
  };
  return html`
    <div class="panel actions">
      <button disabled=${busy} onClick=${() => run(passwordLogin ? 'relogin' : 'qr')}>${passwordLogin ? '重新登录' : '扫码登录'}</button>
      ${passwordLogin && html`<button class="secondary" disabled=${busy} onClick=${() => run('qr')}>扫码登录</button>`}
      ${paused && html`
        <button class="secondary" disabled=${busy} onClick=${() => run('unblock', '已恢复自动登录')}>恢复自动登录</button>
        <p class="muted">可扫码登录；修改密码后自动恢复</p>`}
      <div class="action-danger">
        ${account.has_password && html`<button class="danger" disabled=${busy} onClick=${clear}>清除已存密码</button>`}
        <button class="danger" disabled=${busy} onClick=${remove}>删除店铺</button>
      </div>
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
      <a class="back" href="#/">← 店铺</a>
      <${Notice} error=${error ?? actionError} message=${message} />
      ${loading && html`<p class="muted">加载中…</p>`}
      ${!loading && !account && !error && html`<p class="muted">未找到店铺（${slug}）</p>`}
      ${account && html`
        <div class="detail-header">
          <h1>${account.display_name ?? account.slug}</h1>
          <${StatusBadge} account=${account} />
        </div>
        ${account.status_detail && html`<p class="muted">${account.status_detail}</p>`}
        <${AccountActions} account=${account} onDone=${done} onError=${setActionError} />
        <${PasswordForm} slug=${account.slug} hasPassword=${account.has_password}
          paused=${account.status_kind === 'relogin_paused'} onSaved=${done} />`}
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

async function flushPointerBatches(state) {
  if (state.sending || state.closed) return;
  state.sending = true;
  try {
    while (!state.closed && state.queue.length) {
      const gesture = state.queue[0];
      if (!gesture.events.length) {
        if (!gesture.ended) break;
        state.queue.shift();
        continue;
      }
      const body = { gesture_id: gesture.id, seq: gesture.seq++, events: gesture.events.splice(0, 200) };
      try {
        const result = await state.post(body);
        if (state.closed) return;
        if (result.result === 'interrupted') interruptPointerBatches(state);
        else if (typeof result.editable === 'boolean') state.onFocus(result);
      } catch (error) {
        if (!state.closed) interruptPointerBatches(state, error);
        // 请求可能已到达服务端；显式释放，断网时另有服务端空闲超时兜底。
        try { await state.post({ gesture_id: gesture.id, seq: gesture.seq++, events: [], cancel: true }); }
        catch { /* 保留重试提示，等待服务端自动释放。 */ }
      }
      if (state.queue[0] === gesture && gesture.ended && !gesture.events.length) state.queue.shift();
    }
  } finally { state.sending = false; }
}

function interruptPointerBatches(state, error) {
  state.queue.length = 0;
  state.current = null;
  state.onError(error?.status === 401 ? error : new Error('拖动中断，请重新操作'));
}

function createPointerBatches(post, onFocus, onError) {
  const state = { post, onFocus, onError, queue: [], current: null, sending: false, closed: false };
  const timer = setInterval(() => { void flushPointerBatches(state); }, POINTER_FLUSH_MS);
  return {
    send(records) {
      if (state.closed) return;
      for (const event of records.filter(Boolean)) {
        if (event.type === 'down') {
          if (state.current) state.current.ended = true;
          const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join('');
          state.current = { id, seq: 0, origin: event.t, events: [], ended: false };
          state.queue.push(state.current);
          onError(null);
        }
        if (!state.current) continue;
        state.current.events.push({ ...event, t: event.t - state.current.origin });
        if (event.type === 'up') { state.current.ended = true; state.current = null; }
      }
    },
    close() { state.closed = true; state.queue.length = 0; state.current = null; clearInterval(timer); },
  };
}

function usePointerBatches(id, image, onFocus) {
  const sender = useRef(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    setError(null);
    const batches = createPointerBatches((body) => api(`/api/sessions/${encodeURIComponent(id)}/pointer`, body),
      (result) => onFocus.current?.(result), setError);
    sender.current = batches;
    return () => { batches.close(); sender.current = null; };
  }, [id]);
  // 坐标按图片当前实际渲染的矩形归一化。
  const sample = useCallback((type, event) => {
    const rect = image.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return null;
    const clamp = (value) => Math.min(1, Math.max(0, value));
    return {
      t: Math.round(performance.now()), type,
      x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height),
    };
  }, []);
  const send = useCallback((records) => { sender.current?.send(records); }, []);
  return { sample, send, error };
}

// 单指点击或拖动验证码弹窗，只跟踪第一根手指。
function usePointerGesture(sample, send) {
  const active = useRef(null);
  const up = (event) => {
    if (active.current !== event.pointerId) return;
    active.current = null;
    send([sample('up', event)]);
  };
  return {
    onPointerDown: (event) => {
      event.preventDefault();
      if (active.current !== null) return;
      active.current = event.pointerId;
      event.currentTarget.setPointerCapture?.(event.pointerId);
      send([sample('down', event)]);
    },
    onPointerMove: (event) => { if (active.current === event.pointerId) send([sample('move', event)]); },
    onPointerUp: up, onPointerCancel: up,
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
  const { sample, send, error } = usePointerBatches(id, image, onFocus);
  const handlers = usePointerGesture(sample, send);
  if (!frame?.jpeg) return html`<${Notice} error=${error} /><div class="screen-wrap screen-empty">等待验证码…</div>`;
  return html`
    <p class="muted">拖动滑块或点选；点到输入框会弹出键盘</p>
    <${Notice} error=${error} />
    <div class="screen-box">
      <div class="screen-wrap" ...${handlers}>
        <img ref=${image} class="screen" alt="安全验证" draggable="false"
          src=${`data:image/jpeg;base64,${frame.jpeg}`} width=${frame.width} height=${frame.height}
          onContextMenu=${(event) => event.preventDefault()} />
      </div>
      <input class="ime" ...${keyboard.props} aria-label="输入验证码文字" autocomplete=${keyboard.numeric ? 'one-time-code' : 'off'}
        inputmode=${keyboard.numeric ? 'numeric' : 'text'} autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="enter" />
    </div>`;
}

const SMS_RESULT_TEXT = {
  submitted: '已提交，正在等待登录结果',
  wrong_code: '验证码错误，请重新输入',
  form_changed: '找不到短信输入框，请改用扫码登录',
};

// 短信码由人在这里输入，daemon 填进登录页的短信弹窗并提交，画面不转播。
function SmsPanel({ id }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const { result } = await api(`/api/sessions/${encodeURIComponent(id)}/sms`, { code });
      setMessage(SMS_RESULT_TEXT[result] ?? null);
      if (result === 'wrong_code') setCode('');
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  };
  return html`
    <form class="panel" onSubmit=${submit} autocomplete="off">
      <label>短信验证码
        <input value=${code} onInput=${(event) => setCode(event.currentTarget.value.replace(/\D/g, '').slice(0, 8))}
          inputmode="numeric" autocomplete="one-time-code" required />
      </label>
      <button type="submit" disabled=${busy || code.length < 4}>提交</button>
      <${Notice} error=${error} message=${message} />
    </form>`;
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
  return html`<span class=${`muted${left <= 60 ? ' countdown-urgent' : ''}`}>剩余 ${minutes}:${String(left % 60).padStart(2, '0')}</span>`;
}

function QrPanel({ id, image }) {
  const [error, setError] = useState(null);
  const refresh = () => api(`/api/sessions/${encodeURIComponent(id)}/qr/refresh`, {}).catch(setError);
  return html`
    <div class="panel qr">
      ${image ? html`<img class="qr-image" src=${image} alt="登录二维码，长按保存" />` : html`<p class="muted">正在获取二维码…</p>`}
      <p class="muted">长按保存二维码，在商家版 App 扫一扫里从相册识别</p>
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
      <h1>店铺登录</h1>
      <${Notice} error=${error} />
      ${state && html`<p class=${`state state-${state}`}>${STATE_TEXT[state] ?? state}</p>`}
      ${session?.message && html`<p class="muted">${session.message}</p>`}
      ${!finished && session && html`<${Countdown} seconds=${session.remaining_seconds} />`}
      ${state === 'takeover' && html`<${TakeoverScreen} id=${id} />`}
      ${state === 'sms' && html`<${SmsPanel} id=${id} />`}
      ${state === 'qr' && html`<${QrPanel} id=${id} image=${session.qr_image} />`}
      ${!finished && session && html`<button class="danger" onClick=${cancel}>取消登录</button>`}
      ${finished && html`<a class="button" href=${back}>返回</a>`}
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
