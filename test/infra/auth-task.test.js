import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { assertAuthTask } from '../../src/infra/auth-task.js';
import { PddCliError, ExitCodes } from '../../src/infra/errors.js';

describe('assertAuthTask', () => {
  it('allows active tasks with no signal or a future deadline', () => {
    assert.doesNotThrow(() => assertAuthTask());
    assert.doesNotThrow(() => assertAuthTask({}));
    assert.doesNotThrow(() => assertAuthTask({ signal: new AbortController().signal, deadlineAt: Date.now() + 5000 }));
  });

  it('throws E_AUTH_TIMEOUT when the deadline has been reached or passed', () => {
    const now = Date.now();
    for (const deadlineAt of [now, now - 10]) {
      assert.throws(() => assertAuthTask({ deadlineAt }), (error) => {
        assert.ok(error instanceof PddCliError);
        assert.equal(error.code, 'E_AUTH_TIMEOUT');
        assert.equal(error.exitCode, ExitCodes.NETWORK);
        return true;
      });
    }
  });

  it('throws sanitized E_AUTH_CANCELLED when the task signal is aborted', () => {
    const controller = new AbortController();
    controller.abort(new Error('sensitive-raw-abort-reason'));
    assert.throws(() => assertAuthTask({ signal: controller.signal, deadlineAt: Date.now() + 5000 }), (error) => {
      assert.ok(error instanceof PddCliError);
      assert.equal(error.code, 'E_AUTH_CANCELLED');
      assert.equal(error.exitCode, ExitCodes.NETWORK);
      assert.equal(JSON.stringify(error).includes('sensitive-raw-abort-reason'), false);
      return true;
    });
  });

  it('preserves E_AUTH_TIMEOUT when the signal abort reason is an auth timeout error', () => {
    const controller = new AbortController();
    controller.abort(new PddCliError({ code: 'E_AUTH_TIMEOUT', exitCode: ExitCodes.NETWORK }));
    assert.throws(() => assertAuthTask({ signal: controller.signal, deadlineAt: Date.now() + 5000 }), (error) => {
      assert.ok(error instanceof PddCliError);
      assert.equal(error.code, 'E_AUTH_TIMEOUT');
      assert.equal(error.exitCode, ExitCodes.NETWORK);
      return true;
    });
  });
});
