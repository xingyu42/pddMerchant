import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { generateFingerprintProfile, buildStealthScript } from '../../src/infra/stealth-scripts.js';

describe('Deterministic Fingerprint', () => {
  it('generates identical fingerprints with same seed', () => {
    const profile1 = generateFingerprintProfile('test-seed-123');
    const profile2 = generateFingerprintProfile('test-seed-123');

    assert.deepEqual(profile1, profile2);
    assert.equal(profile1.canvasNoiseAmount, profile2.canvasNoiseAmount);
    assert.equal(profile1.webglVendor, profile2.webglVendor);
    assert.equal(profile1.webglRenderer, profile2.webglRenderer);
  });

  it('generates different fingerprints with different seeds', () => {
    const profile1 = generateFingerprintProfile('seed-A');
    const profile2 = generateFingerprintProfile('seed-B');

    // 不同种子应生成不同指纹（至少有一个字段不同）
    const diff = profile1.webglVendor !== profile2.webglVendor ||
                 profile1.webglRenderer !== profile2.webglRenderer ||
                 profile1.canvasNoiseAmount !== profile2.canvasNoiseAmount;
    assert.ok(diff, 'Different seeds should produce different fingerprints');
  });

  it('generates random fingerprint when no seed provided', () => {
    const profile = generateFingerprintProfile('');

    assert.equal(profile.canvasNoiseAmount, null); // 随机模式
    assert.equal(profile.webglVendor, 'Intel Inc.'); // 固定值
    assert.equal(profile.webglRenderer, 'Intel Iris OpenGL Engine'); // 固定值
  });

  it('generates random fingerprint when undefined seed', () => {
    const profile = generateFingerprintProfile(undefined);

    assert.equal(profile.canvasNoiseAmount, null);
    assert.equal(profile.canvasNoise, true);
  });

  it('builds valid stealth script with deterministic profile', () => {
    const profile = generateFingerprintProfile('test-seed');
    const script = buildStealthScript(profile);

    assert.ok(script.includes('WebGLRenderingContext'));
    assert.ok(script.includes('HTMLCanvasElement'));
    assert.ok(script.includes(String(profile.canvasNoiseAmount)));
    assert.ok(script.includes(profile.webglVendor));
  });

  it('generates canvasNoiseAmount within valid range', () => {
    const profile = generateFingerprintProfile('test-range-seed');

    assert.ok(profile.canvasNoiseAmount >= 1);
    assert.ok(profile.canvasNoiseAmount <= 5);
    assert.ok(Number.isInteger(profile.canvasNoiseAmount));
  });

  it('generates consistent vendor across multiple calls', () => {
    const vendors = [];
    for (let i = 0; i < 10; i++) {
      const profile = generateFingerprintProfile('consistent-vendor');
      vendors.push(profile.webglVendor);
    }

    const allSame = vendors.every(v => v === vendors[0]);
    assert.ok(allSame, 'Same seed should always produce same vendor');
  });

  it('supports long seed strings', () => {
    const longSeed = 'a'.repeat(1000);
    const profile1 = generateFingerprintProfile(longSeed);
    const profile2 = generateFingerprintProfile(longSeed);

    assert.deepEqual(profile1, profile2);
  });

  it('supports unicode seed strings', () => {
    const unicodeSeed = '商家-12345-测试';
    const profile1 = generateFingerprintProfile(unicodeSeed);
    const profile2 = generateFingerprintProfile(unicodeSeed);

    assert.deepEqual(profile1, profile2);
  });

  it('generates different profiles for mall-specific seeds', () => {
    const mall1 = generateFingerprintProfile('mall-12345');
    const mall2 = generateFingerprintProfile('mall-67890');

    const diff = mall1.webglVendor !== mall2.webglVendor ||
                 mall1.webglRenderer !== mall2.webglRenderer ||
                 mall1.canvasNoiseAmount !== mall2.canvasNoiseAmount;
    assert.ok(diff, 'Different mall IDs should produce different fingerprints');
  });
});
