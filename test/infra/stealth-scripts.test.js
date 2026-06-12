import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { buildStealthScript, DEFAULT_FINGERPRINT_PROFILE } from '../../src/infra/stealth-scripts.js';

describe('stealth-scripts', () => {
  it('DEFAULT_FINGERPRINT_PROFILE has expected structure', () => {
    // DEFAULT_FINGERPRINT_PROFILE 现在是动态生成的（支持确定性指纹种子）
    // 验证其包含必需的字段
    assert.equal(typeof DEFAULT_FINGERPRINT_PROFILE, 'object');
    assert.ok(DEFAULT_FINGERPRINT_PROFILE.locale);
    assert.ok(DEFAULT_FINGERPRINT_PROFILE.timezoneId);
    assert.ok(Array.isArray(DEFAULT_FINGERPRINT_PROFILE.languages));
    assert.ok(DEFAULT_FINGERPRINT_PROFILE.webglVendor);
    assert.ok(DEFAULT_FINGERPRINT_PROFILE.webglRenderer);
    assert.equal(typeof DEFAULT_FINGERPRINT_PROFILE.canvasNoise, 'boolean');
  });

  it('buildStealthScript returns a string', () => {
    const script = buildStealthScript();
    assert.equal(typeof script, 'string');
    assert(script.length > 100);
  });

  it('script contains webdriver override', () => {
    const script = buildStealthScript();
    assert(script.includes('navigator'));
    assert(script.includes('webdriver'));
  });

  it('script contains WebGL vendor/renderer override', () => {
    const script = buildStealthScript();
    assert(script.includes('Intel Inc.'));
    assert(script.includes('Intel Iris OpenGL Engine'));
  });

  it('script contains canvas noise when enabled', () => {
    const script = buildStealthScript({ canvasNoise: true });
    assert(script.includes('toDataURL'));
    assert(script.includes('getImageData'));
  });

  it('script omits canvas noise when disabled', () => {
    const script = buildStealthScript({ canvasNoise: false });
    assert(!script.includes('getImageData'));
  });

  it('respects custom profile values', () => {
    const script = buildStealthScript({
      webglVendor: 'NVIDIA Corporation',
      webglRenderer: 'GeForce RTX 3080',
      languages: ['en-US', 'en'],
    });
    assert(script.includes('NVIDIA Corporation'));
    assert(script.includes('GeForce RTX 3080'));
    assert(script.includes('en-US'));
  });

  it('script is valid JavaScript (no syntax errors)', () => {
    const script = buildStealthScript();
    assert.doesNotThrow(() => new Function(script));
  });
});
