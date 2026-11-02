# 上货抓取商品数据缓存 - 实施计划

## 1. 实现步骤

- [x] 在 `src/infra/paths.js` 增加 `tmp/goods-publish-source-cache` 路径常量，不新增环境变量。
- [x] 新增 `src/services/goods-publish-source-cache.js`：数字键校验、字段白名单、版本化读取、当前数据校验、原子写入、按商品删除和临时文件清理。
- [x] 在 `src/services/goods-publish.js` 接入缓存：fixture 绕过；命中早于冷却/代理；未命中实时抓取；抓取成功后 best-effort 写入；后续失败保留；整次上货成功后 best-effort 删除；支持 `ctx.sourceGoodsCache` 测试注入。
- [x] 更新 `.trellis/spec/services/goods-publish.md` 的可执行缓存契约；如默认路径清单需要同步，再窄幅更新 infra path spec。

## 2. 测试步骤

- [x] 新增缓存模块单元测试：miss、write/read round-trip、白名单、诊断字段剥离、损坏 JSON、版本/ID 不匹配、无效价格/SKU、覆盖旧缓存和按商品删除。
- [x] 扩充 goods-publish service 单元测试：命中绕过 cooldown/代理/消费者抓取；未命中写入；读取失败回退；写入失败不中断；后续失败保留；草稿/提交成功清理；清理失败只产生 warning。
- [x] 验证 fixture 模式不读写缓存，且 `--json` 仍只有一个 envelope。

## 3. 验证命令

```powershell
npx vitest run test/goods-publish-source-cache.unit.test.js
npx vitest run test/goods-publish.unit.test.js test/adapter/source-scraper.soft-risk.test.js
npx vitest run test/json-purity.test.js
npm test
git diff --check
git diff -- src/infra/paths.js src/services/goods-publish-source-cache.js src/services/goods-publish.js test/goods-publish-source-cache.unit.test.js test/goods-publish.unit.test.js .trellis/spec/services/goods-publish.md
```

## 4. 风险与回滚点

- `src/services/goods-publish.js` 已有未提交的青果代理修改；只在源数据取得位置做局部编辑，每步先检查 diff，禁止覆盖现有块。
- `test/goods-publish.unit.test.js` 与 `skills/pdd-cli/SKILL.md` 也已修改；只追加本功能必要内容，不格式化整文件。
- 首个回滚点：缓存模块及其独立测试完成，尚未接入 service。
- 第二个回滚点：service 接入完成后，可单独撤回 service 小块而不触碰 adapter。
- 不执行真实上货或 `--confirm` 生产写入；验证使用单元/fixture 测试。

## 5. 验证结果

- 缓存、goods-publish、软风控、PBT、分层与 JSON purity 针对性验证：6 个文件、87 个测试全部通过。
- fixture CLI smoke：`goods.publish` 返回单行成功 envelope，执行前后 `tmp/goods-publish-source-cache` 均不存在。
- `npm run lint` 成功执行，但脚本仅输出 `no-lint`，不代表真实 lint 覆盖；仓库没有 type-check/build 命令。
- 完整 `npm test`：128 个文件中 127 个通过，980 个测试中 979 个通过。唯一失败为既有 `test/pbt/auth-lock.pbt.test.js`，Windows 沙箱内 `tasklist` 返回 `Access denied`，导致当前 PID 被误判为不存活；同 seed 单独复跑可稳定复现。用户未批准沙箱外复跑。
