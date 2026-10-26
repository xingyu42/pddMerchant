# Dependency Policy Contract

## 1. Scope / Trigger

适用于修改 `package.json`、`package-lock.json`、引入 npm 包、Playwright 生态依赖或新增运行时/开发工具。

## 2. Signatures

依赖准入层级：

```text
devDependencies        generally free after relevance check
Playwright ecosystem   review-only; affects browser/runtime integration
new domain runtime dep evaluate maintenance, size, alternatives, security
deprecated/vulnerable  blocked unless explicit remediation plan exists
```

安装命令：

```bash
npm install <package>
npm install -D <package>
```

当前核心运行时依赖（package.json）：

```text
commander  CLI parsing
patchright  Chromium automation with a Playwright-compatible API
pino       structured logging
sharp      image processing
zod        runtime configuration validation
```

当前核心 devDependencies：

```text
vitest                test framework
@vitest/coverage-v8   coverage provider
knip                  unused-code analysis
```

## 3. Contracts

- Prefer built-in Node.js APIs and existing project helpers before adding dependencies。
- Do not invent dependency versions; use package manager resolution unless a specific compatible version is required and justified。
- New runtime dependencies MUST justify maintenance status、package size、security posture and simpler alternatives。
- Patchright/Playwright-compatible ecosystem changes require review because they can affect fingerprinting、browser launch、XHR capture and tests。
- Deprecated or known vulnerable packages are blocked unless the change is explicitly about containment/removal。

## 4. Validation & Error Matrix

| 条件                                         | 行为                                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| dev-only test helper                         | may add to devDependencies with targeted tests                     |
| small runtime helper duplicating native API  | reject; use Node.js/project helper                                 |
| package affects browser automation           | review adapter/auth/fingerprint implications and run adapter tests |
| package has active vulnerability/deprecation | do not add; find alternative                                       |
| lockfile changes unexpectedly broad          | inspect diff and explain why before finishing                      |

## 5. Good/Base/Bad Cases

- Good：cover a parser invariant with a table of representative edge cases using Vitest; only add a PBT library when shrinking/complex generators add concrete value。
- Base：dev dependency for test-only tooling is acceptable when it does not affect CLI runtime。
- Bad：adding a large scraping/browser dependency when Playwright integration already owns that boundary。

## 6. Tests Required

- Run targeted tests that exercise the dependency integration path。
- For browser/adapter deps, run fixture tests and any non-network unit tests for launch/config code。
- For package changes, inspect `package-lock.json` for transitive risk or unexpected major churn。

## 7. Wrong vs Correct

### Wrong

```js
import leftPad from 'left-pad';
```

### Correct

```js
const padded = String(value).padStart(width, '0');
```
