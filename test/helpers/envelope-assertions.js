import assert from 'node:assert/strict';

export function assertEnvelopeShape(envelope, { ok, command, exitCode, hasData = null, hasError = null } = {}) {
  assert.deepEqual(Object.keys(envelope).sort(), ['command', 'data', 'error', 'meta', 'ok']);
  assert.equal(envelope.meta.v, 2, 'envelope must declare output contract v2');
  if (ok !== undefined) assert.equal(envelope.ok, ok);
  if (command) assert.equal(envelope.command, command);
  if (exitCode !== undefined) assert.equal(envelope.meta.exit_code, exitCode);
  if (hasData !== null) assert.equal(envelope.data !== null, hasData);
  if (hasError !== null) assert.equal(envelope.error !== null, hasError);
}

export function assertRedacted(stdout, sensitiveValues) {
  for (const value of sensitiveValues) {
    assert.equal(stdout.includes(value), false, `stdout should not contain ${value}`);
  }
}
