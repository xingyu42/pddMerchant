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

  // codex R2 终审收口：orders.detail 形状的收件人 PII 别名必须被脱敏（粗粒度地理字段保持可见）
  it('order-detail receiver PII aliases are redacted', () => {
    const order = {
      buyer_address: {
        receiver_name: '张三',
        receiver_phone: '13800001111',
        receiver_address: '幸福街 1 号',
        receiver_city: '杭州市',
      },
      receiverPhone: '13900002222',
      receiverAddress: 'X 路 2 号',
    };
    const redacted = redactRecursive(order);
    assert.ok(String(redacted.buyer_address.receiver_phone).startsWith('fp:'));
    assert.ok(String(redacted.buyer_address.receiver_address).startsWith('fp:'));
    assert.ok(String(redacted.receiverPhone).startsWith('fp:'));
    assert.ok(String(redacted.receiverAddress).startsWith('fp:'));
    assert.equal(redacted.buyer_address.receiver_city, '杭州市', 'coarse geo stays visible');
    const serialized = JSON.stringify(redacted);
    for (const pii of ['13800001111', '13900002222', '幸福街 1 号', 'X 路 2 号']) {
      assert.ok(!serialized.includes(pii), `PII must not survive: ${pii}`);
    }
  });
});
