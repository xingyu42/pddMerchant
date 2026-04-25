import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateShape, legacyAuthStatePath } from '../src/adapter/auth-state.js';

describe('auth-state validateShape', () => {
  it('accepts valid shape', () => {
    assert.strictEqual(validateShape({ cookies: [], origins: [] }), true);
  });

  it('accepts shape with extra fields', () => {
    assert.strictEqual(validateShape({ cookies: [], origins: [], extra: true }), true);
  });

  it('rejects null', () => {
    assert.strictEqual(validateShape(null), false);
  });

  it('rejects non-object', () => {
    assert.strictEqual(validateShape('string'), false);
  });

  it('rejects missing cookies', () => {
    assert.strictEqual(validateShape({ origins: [] }), false);
  });

  it('rejects missing origins', () => {
    assert.strictEqual(validateShape({ cookies: [] }), false);
  });

  it('rejects non-array cookies', () => {
    assert.strictEqual(validateShape({ cookies: 'not-array', origins: [] }), false);
  });

  it('rejects non-array origins', () => {
    assert.strictEqual(validateShape({ cookies: [], origins: {} }), false);
  });

  it('rejects empty object', () => {
    assert.strictEqual(validateShape({}), false);
  });
});

describe('auth-state path resolution', () => {
  it('legacyAuthStatePath returns project-local data path', () => {
    const p = legacyAuthStatePath();
    assert.ok(p.includes('data'));
    assert.ok(p.endsWith('auth-state.json'));
  });
});
