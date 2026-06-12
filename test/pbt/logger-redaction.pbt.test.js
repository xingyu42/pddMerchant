import { describe, it } from 'vitest';
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

  // 双审收口回归（review-cx.md CX#2 根因）：敏感键值的指纹序列化对环/bigint 必须不抛且确定。
  it('fingerprint: cyclic value under a sensitive key redacts without throwing, deterministically', () => {
    const cyc = { mobile: '13800001111' };
    cyc.self = cyc;
    const redacted = redactRecursive({ anti_content: cyc });
    assert.ok(String(redacted.anti_content).startsWith('fp:'), 'cyclic sensitive value must fingerprint');
    const again = redactRecursive({ anti_content: cyc });
    assert.equal(redacted.anti_content, again.anti_content, 'fingerprint must be deterministic');
    assert.ok(!JSON.stringify(redacted).includes('13800001111'), 'no plaintext leak');
  });

  it('fingerprint: bigint inside a sensitive value redacts without throwing', () => {
    const redacted = redactRecursive({ authorization: { token_id: 10n } });
    assert.ok(String(redacted.authorization).startsWith('fp:'));
  });
});
