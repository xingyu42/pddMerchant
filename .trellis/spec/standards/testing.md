# Testing Contract

## 1. Scope / Trigger

适用于新增/修改测试、选择验证范围、调整 fixture adapter、e2e 子进程或跨层契约。

## 2. Signatures

常用命令：

```bash
npm test
npx vitest run test/<file>.test.js
npx vitest
```

测试环境：

```text
PDD_TEST_ADAPTER=fixture        bypass real browser/backend
PDD_TEST_FIXTURE_DIR=<path>     override fixture data
```

## 3. Contracts

- Framework is Vitest with `assert/strict`; tests auto-discover `test/**/*.test.js`。
- Fixture adapter is the default seam for command/e2e tests; do not require real PDD account for automated tests。
- E2E tests SHOULD spawn child processes when verifying CLI stdout/exit code/envelope purity。
- Every test (in-process and subprocess) MUST use its own temporary `PDD_DB_PATH`; the master key lives beside it, so one variable isolates both. `test/setup.js` opens a fresh temp DB per test and closes it in `afterEach`. `PDD_PROFILE_DIR` does not isolate account resolution. Use fixture mode so tests never navigate with a real local account; fixture `login` still writes fake merchant/consumer accounts into the DB.
- There is currently no property-based testing: the former `test/pbt/` harness was removed in `cc0cb1c` and the unused `fast-check` devDependency was dropped afterwards. Reintroducing PBT is a dependency decision (see `dependencies.md`)。
- `npm run check` is the project gate: `npm run lint` (knip `--include files,dependencies,unlisted,binaries,exports,types,duplicates`) then `npm test`; `.github/workflows/check.yml` runs it on pushes to `main` and on PRs. An export with no importer in `src/`, `bin/` or `test/**/*.test.js` fails lint; registries reach command handlers through static named references so knip can see them, and any intentional seam is allowlisted in `knip.json` with a reason。
- There is no build step; do not report build success unless one was actually added and run。
- Output contract v2 guard `test/contract/data-contract-v2.test.js`:
  - discovers every registered command by running all `src/commands/registry/*.js` registrars with a stub `wireAction`;
  - every command MUST appear in `V2_CASES` (fixture subprocess via `runCli`) or `UNIT_COVERED` (command → in-process test file that must exist and mention the command; used for `config.set` / `config.unset` because a subprocess would write the repo's `config/config.json`); `PENDING_COMMANDS` MUST stay empty;
  - each case asserts `assertDataContractV2(data, { freeKeyPaths, entityFields })` from `test/helpers/data-contract.js`: data is an object, non-empty string `headline`, snake_case keys at every depth, numeric money-word keys end with `_yuan` (or `_pct`), numeric `rate|ctr` keys end with `_pct`; every emitted hint is a non-empty Chinese string (shop aggregate `{ dimension, message }` hints preserve their shape and validate `message`);
  - `freeKeyPaths` lists free-form key maps whose own keys skip the key rules (e.g. `status_distribution` keyed by Chinese status, `config.show` `fields` keyed by config names, batch `accounts` keyed by slug); children are addressed as `<path>.*`, array elements as `[]`;
  - `entityFields` maps a path (`items[]`, `order`, `detail.stale_sample[]`, `''` for the root) to a view whitelist (`*_VIEW_FIELDS`); key sets must be equal, and a declared path that never occurs is itself a violation (no vacuous pass).
- Adding a command: add a `V2_CASES` entry (or justified `UNIT_COVERED`) and a `node bin/pdd.js <command>` line in `skills/pdd-cli/SKILL.md` in the same change, otherwise the guards fail。
- Command docs guard `test/contract/command-docs.test.js`: every registered command (shared discovery in `test/helpers/registered-commands.js`) appears in a `node bin/pdd.js …` line of `skills/pdd-cli/SKILL.md` (`a|b` groups expand), and that skill documents only registered commands。
- Steering doc path guard `test/contract/doc-paths.test.js`: backticked repo paths in `AGENTS.md`、`CLAUDE.md`、`CODING_STANDARDS.md` and `.agents/skills/pdd-*/SKILL.md` must exist; placeholders (`<>`、`*`、`{}`、`|`) are skipped。
- `runCli(args, { fixtures, authInvalid, authIndeterminate, authState, accounts = [DEFAULT_ACCOUNT], authStates })` (`test/helpers/isolated-cli.js`) creates a temp sandbox (`createCliSandbox()`), seeds its DB with `seedDb(dbPath, { accounts, authStates })` (`test/helpers/seed-db.js`, ciphertext sealed with the sandbox master key) and then spawns the CLI; `--all-accounts` needs no special handling. `assertEnvelopeShape` asserts `meta.v === 2`。
- Layer boundaries are not test-guarded: the former `test/layering-guard.unit.test.js` was removed in `cc0cb1c`; review imports manually。

## 4. Validation & Error Matrix

| 改动类型                                 | 最小测试                                                  |
| ---------------------------------------- | --------------------------------------------------------- |
| command flags/registration               | command smoke/e2e with `--json` + `data-contract-v2` case |
| command `data` shape / views             | view unit tests + `data-contract-v2` case with `entityFields` |
| service normalizer/business logic        | targeted unit + fixture e2e if command-visible            |
| adapter endpoint/business error          | adapter unit + fixture endpoint e2e                       |
| runner/envelope/errors/output            | runner/output/error tests + smoke; prefer `npm test`      |
| infra env/path/logging                   | unit tests for default/override/invalid + redaction tests |
| auth/doctor CLI subprocess               | fixture mode + temporary `PDD_DB_PATH` seeded via `seedDb` |
| storage (db/leases/master-key/account-store) | `test/infra/*.test.js` + `test/e2e/sqlite-auth-storage.e2e.test.js` |
| parser accepting broad external payloads | unit good/base/bad with representative edge-case tables    |

## 5. Good/Base/Bad Cases

- Good：bug fix adds a regression test that fails before the fix and asserts envelope/exit code if user-visible。
- Base：small docs-only spec migration can be verified by file review and git diff; no runtime tests needed。
- Bad：only testing service return value for a command output bug; e2e should parse stdout envelope。

## 6. Tests Required

- Always run targeted tests for touched domain when code changes。
- Run `npm test` for shared contracts: `_runner.js`、adapter transport、auth/mall、envelope/errors、layering。
- Before finishing, inspect git diff and ensure no secrets or generated noise are included.

## 7. Wrong vs Correct

### Wrong

```bash
npm run lint
# then claim the CLI contract is verified
```

### Correct

```bash
PDD_TEST_ADAPTER=fixture npx vitest run test/e2e/business-contract.e2e.test.js
# assert stdout is one envelope and exit code is expected
```

## 8. Real Examples

### CLI subprocess pattern（current suites prefer `runCli` from `test/helpers/isolated-cli.js`）

```js
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const BIN = join(__dirname, '..', 'bin', 'pdd.js');

function runPdd(args) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

test('pdd orders detail (missing --sn) exits 2 (USAGE)', () => {
  const result = runPdd(['orders', 'detail']);
  assert.equal(result.status, 2);
});
```

For doctor/auth subprocesses, create a fresh temp directory and point every auth/account path into it before spawning; remove it in `finally`.

### Unit test — service validator pattern

```js
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { validateGoodsId } from '../src/services/goods.js';

describe('validateGoodsId', () => {
  it('accepts valid positive integer', () => {
    assert.equal(validateGoodsId(1001), 1001);
  });
  it('rejects null/undefined/empty', () => {
    for (const val of [null, undefined, '']) {
      assert.throws(() => validateGoodsId(val), (e) => e.code === 'E_USAGE');
    }
  });
});
```
