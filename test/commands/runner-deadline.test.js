import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { armDeadline } from '../../src/commands/runner/single-lifecycle.js';

it('pauses the command budget, resumes its remainder and disposes the latest timer', async () => {
  vi.useFakeTimers();
  const deadline = armDeadline({ timeoutMs: 1000 }, null, Date.now());
  await vi.advanceTimersByTimeAsync(200);
  deadline.pause();
  deadline.pause();
  assert.equal(deadline.deadlineAt, null);
  await vi.advanceTimersByTimeAsync(90000);
  assert.equal(deadline.signal.aborted, false);
  deadline.resume();
  const resumedAt = deadline.deadlineAt;
  deadline.resume();
  assert.equal(deadline.deadlineAt, resumedAt);
  await vi.advanceTimersByTimeAsync(799);
  assert.equal(deadline.signal.aborted, false);
  await vi.advanceTimersByTimeAsync(1);
  assert.equal(deadline.signal.aborted, true);
  deadline.dispose();
  assert.equal(vi.getTimerCount(), 0);
});

it('preserves parent cancellation while the command timer is paused', () => {
  vi.useFakeTimers();
  const parent = new AbortController();
  const deadline = armDeadline({ timeoutMs: 1000 }, parent.signal, Date.now());
  deadline.pause();
  parent.abort();
  assert.equal(deadline.signal.aborted, true);
  deadline.resume();
  deadline.dispose();
  assert.equal(vi.getTimerCount(), 0);
});

it('keeps pause/resume as no-ops without an explicit command timeout', () => {
  vi.useFakeTimers();
  const deadline = armDeadline({}, null, Date.now());
  deadline.pause();
  deadline.resume();
  assert.equal(deadline.deadlineAt, null);
  assert.equal(vi.getTimerCount(), 0);
  deadline.dispose();
});

it('rejects a pause after the command deadline even before its timer callback runs', () => {
  vi.useFakeTimers();
  const startedAt = Date.now();
  const deadline = armDeadline({ timeoutMs: 100 }, null, startedAt);
  vi.setSystemTime(startedAt + 101);
  assert.throws(() => deadline.pause(), { code: 'E_TIMEOUT' });
  deadline.dispose();
});
