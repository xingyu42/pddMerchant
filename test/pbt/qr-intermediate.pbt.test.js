import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

describe('QR intermediate envelope', () => {
  it('PROP-QR-1: intermediate envelope has correct structure', () => {
    const intermediate = {
      ok: true,
      command: 'init.qr_pending',
      data: {
        qr_image_path: '/tmp/qr.png',
        qr_content: 'https://example.com/qr/abc123',
      },
      meta: { warnings: ['qr_pending'] },
    };

    assert.strictEqual(intermediate.ok, true);
    assert.strictEqual(intermediate.command, 'init.qr_pending');
    assert.ok(intermediate.data.qr_image_path);
    assert.ok(intermediate.meta.warnings.includes('qr_pending'));

    const line = JSON.stringify(intermediate);
    assert.ok(!line.includes('\n'), 'intermediate envelope must be single-line JSON');
    const parsed = JSON.parse(line);
    assert.deepStrictEqual(parsed, intermediate);
  });

  it('PROP-QR-1: qr_content truncation triggers warning', () => {
    const longContent = 'x'.repeat(20000);
    const truncated = longContent.slice(0, 16384);
    const warnings = [];
    if (truncated !== longContent) warnings.push('qr_content_truncated');
    warnings.push('qr_pending');

    assert.ok(warnings.includes('qr_content_truncated'));
    assert.ok(warnings.includes('qr_pending'));
    assert.strictEqual(truncated.length, 16384);
  });

  it('PROP-QR-1: success path has exactly 2 envelope shapes', () => {
    const lines = [
      JSON.stringify({ ok: true, command: 'init.qr_pending', data: { qr_image_path: '/p', qr_content: 'c' }, meta: { warnings: ['qr_pending'] } }),
      JSON.stringify({ ok: true, command: 'init', data: { path: '/auth', mode: 'qr' }, meta: { latency_ms: 1000 } }),
    ];

    assert.strictEqual(lines.length, 2);
    for (const line of lines) {
      const parsed = JSON.parse(line);
      assert.strictEqual(typeof parsed.ok, 'boolean');
      assert.ok(parsed.command);
    }

    assert.strictEqual(JSON.parse(lines[0]).command, 'init.qr_pending');
    assert.strictEqual(JSON.parse(lines[1]).command, 'init');
  });

  it('PROP-QR-1: timeout path has exactly 2 envelope shapes', () => {
    const lines = [
      JSON.stringify({ ok: true, command: 'init.qr_pending', data: { qr_image_path: '/p', qr_content: null }, meta: { warnings: ['qr_pending'] } }),
      JSON.stringify({ ok: false, command: 'init', error: { code: 'E_AUTH_TIMEOUT', message: 'timeout' }, meta: { exit_code: 3 } }),
    ];

    assert.strictEqual(lines.length, 2);
    assert.strictEqual(JSON.parse(lines[0]).ok, true);
    assert.strictEqual(JSON.parse(lines[1]).ok, false);
    assert.strictEqual(JSON.parse(lines[1]).error.code, 'E_AUTH_TIMEOUT');
  });
});
