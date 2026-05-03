import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseMallId, requireMallId } from '../src/adapter/mall-id.js';
import { cssEscape } from '../src/adapter/css-escape.js';

describe('parseMallId unit', () => {
  it('accepts valid numeric string', () => {
    assert.deepStrictEqual(parseMallId('445301049', { strict: true }), { value: '445301049' });
  });

  it('preserves leading zeros', () => {
    assert.deepStrictEqual(parseMallId('00123', { strict: true }), { value: '00123' });
  });

  it('accepts numeric input via Number', () => {
    const r = parseMallId(445301049, { strict: true });
    assert.strictEqual(r.value, '445301049');
  });

  it('rejects empty string', () => {
    const r = parseMallId('', { strict: true });
    assert.strictEqual(r.value, null);
  });

  it('rejects whitespace-padded in strict mode', () => {
    const r = parseMallId('  123  ', { strict: true });
    assert.strictEqual(r.value, null);
  });

  it('rejects non-digit characters in strict mode', () => {
    assert.strictEqual(parseMallId('abc', { strict: true }).value, null);
    assert.strictEqual(parseMallId('12-34', { strict: true }).value, null);
    assert.strictEqual(parseMallId('12.34', { strict: true }).value, null);
  });

  it('rejects > 15 digits', () => {
    assert.strictEqual(parseMallId('1234567890123456', { strict: true }).value, null);
  });

  it('accepts exactly 15 digits', () => {
    assert.strictEqual(parseMallId('123456789012345', { strict: true }).value, '123456789012345');
  });

  it('rejects negative number', () => {
    assert.strictEqual(parseMallId(-1, { strict: true }).value, null);
  });

  it('rejects NaN', () => {
    assert.strictEqual(parseMallId(NaN, { strict: true }).value, null);
  });

  it('rejects non-safe integer', () => {
    assert.strictEqual(parseMallId(Number.MAX_SAFE_INTEGER + 1, { strict: true }).value, null);
  });

  it('requireMallId throws on invalid', () => {
    assert.throws(() => requireMallId('abc'), (err) => err.code === 'E_USAGE');
  });

  it('requireMallId returns value on valid', () => {
    assert.strictEqual(requireMallId('123'), '123');
  });
});

describe('cssEscape unit', () => {
  it('escapes leading digit', () => {
    const result = cssEscape('123');
    assert.ok(!result.startsWith('1'), 'leading digit should be escaped');
  });

  it('handles plain alphanumeric after first char', () => {
    const result = cssEscape('abc123');
    assert.strictEqual(result, 'abc123');
  });

  it('escapes special characters', () => {
    const result = cssEscape('a.b#c');
    assert.ok(result.includes('\\.'));
    assert.ok(result.includes('\\#'));
  });

  it('escapes null character', () => {
    const result = cssEscape('\0');
    assert.ok(result.includes('�'));
  });

  it('handles empty string', () => {
    assert.strictEqual(cssEscape(''), '');
  });

  it('escapes lone dash', () => {
    const result = cssEscape('-');
    assert.strictEqual(result, '\\-');
  });

  it('handles Unicode characters', () => {
    const result = cssEscape('中文');
    assert.strictEqual(result, '中文');
  });
});
