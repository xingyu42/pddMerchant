import { it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { completeShanghaiWindow, rollingSecondsWindow, windowEndingAt, windowEndingYesterday } from '../../src/services/report-windows.js';

it.each(['UTC', 'Asia/Shanghai', 'Pacific/Honolulu'])('keeps calendar windows independent of host TZ=%s', (timezone) => {
  vi.stubEnv('TZ', timezone);
  assert.deepEqual(windowEndingAt(3, '2024-03-01'), { start_date: '2024-02-28', end_date: '2024-03-01', days: 3 });
  assert.deepEqual(windowEndingYesterday(3, Date.parse('2024-03-01T16:00:00Z')),
    { start_date: '2024-02-28', end_date: '2024-03-01', days: 3 });
});

it('keeps Shanghai midnight and yesterday inclusive with the original date-window keys', () => {
  assert.deepEqual(windowEndingYesterday(1, Date.parse('2026-01-01T15:59:59Z')),
    { start_date: '2025-12-31', end_date: '2025-12-31', days: 1 });
  assert.deepEqual(windowEndingYesterday(1, Date.parse('2026-01-01T16:00:00Z')),
    { start_date: '2026-01-01', end_date: '2026-01-01', days: 1 });
});

it('keeps complete-day seconds exclusive at the end with the original profit-window keys', () => {
  const now = Date.parse('2026-01-01T18:00:00Z') / 1000;
  assert.deepEqual(completeShanghaiWindow(2, now), { days: 2,
    start: Date.parse('2025-12-30T16:00:00Z') / 1000, end: Date.parse('2026-01-01T16:00:00Z') / 1000,
    startDate: '2025-12-31', endDate: '2026-01-01' });
});

it('retains rolling second timestamps including the current day', () => {
  assert.deepEqual(rollingSecondsWindow(30, 1793404800999), { startTime: 1790812800, endTime: 1793404800 });
});
