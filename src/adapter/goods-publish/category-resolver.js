import { PddCliError, ExitCodes } from '../../infra/errors.js';
import { isMockEnabled, loadFixture } from '../mock-dispatcher.js';
import { getLogger } from '../../infra/logger.js';

const CATEGORY_API_BASE = process.env.PDD_CATEGORY_API_BASE || 'https://api.gj.dangxun.com';
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 2;
const RETRY_DELAYS = [1000, 2000];

let consecutiveFailures = 0;
let cooldownUntil = 0;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 5 * 60 * 1000;

function checkCategoryCircuit() {
  if (consecutiveFailures >= FAILURE_THRESHOLD && Date.now() < cooldownUntil) {
    const remaining = Math.ceil((cooldownUntil - Date.now()) / 1000);
    throw new PddCliError({
      code: 'E_NETWORK',
      message: `类目 API 熔断中，${remaining}s 后重试`,
      hint: '第三方类目服务连续失败，进入冷却期',
      exitCode: ExitCodes.NETWORK,
    });
  }
}

async function fetchCategoryWithRetry(catId3, log) {
  const url = `${CATEGORY_API_BASE}/api/v1/crx/PddCate?last_cate_id=${catId3}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const body = await response.json();
      consecutiveFailures = 0;
      return body;
    } catch (err) {
      log.debug({ attempt, catId3, err: err?.message }, 'category API attempt failed');
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
        continue;
      }
      consecutiveFailures++;
      if (consecutiveFailures >= FAILURE_THRESHOLD) {
        cooldownUntil = Date.now() + COOLDOWN_MS;
        log.warn({ consecutiveFailures }, 'category API circuit tripped');
      }
      throw new PddCliError({
        code: 'E_NETWORK',
        message: `类目 API 请求失败 (${MAX_RETRIES + 1} 次重试后): ${err.message}`,
        hint: '第三方类目服务不可达，稍后重试或手动指定类目',
        exitCode: ExitCodes.NETWORK,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function resolvePddCategory(catId3, catId1, catId2) {
  if (isMockEnabled()) return loadFixture('goods-publish/category.json');

  const log = getLogger();
  checkCategoryCircuit();

  const body = await fetchCategoryWithRetry(catId3, log);

  if (body.code !== 1 || !body.data) {
    throw new PddCliError({
      code: 'E_BUSINESS',
      message: `类目解析失败 (catId=${catId3})`,
      hint: '类目 ID 可能无效或第三方服务数据异常',
      exitCode: ExitCodes.BUSINESS,
    });
  }

  const data = body.data;
  return {
    root: data.root,
    cates: data.cates,
    cat_id: Number(catId3),
    cat_ids: [Number(catId1), Number(catId2), Number(catId3), null],
    cats: [data.cates[0] || null, data.cates[1] || null, data.cates[2] || null, null],
  };
}

export function buildCategorySearchText(resolved) {
  const cats = (resolved.cates || resolved.cats || []).filter(Boolean);
  return cats.join(' > ');
}

export function _resetCategoryCircuit() {
  consecutiveFailures = 0;
  cooldownUntil = 0;
}
