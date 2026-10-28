import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { cleanupOrphanBrowsers, launchBrowser, listBrowserProcesses } from '../../src/adapter/browser.js';
import { execFileSync } from 'node:child_process';
import { daemonBrowserDbPrefix } from '../../src/infra/daemon-state.js';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));

it('only kills this database browser processes, skips its own pid and swallows individual failures', () => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  const kill = vi.fn((pid) => { if (pid === 23) throw new Error('gone'); });
  const marker = `--pdd-cli-daemon=${daemonBrowserDbPrefix()}-abc`;
  const otherDb = daemonBrowserDbPrefix() === '00000000' ? '11111111' : '00000000';
  const count = cleanupOrphanBrowsers({ kill, listProcesses: () => [
    { pid: 20, commandLine: 'chrome --user-data-dir=normal' },
    { pid: 21, imageName: 'chrome.exe', commandLine: `"C:\\Chrome\\chrome.exe" ${marker}` },
    { pid: process.pid, commandLine: `chrome ${marker}` },
    { pid: 23, commandLine: `chrome ${marker}` },
    { pid: 24, commandLine: `chrome --pdd-cli-daemon=${otherDb}-def` },
    { pid: 26, commandLine: `bash -c 'chrome ${marker}'` },
    { pid: 27, commandLine: `grep ${marker}` },
    { pid: 28, imageName: 'powershell.exe', commandLine: `powershell -Command "chrome ${marker}"` },
    { pid: 29, commandLine: `msedge ${marker}` },
    { pid: 30, commandLine: 'chrome --pdd-cli-daemon=abc' },
    { pid: 31, commandLine: `chrome --other=${marker}` },
    { pid: -1, commandLine: '--pdd-cli-daemon=x' }, { pid: 25, commandLine: null },
  ] });
  assert.equal(count, 1);
  assert.deepEqual(kill.mock.calls, [[21], [23]]);
});

it.each(['chrome', 'chromium', 'chromium-browser', 'headless_shell', 'headless_shell.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium'])(
  'recognizes browser image %s with a database-scoped marker', (imageName) => {
    vi.stubEnv('PDD_TEST_ADAPTER', '');
    const kill = vi.fn();
    const commandLine = `"${imageName}" --pdd-cli-daemon=${daemonBrowserDbPrefix()}-old-owner`;
    assert.equal(cleanupOrphanBrowsers({ kill, listProcesses: () => [{ pid: 21, imageName, commandLine }] }), 1);
    assert.deepEqual(kill.mock.calls, [[21]]);
  });

it('fixture cleanup performs no process listing or kills', () => {
  const listProcesses = vi.fn();
  assert.equal(cleanupOrphanBrowsers({ listProcesses }), 0);
  assert.equal(listProcesses.mock.calls.length, 0);
});

it('swallows enumeration failures', () => {
  vi.stubEnv('PDD_TEST_ADAPTER', '');
  assert.equal(cleanupOrphanBrowsers({ listProcesses: () => { throw new Error('denied'); } }), 0);
});

it('uses hidden powershell CIM enumeration on Windows and handles singleton output', () => {
  execFileSync.mockReturnValueOnce(JSON.stringify({ ProcessId: 101, Name: 'chrome.exe', CommandLine: 'chrome --pdd-cli-daemon=abc' }));
  assert.deepEqual(listBrowserProcesses('win32'), [{ pid: 101, imageName: 'chrome.exe', commandLine: 'chrome --pdd-cli-daemon=abc' }]);
  const [name, args, options] = execFileSync.mock.calls.at(-1);
  assert.equal(name, 'powershell');
  assert.deepEqual(args.slice(0, 2), ['-NoProfile', '-Command']);
  assert.match(args[2], /Get-CimInstance Win32_Process/);
  assert.match(args[2], /ProcessId,Name,CommandLine/);
  assert.equal(options.windowsHide, true);
  // A busy host's full process table can exceed execFileSync's 1 MiB default buffer.
  assert.ok(options.maxBuffer > 1024 * 1024);
  assert.ok(options.timeout > 0);
});

it('parses macOS ps rows without touching unrelated commands', () => {
  execFileSync.mockReturnValueOnce(' 123 chrome --pdd-cli-daemon=abc\n 124 chrome\n');
  execFileSync.mockReturnValueOnce(' 123 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n 124 chrome\n');
  assert.deepEqual(listBrowserProcesses('darwin'), [
    { pid: 123, imageName: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', commandLine: 'chrome --pdd-cli-daemon=abc' },
    { pid: 124, imageName: 'chrome', commandLine: 'chrome' },
  ]);
  assert.deepEqual(listBrowserProcesses('other'), []);
});

it.each(['', 'UPPER', 'a/b', 'a'.repeat(33), 42, null])('rejects invalid ownerTag %s before launching', async (ownerTag) => {
  await assert.rejects(launchBrowser({ ownerTag }), (error) => error.detail.reason === 'invalid_owner_tag');
});
