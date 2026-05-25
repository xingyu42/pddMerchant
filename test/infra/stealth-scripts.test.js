import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { buildStealthScript, DEFAULT_FINGERPRINT_PROFILE } from '../../src/infra/stealth-scripts.js';

describe('stealth-scripts', () => {
  it('DEFAULT_FINGERPRINT_PROFILE is frozen', () => {
    assert.throws(() => { DEFAULT_FINGERPRINT_PROFILE.locale = 'en'; });
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
