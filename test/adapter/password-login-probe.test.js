import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'vitest';

// Inspect source only: tests and CI must never execute the live experiment.
const source = readFileSync(new URL('../../scripts/experiments/password-login-probe.mjs', import.meta.url), 'utf8');

it('keeps experiment imports restricted to browser, read-only verification and task helpers', () => {
  const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.deepEqual(imports, [
    'node:readline/promises', 'node:stream', 'node:fs/promises', 'node:path', 'node:url',
    '../../src/adapter/browser.js', '../../src/adapter/password-login.js',
    '../../src/adapter/merchant-auth.js', '../../src/adapter/merchant-auth-storage.js',
    '../../src/adapter/auth-state.js', '../../src/infra/abort.js',
    '../../src/infra/timeouts.js', '../../src/infra/paths.js',
  ]);
  assert.match(source, /import \{ verifyMerchantContext \} from/);
  assert.match(source, /import \{ assertAuthTask \} from/);
  assert.doesNotMatch(source, /account-store|secret-box|password-credential|commitMerchantCandidate|saveAuthState|savePasswordCredential/);
  assert.doesNotMatch(source, /\.request\(|\.post\(|\.fetch\(|\.screenshot\(|console\.|error\.message|error\.stack/);
});

it('requires TTY before hidden prompts and accepts no credential argv/env/stdin-pipe options', () => {
  const ttyCheck = source.indexOf('if (!process.stdin.isTTY)');
  const loginPrompt = source.indexOf("await readHidden('Login name (hidden): '");
  assert.ok(ttyCheck >= 0 && ttyCheck < loginPrompt);
  assert.match(source, /new Writable\(\{ write\(chunk, encoding, callback\) \{ callback\(\); \} \}\)/);
  assert.match(source, /output: muted, terminal: true, historySize: 0/);
  assert.match(source, /reader\.question\('', \{ signal \}\)/);
  assert.match(source, /reader\.close\(\)/);
  assert.match(source, /muted\.end\(\)/);
  assert.doesNotMatch(source, /process\.env|--password|--login-name|\.setPrompt\(/);
});

it('bounds attempts to one through three with a default of one and a 60 second interval', () => {
  assert.match(source, /if \(args\.length === 0\) return 1/);
  assert.match(source, /args\.length === 2 && args\[0\] === '--attempts' && \/\^\[1-3\]\$\//);
  assert.match(source, /parseAttempts\(\['--attempts', String\(attempts\)\]\)/);
  assert.match(source, /index < attempts; index\+\+/);
  assert.match(source, /await abortableSleep\(60000, signal\)/);
});

it('launches empty headless sessions and stops immediately for slider or another observed challenge', () => {
  assert.match(source, /launchBrowser\(\{ headed: false, storageState: \{ cookies: \[\], origins: \[\] \} \}\)/);
  assert.match(source, /attemptPasswordLogin\(session\.page, credential, \{ signal, deadlineAt:/);
  assert.match(source, /if \(report\.outcome === 'success' && report\.observation\.challenge\)/);
  assert.match(source, /if \(report\.outcome !== 'success'\) return report/);
  assert.match(source, /challenges\.includes\('slider'\) \? 'slider'/);
  assert.match(source, /if \(challenge === 'slider'\) \{ report\.stopped = 'slider'; break; \}/);
  assert.doesNotMatch(source, /\.click\(|\.press\(|\.dragTo\(/);
});

it('verifies only successful acquisitions and then observes the home page read-only', () => {
  const successGate = source.indexOf("if (report.outcome !== 'success') return report");
  const verification = source.indexOf('() => verifyMerchantContext(session.context,');
  const homeObservation = source.indexOf('() => observeHome(session.page,');
  assert.ok(successGate >= 0 && successGate < verification && verification < homeObservation);
  assert.match(source, /await page\.goto\(PDD_HOME,/);
  assert.match(source, /await inspectPasswordLoginPage\(page, task\)/);
  assert.match(source, /if \(observation\.challenge\) return \{ required: true,/);
  assert.match(source, /report\.verification = \{ verdict:/);
  assert.doesNotMatch(source, /verified\.candidate|verified\.identity|storageState\(\)|cookies\(/);
});

it('stops all further attempts on wrong_password or account_locked and records that outcome', () => {
  const loop = source.slice(source.indexOf('async function runExperiment('), source.indexOf('async function main('));
  assert.match(loop, /report\.attempts\.push\(attempt\);[\s\S]*if \(\['wrong_password', 'account_locked'\]\.includes\(attempt\.outcome\)\) \{\s*report\.stopped = attempt\.outcome;\s*break;\s*\}/);
  assert.ok(loop.indexOf('report.stopped = attempt.outcome') < loop.indexOf("if (challenge === 'slider')"));
});

it('uses Chinese code comments in the reviewed login sources', () => {
  const sources = [source, ...['password-login.js', 'fixtures/auth.js'].map((path) =>
    readFileSync(new URL(`../../src/adapter/${path}`, import.meta.url), 'utf8'))];
  for (const text of sources) assert.doesNotMatch(text, /^\s*\/\/\s*[A-Za-z]/m);
});

it('whitelists report metadata, filters secret-bearing container tokens and writes only an ignored report', () => {
  assert.match(source, /const secrets = \[credential\.loginName, credential\.password\]/);
  assert.match(source, /!secrets\.some\(/);
  assert.match(source, /sms_sent_without_click: observation\.sms_sent \?\? null/);
  assert.match(source, /containers: safeContainers\(observation\.containers, credential\)/);
  assert.match(source, /durations_ms: durations/);
  assert.match(source, /challenge_frequency: \{\}/);
  assert.match(source, /join\(PROJECT_ROOT, 'log'\)/);
  assert.match(source, /password-login-experiment-\$\{Date\.now\(\)\}\.json/);
  assert.equal([...source.matchAll(/await writeFile\(/g)].length, 1);
  assert.match(source, /JSON\.stringify\(report, null, 2\)/);
  assert.match(source, /mode: 0o600, flag: 'wx'/);
});

it('cleans up browser, timer, input and interrupt listeners without printing original failures', () => {
  assert.match(source, /signal\?\.addEventListener\('abort', close, \{ once: true \}\)/);
  assert.match(source, /clearTimeout\(timer\)/);
  assert.match(source, /signal\?\.removeEventListener\('abort', close\)/);
  assert.match(source, /await closeBrowser\(browser\)\.catch/);
  assert.match(source, /credential\.loginName = ''; credential\.password = ''/);
  assert.match(source, /process\.removeListener\('SIGINT', onInterrupt\)/);
  for (const call of source.matchAll(/process\.(?:stdout|stderr)\.write\(([^\n]+)\);/g)) {
    assert.doesNotMatch(call[1], /credential|error|result|verified|observation/);
  }
});
