import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { redactRecursive, REDACT_KEY_SET } from '../../src/infra/logger.js';

describe('Logger redaction PBT', () => {
  it('PROP-RD-1: no REDACT_KEYS value appears as plaintext in serialized output', () => {
    const sensitiveValue = 'SUPER_SECRET_TOKEN_12345';
    fc.assert(
      fc.property(
        fc.constantFrom(...[...REDACT_KEY_SET]),
        (key) => {
          const obj = { [key]: sensitiveValue, nested: { [key]: sensitiveValue } };
          const redacted = redactRecursive(obj);
          const serialized = JSON.stringify(redacted);
          assert.ok(
            !serialized.includes(sensitiveValue),
            `plaintext leak for key "${key}": ${serialized}`
          );
        }
      ),
      { numRuns: REDACT_KEY_SET.size }
    );
  });

  it('PROP-RD-2: idempotent — 2× redact produces deep-equal results', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...[...REDACT_KEY_SET]),
        fc.string(),
        (key, value) => {
          const obj = { [key]: value, safe: 'keep' };
          const r1 = redactRecursive(obj);
          const r2 = redactRecursive(r1);
          assert.deepStrictEqual(r1, r2);
        }
      ),
      { numRuns: 50 }
    );
  });
});
