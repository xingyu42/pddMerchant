import { abortableSleep, throwIfAborted } from '../../infra/abort.js';
import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { getLogger } from '../../infra/logger.js';

const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 2000];
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export function buildCategorySearchText(resolved) {
  const cats = (resolved?.cates || resolved?.cats || []).filter(Boolean);
  return cats.join(' > ');
}

function normalizeCatIds(catIds) {
  const catId3 = catIds?.catId3 ?? catIds?.catID3 ?? catIds?.catID ?? null;
  const catId1 = catIds?.catId1 ?? catIds?.catID1 ?? null;
  const catId2 = catIds?.catId2 ?? catIds?.catID2 ?? null;
  return { catId1, catId2, catId3 };
}

function formatCategoryResult(data, { catId1, catId2, catId3 }) {
  const resolved = {
    root: data.root,
    cates: data.cates,
    cat_id: Number(catId3),
    cat_ids: [Number(catId1), Number(catId2), Number(catId3), null],
    cats: [data.cates[0] || null, data.cates[1] || null, data.cates[2] || null, null],
  };
  return {
    ...resolved,
    searchText: buildCategorySearchText(resolved),
  };
}

function combineRequestSignal(outerSignal, timeoutSignal) {
  if (!outerSignal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([outerSignal, timeoutSignal]);
  }
  const controller = new AbortController();
  const forward = () => controller.abort();
  if (outerSignal.aborted || timeoutSignal.aborted) {
    controller.abort();
    return controller.signal;
  }
  outerSignal.addEventListener('abort', forward, { once: true });
  timeoutSignal.addEventListener('abort', forward, { once: true });
  return controller.signal;
}

async function fetchAttempt(fetchFn, url, outerSignal) {
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), TIMEOUT_MS);
  const requestSignal = combineRequestSignal(outerSignal, timeoutController.signal);
  try {
    const response = await fetchFn(url, { signal: requestSignal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function createCategoryResolver({
  apiBase,
  fetch: fetchFn = globalThis.fetch,
  sleep = abortableSleep,
  now = Date.now,
  log = getLogger(),
  failureThreshold = DEFAULT_FAILURE_THRESHOLD,
  cooldownMs = DEFAULT_COOLDOWN_MS,
} = {}) {
  let consecutiveFailures = 0;
  let cooldownUntil = 0;

  function assertCircuitClosed() {
    if (consecutiveFailures < failureThreshold) return;
    const remainingMs = cooldownUntil - now();
    if (remainingMs <= 0) return;
    const remainingSec = Math.ceil(remainingMs / 1000);
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `类目 API 熔断中，${remainingSec}s 后重试`,
      hint: '第三方类目服务连续失败，进入冷却期',
      exitCode: ExitCodes.NETWORK,
    });
  }

  function recordFailure() {
    consecutiveFailures += 1;
    if (consecutiveFailures >= failureThreshold) {
      cooldownUntil = now() + cooldownMs;
      log.warn({ consecutiveFailures }, 'category API circuit tripped');
    }
  }

  async function fetchWithRetry(catId3, { signal, baseUrl }) {
    const url = `${baseUrl}/api/v1/crx/PddCate?last_cate_id=${catId3}`;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      throwIfAborted(signal);
      try {
        const body = await fetchAttempt(fetchFn, url, signal);
        consecutiveFailures = 0;
        return body;
      } catch (err) {
        if (signal?.aborted) throwIfAborted(signal);
        log.debug({ attempt, catId3, err: err?.message }, 'category API attempt failed');
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAYS[attempt], signal);
          continue;
        }
        recordFailure();
        throw new PddCliError({
          code: 'E_NETWORK',
          message: `类目 API 请求失败 (${MAX_RETRIES + 1} 次重试后): ${err.message}`,
          hint: '第三方类目服务不可达，稍后重试或手动指定类目',
          exitCode: ExitCodes.NETWORK,
        });
      }
    }
  }

  return Object.freeze({
    async resolve(catIds, { signal, apiBase: callApiBase } = {}) {
      throwIfAborted(signal);
      const normalized = normalizeCatIds(catIds);
      const baseUrl = callApiBase ?? apiBase;
      if (!baseUrl || typeof baseUrl !== 'string') {
        throw new PddCliError({
          code: 'E_CONFIG_INVALID',
          message: '缺少类目服务基础地址 categoryApiBase',
          exitCode: ExitCodes.GENERAL,
        });
      }

      assertCircuitClosed();
      const body = await fetchWithRetry(normalized.catId3, { signal, baseUrl });
      if (body?.code !== 1 || !body?.data) {
        throw new PddCliError({
          code: 'E_BUSINESS',
          message: `类目解析失败 (catId=${normalized.catId3})`,
          hint: '类目 ID 可能无效或第三方服务数据异常',
          exitCode: ExitCodes.BUSINESS,
        });
      }

      return formatCategoryResult(body.data, normalized);
    },
  });
}

export async function resolvePddCategory(catId3, catId1, catId2, { apiBase, runtime, signal } = {}) {
  if (runtime?.mode === 'fixture') return runtime.loadFixture('goods-publish/category.json');
  const resolver = createCategoryResolver({ apiBase });
  const resolved = await resolver.resolve({ catId1, catId2, catId3 }, { signal });
  const { searchText: _searchText, ...legacyShape } = resolved;
  return legacyShape;
}
