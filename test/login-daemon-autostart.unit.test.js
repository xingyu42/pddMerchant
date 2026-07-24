import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import assert from 'node:assert/strict';

const mocks = vi.hoisted(() => ({
  emit: vi.fn((envelope) => envelope),
  ensureDaemonRunning: vi.fn(async () => ({ started: true, pid: 12345 })),
  performHeadedLogin: vi.fn(async () => ({
    path: 'D:/tmp/auth-state.json',
    url: 'https://mms.pinduoduo.com/home',
    mode: 'headed',
  })),
  performQrLogin: vi.fn(async () => ({
    path: 'D:/tmp/auth-state.json',
    url: 'https://mms.pinduoduo.com/home',
    mode: 'qr',
  })),
  warn: vi.fn(),
}));

vi.mock('../src/infra/output.js', async (importOriginal) => ({
  ...(await importOriginal()),
  emit: mocks.emit,
}));

vi.mock('../src/infra/daemon-launcher.js', () => ({
  ensureDaemonRunning: mocks.ensureDaemonRunning,
}));

vi.mock('../src/infra/logger.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getLogger: () => ({ warn: mocks.warn }),
}));

vi.mock('../src/services/auth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  performHeadedLogin: mocks.performHeadedLogin,
  performQrLogin: mocks.performQrLogin,
  renderQrToStream: async () => {},
}));

const { runInteractiveLogin } = await import('../src/commands/init.js');
const { run: runLogin } = await import('../src/commands/login.js');

let originalTestAdapter;

beforeEach(() => {
  originalTestAdapter = process.env.PDD_TEST_ADAPTER;
  delete process.env.PDD_TEST_ADAPTER;
  mocks.emit.mockClear();
  mocks.emit.mockImplementation((envelope) => envelope);
  mocks.ensureDaemonRunning.mockReset();
  mocks.ensureDaemonRunning.mockResolvedValue({ started: true, pid: 12345 });
  mocks.performHeadedLogin.mockReset();
  mocks.performHeadedLogin.mockResolvedValue({
    path: 'D:/tmp/auth-state.json',
    url: 'https://mms.pinduoduo.com/home',
    mode: 'headed',
  });
  mocks.performQrLogin.mockReset();
  mocks.performQrLogin.mockResolvedValue({
    path: 'D:/tmp/auth-state.json',
    url: 'https://mms.pinduoduo.com/home',
    mode: 'qr',
  });
  mocks.warn.mockClear();
});

afterEach(() => {
  if (originalTestAdapter === undefined) delete process.env.PDD_TEST_ADAPTER;
  else process.env.PDD_TEST_ADAPTER = originalTestAdapter;
});

describe('merchant login daemon autostart', () => {
  it('waits for daemon startup after a successful headed login', async () => {
    const envelope = await runInteractiveLogin({ command: 'login', authStatePath: 'D:/tmp/auth-state.json' });

    assert.equal(envelope.ok, true);
    assert.equal(mocks.ensureDaemonRunning.mock.calls.length, 1);
    assert.deepEqual(envelope.meta.warnings, []);
  });

  it('also starts daemon after a successful QR login', async () => {
    const envelope = await runInteractiveLogin({
      command: 'login',
      authStatePath: 'D:/tmp/auth-state.json',
      qr: true,
    });

    assert.equal(envelope.ok, true);
    assert.equal(mocks.performQrLogin.mock.calls.length, 1);
    assert.equal(mocks.ensureDaemonRunning.mock.calls.length, 1);
  });

  it('does not warn or start another daemon when one is already running', async () => {
    mocks.ensureDaemonRunning.mockResolvedValueOnce({ started: false, pid: 12345 });

    const envelope = await runInteractiveLogin({ command: 'login', authStatePath: 'D:/tmp/auth-state.json' });

    assert.equal(envelope.ok, true);
    assert.equal(mocks.ensureDaemonRunning.mock.calls.length, 1);
    assert.deepEqual(envelope.meta.warnings, []);
  });

  it('keeps login successful with a stable warning when daemon startup is unconfirmed', async () => {
    mocks.ensureDaemonRunning.mockResolvedValueOnce({ started: true, pid: 12345, confirmed: false });

    const envelope = await runInteractiveLogin({ command: 'login', authStatePath: 'D:/tmp/auth-state.json' });

    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.meta.warnings, ['daemon_start_unconfirmed']);
  });

  it('keeps login successful and redacts daemon startup exceptions', async () => {
    mocks.ensureDaemonRunning.mockRejectedValueOnce(new Error('secret auth path D:/private/auth-state.json'));

    const envelope = await runInteractiveLogin({ command: 'login', authStatePath: 'D:/tmp/auth-state.json' });

    assert.equal(envelope.ok, true);
    assert.deepEqual(envelope.meta.warnings, ['daemon_start_failed']);
    assert.deepEqual(mocks.warn.mock.calls[0][0], { code: null });
    assert.equal(JSON.stringify(envelope).includes('secret auth path'), false);
  });

  it('does not start daemon when merchant login fails', async () => {
    mocks.performHeadedLogin.mockRejectedValueOnce(new Error('login failed'));

    const envelope = await runInteractiveLogin({ command: 'login', authStatePath: 'D:/tmp/auth-state.json' });

    assert.equal(envelope.ok, false);
    assert.equal(mocks.ensureDaemonRunning.mock.calls.length, 0);
  });

  it('does not start the merchant daemon for consumer login', async () => {
    process.env.PDD_TEST_ADAPTER = 'fixture';

    const envelope = await runLogin({ consumer: true, qr: true, json: true }, {
      runtimeConfig: { consumerLoginUrl: 'https://mobile.yangkeduo.com/login.html' },
    });

    assert.equal(envelope.ok, true);
    assert.equal(mocks.ensureDaemonRunning.mock.calls.length, 0);
  });
});
