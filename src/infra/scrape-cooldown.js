// 消费端选品抓取的「IP/会话软封识别 + 持久长冷却退避」。
// 冷却计数与截止时间落盘（默认 data/scrape-cooldown.json），由命令运行时组合根按实例注入。

import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { SCRAPE_COOLDOWN_PATH } from './paths.js';
import { getLogger } from './logger.js';
import { scrapeCooldownActive } from './errors.js';

function warn(obj, msg) {
  try { getLogger().warn(obj, msg); } catch { /* logger 不可用时静默 */ }
}

/**
 * @param {object} [opts]
 * @param {() => number} [opts.now] 时钟注入（测试用）
 * @param {string|null} [opts.statePath] 落盘路径；传 null/'' → 纯内存模式（测试用，不碰磁盘）
 * @param {number} [opts.threshold] 触发冷却的连续软封阈值
 * @param {number} [opts.cooldownMs] 冷却时长（毫秒）
 */
export function createScrapeCooldown({
  now = Date.now,
  statePath = SCRAPE_COOLDOWN_PATH,
  threshold,
  cooldownMs,
} = {}) {
  if (!Number.isInteger(threshold) || threshold <= 0) {
    throw new TypeError('threshold must be a positive integer');
  }
  if (!Number.isFinite(cooldownMs) || cooldownMs <= 0) {
    throw new TypeError('cooldownMs must be a positive number');
  }
  let state = { consecutiveSoftBlock: 0, cooldownUntil: 0 };

  // 从磁盘读取最新状态到内存。check/record 前均重读，以感知其它进程写入的冷却
  // （缓解跨进程 stale singleton）；文件缺失/损坏 → 归零容错。
  function load() {
    if (!statePath) return;
    try {
      const parsed = JSON.parse(readFileSync(statePath, 'utf8'));
      const c = parsed?.consecutiveSoftBlock;
      const u = parsed?.cooldownUntil;
      state = {
        consecutiveSoftBlock: Number.isInteger(c) && c >= 0 ? c : 0,
        cooldownUntil: Number.isFinite(u) && u >= 0 ? u : 0,
      };
    } catch { /* missing/corrupt → zeroed */ }
  }

  // 原子落盘：每进程独立临时文件 + rename。临时名带 pid，
  // 避免并发 CLI 互写同一 .tmp 引发半截/ENOENT（review Warning#3）。仍未加文件锁；
  // 并发 read-modify-write 的丢失更新至多轻微延后冷却，对"退避"语义可接受（非精确计数器）。
  function persist() {
    if (!statePath) return;
    const tmp = `${statePath}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(statePath), { recursive: true });
      writeFileSync(tmp, JSON.stringify(state), 'utf8');
      renameSync(tmp, statePath);
    } catch (err) {
      warn({ err: err?.message, statePath }, 'scrape-cooldown: persist failed');
      try { rmSync(tmp, { force: true }); } catch { /* best-effort tmp cleanup */ }
    }
  }

  load(); // 构造时读一次

  return {
    /** 冷却期内抛 E_RATE_LIMIT 短路退避；否则放行。 */
    check() {
      load();
      const remaining = state.cooldownUntil - now();
      if (remaining > 0) {
        throw scrapeCooldownActive(remaining, { consecutive_soft_block: state.consecutiveSoftBlock });
      }
    },

    /** 记录一次软封；达阈值则进入冷却并落盘。返回本次结果用于补充错误 detail。 */
    recordSoftBlock(signal = {}) {
      load();
      state.consecutiveSoftBlock += 1;
      let cooldownTriggered = false;
      if (state.consecutiveSoftBlock >= threshold) {
        state.cooldownUntil = now() + cooldownMs;
        cooldownTriggered = true;
        warn(
          { consecutiveSoftBlock: state.consecutiveSoftBlock, cooldownMs, reason: signal?.reason },
          'scrape-cooldown: IP 软封冷却已触发，后续抓取将短路退避',
        );
      }
      persist();
      return {
        cooldownTriggered,
        cooldownUntil: state.cooldownUntil,
        cooldownRemainingMs: Math.max(0, state.cooldownUntil - now()),
        consecutiveSoftBlock: state.consecutiveSoftBlock,
      };
    },

    /** 成功拿到真实数据 → 清零计数与冷却。 */
    recordSuccess() {
      load();
      if (state.consecutiveSoftBlock !== 0 || state.cooldownUntil !== 0) {
        state = { consecutiveSoftBlock: 0, cooldownUntil: 0 };
        persist();
      }
    },

    status() {
      load();
      return {
        consecutiveSoftBlock: state.consecutiveSoftBlock,
        cooldownUntil: state.cooldownUntil,
        cooldownRemainingMs: Math.max(0, state.cooldownUntil - now()),
      };
    },

    _reset() {
      state = { consecutiveSoftBlock: 0, cooldownUntil: 0 };
      persist();
    },
  };
}
