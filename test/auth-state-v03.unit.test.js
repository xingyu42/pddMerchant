import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateShape, defaultAuthStatePath, legacyAuthStatePath } from '../src/adapter/auth-state.js';
import { platform } from 'node:os';

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
  it('defaultAuthStatePath returns a string', () => {
    const origEnv = process.env.PDD_AUTH_STATE_PATH;
    delete process.env.PDD_AUTH_STATE_PATH;
    try {
      const p = defaultAuthStatePath();
      assert.strictEqual(typeof p, 'string');
      assert.ok(p.length > 0);
      assert.ok(p.includes('pdd-cli'));
    } finally {
      if (origEnv !== undefined) process.env.PDD_AUTH_STATE_PATH = origEnv;
    }
  });

  it('defaultAuthStatePath respects PDD_AUTH_STATE_PATH env', () => {
    const origEnv = process.env.PDD_AUTH_STATE_PATH;
    process.env.PDD_AUTH_STATE_PATH = '/custom/path/auth.json';
    try {
      const p = defaultAuthStatePath();
      assert.strictEqual(p, '/custom/path/auth.json');
    } finally {
      if (origEnv !== undefined) {
        process.env.PDD_AUTH_STATE_PATH = origEnv;
      } else {
        delete process.env.PDD_AUTH_STATE_PATH;
      }
    }
  });

  it('legacyAuthStatePath returns project-local data path', () => {
    const p = legacyAuthStatePath();
    assert.ok(p.includes('data'));
    assert.ok(p.endsWith('auth-state.json'));
  });

  it('platform-specific path structure', () => {
    const origEnv = process.env.PDD_AUTH_STATE_PATH;
    delete process.env.PDD_AUTH_STATE_PATH;
    try {
      const p = defaultAuthStatePath();
      if (platform() === 'win32') {
        assert.ok(p.includes('pdd-cli'), 'Windows path should include pdd-cli');
      } else {
        assert.ok(p.includes('.pdd-cli'), 'POSIX path should include .pdd-cli');
      }
    } finally {
      if (origEnv !== undefined) process.env.PDD_AUTH_STATE_PATH = origEnv;
    }
  });
});
