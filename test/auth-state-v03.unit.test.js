import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { validateShape } from '../src/adapter/auth-state.js';
import { AUTH_STATE_PATH } from '../src/infra/paths.js';

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
  it('AUTH_STATE_PATH uses the merchant stores default directory', () => {
    assert.ok(AUTH_STATE_PATH.replaceAll('\\', '/').endsWith('data/merchant/stores/default/auth-state.json'));
  });
});
