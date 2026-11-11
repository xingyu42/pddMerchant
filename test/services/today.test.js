import { beforeEach, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';
import { createReport, defineReport } from '../../src/services/operating-report.js';
import { collectToday } from '../../src/services/today.js';

const REPORT = defineReport({ days: { min: 1, max: 30, default: 7, message: '天数 {range}', description: '天数' },
  hints: { today_unavailable: '今日实时数据拉取失败' } });
const fail = (code) => new PddCliError({ code, message: '合成失败', exitCode: ExitCodes.GENERAL });

let report;
beforeEach(() => {
  // 上海 2026-11-12 00:30:05，UTC 仍是 11 日
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-11T16:30:05Z'));
  report = createReport({}, REPORT);
});

it('passes the Shanghai date and stamps the CLI fetch time on the collected sources', async () => {
  const collect = vi.fn(async ({ date }) => ({ date }));
  assert.deepEqual(await collectToday(report, collect), { snapshotAt: '2026-11-12 00:30:05',
    sources: { date: '2026-11-12' } });
  assert.deepEqual(report.hints, []);
});

it.each(['E_NETWORK', 'E_BUSINESS', 'E_RATE_LIMIT'])('degrades a typed %s failure to null with the registered hint', async (code) => {
  assert.equal(await collectToday(report, async () => { throw fail(code); }), null);
  assert.deepEqual(report.hints, ['today_unavailable']);
});

it.each(['E_TIMEOUT', 'E_INTERNAL'])('propagates %s', async (code) => {
  await assert.rejects(collectToday(report, async () => { throw fail(code); }), { code });
  assert.deepEqual(report.hints, []);
});

it('propagates program errors', async () => {
  await assert.rejects(collectToday(report, async () => { throw new TypeError('bug'); }), TypeError);
});
