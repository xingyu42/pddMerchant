# Coding Style Contract

## 1. Scope / Trigger

适用于所有 `bin/`、`src/`、`test/` JavaScript 源码变更，以及脚本、fixtures helper 和新增模块。

## 2. Signatures

项目运行形态：

```text
Node.js >= 18
package.json "type": "module"
No TypeScript
No build step
ESM import/export only
```

推荐函数形态：

```js
export async function doThing(ctx, options) {
  const normalized = normalizeOptions(options);
  return runNextStep(ctx, normalized);
}
```

## 3. Contracts

- Use ESM `import` / `export`; do not add CommonJS `require` unless a local compatibility boundary already owns it。
- Prefer `const`; use `let` only for real reassignment。
- Use `async/await`; avoid `.then()` chains in project code。
- Functions SHOULD stay under 50 lines and nesting SHOULD stay ≤ 3 levels。
- No single-letter variables except conventional loop counters。
- Runtime code MUST use logger/ctx logging, not `console.log`。
- Keep CLI/domain logic out of `bin/pdd.js`; keep raw platform parsing out of commands。

## 4. Validation & Error Matrix

| 条件                                      | 行为                                               |
| ----------------------------------------- | -------------------------------------------------- |
| new file uses CommonJS in ESM path        | refactor to ESM or document compatibility boundary |
| function grows large/nested               | extract pure normalizer/helper in owning layer     |
| command code parses raw endpoint response | move parsing to service/adapter normalizer         |
| runtime `console.log` added               | replace with logger/finalizer/stderr-safe helper   |
| TypeScript/build config introduced        | requires explicit architectural approval           |

## 5. Good/Base/Bad Cases

- Good：small pure normalizer with unit tests, imported by one service owner。
- Base：temporary local helper is acceptable when used once and not a contract owner。
- Bad：copying the same field extraction into three commands; create shared normalizer/projection instead。

## 6. Tests Required

- Pure helpers/normalizers: unit tests with good/base/bad payloads。
- Layer-boundary changes: review import direction manually (the former `test/layering-guard.unit.test.js` was removed in `cc0cb1c`; layering is currently unguarded by tests)。
- Output/logging behavior: command smoke/e2e rather than only unit tests。

## 7. Wrong vs Correct

### Wrong

```js
const run = (ctx) => fetchData(ctx).then((payload) => console.log(payload));
```

### Correct

```js
export async function run(ctx, options) {
  const payload = await fetchData(ctx, options);
  return normalizePayload(payload);
}
```
