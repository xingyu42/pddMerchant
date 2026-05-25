import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { transformImages } from '../../src/services/image-transform.js';

const FIXTURE = 'test/fixtures/goods-publish/test-image.png';

describe('image-transform', () => {
  let lastResult = null;

  afterEach(() => {
    if (lastResult?.cleanup) lastResult.cleanup();
    lastResult = null;
  });

  it('transforms a single image', async () => {
    lastResult = await transformImages([FIXTURE], { random: () => 0.5 });
    assert.equal(lastResult.filePaths.length, 1);
    assert(existsSync(lastResult.filePaths[0]));
    assert.equal(lastResult.stats.length, 1);
    assert.equal(lastResult.warnings.length, 0);
  });

  it('output is JPEG format', async () => {
    lastResult = await transformImages([FIXTURE], { random: () => 0.5 });
    assert(lastResult.filePaths[0].endsWith('.jpg'));
  });

  it('output file size differs from input', async () => {
    lastResult = await transformImages([FIXTURE], { random: () => 0.5 });
    const inputSize = statSync(FIXTURE).size;
    const outputSize = statSync(lastResult.filePaths[0]).size;
    assert.notEqual(inputSize, outputSize);
  });

  it('handles multiple images', async () => {
    lastResult = await transformImages([FIXTURE, FIXTURE], { random: () => 0.3 });
    assert.equal(lastResult.filePaths.length, 2);
    assert.equal(lastResult.stats.length, 2);
  });

  it('falls back to original on transform error', async () => {
    lastResult = await transformImages(['/nonexistent/image.png'], { random: () => 0.5 });
    assert.equal(lastResult.filePaths.length, 1);
    assert.equal(lastResult.filePaths[0], '/nonexistent/image.png');
    assert(lastResult.warnings.length > 0);
    assert(lastResult.warnings[0].includes('image_transform_failed'));
  });

  it('cleanup removes temp directory', async () => {
    lastResult = await transformImages([FIXTURE], { random: () => 0.5 });
    const tmpDir = lastResult.tmpDir;
    assert(existsSync(tmpDir));
    lastResult.cleanup();
    assert(!existsSync(tmpDir));
    lastResult = null;
  });

  it('stats include transform parameters', async () => {
    lastResult = await transformImages([FIXTURE], { random: () => 0.5 });
    const stat = lastResult.stats[0];
    assert(typeof stat.cropPct === 'number');
    assert(typeof stat.brightnessShift === 'number');
    assert(typeof stat.jpegQuality === 'number');
  });

  it('respects seeded random for reproducibility', async () => {
    let callCount = 0;
    const seeded = () => { callCount++; return 0.42; };
    lastResult = await transformImages([FIXTURE], { random: seeded });
    assert(callCount > 0);
  });
});
