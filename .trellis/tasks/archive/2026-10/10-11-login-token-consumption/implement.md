# LoginToken 消费路径执行计划

## 当前恢复功能执行计划

状态：恢复功能已实现并通过离线验收，待提交确认。保留已有实现及其他会话改动；下面的旧计划仅是历史。

- [x] 按用户要求及此前确定的消费路径激活同一任务，未新建任务。
- [x] 刷新相关指南，保留 test/helpers/error-matchers.js 和现有 deepFreeze 等其他会话改动。
- [x] 缺失/不同工作 Cookie 的两个 lifecycle 用例在未实现时业务成功断言为红灯；实现后绿色。模拟 HTTPS 只接受保存来源对应的 Cookie，业务实际收到它并按成功时机保存。
- [x] 新增 merchant-token-consumption 模块，解析 Token、保留捕获属性及同次材料、创建独立 Cookie 上下文并交接，失败清理。
- [x] branded candidate 和原子提交保存版本化来源；旧完整材料经核验建立来源，原有锁/修订/店铺/注册/路径规则保留。
- [x] 增加内部 storageState 对象参数，不增加公开选项、不改 profile。
- [x] 接入 login、普通命令和 doctor，实际业务/pageSession 使用消费后 context/page；doctor 成功条件内提交。
- [x] 消费模块 15 项测试及 lifecycle/storage/snapshot/account/e2e 回归覆盖拒绝归属、失效/不确定、非法材料、跨店、旧文件、业务失败、取消、冲突、保存失败、清理与脱敏。显式登录能重授权损坏来源，但网络不确定不会打开授权页。
- [x] 更新 auth 与 browser 规范，撤销错误排除结论；保留请求前校验，并补上 CR/LF 名称严格拒绝。
- [x] 相关测试通过，最终 npm test：31 文件 441 项通过；14 个改动 JS 文件 node --check 通过，git diff --check 通过。主会话按 trellis-check 审查，无阻塞问题；无 lint/type/build 覆盖声明。
- [x] 新消费验收均为合成/模拟及 fixture，未读写/破坏真实账号材料；旧真实登录结果不当作新功能验收。
- [ ] 提出一次提交计划，等待确认后提交；未经确认不提交、归档或把任务标为完成。

## 已完成校验阶段记录（不再是当前功能执行计划）

状态：实现和离线验证完成；用户授权后的正常登录、保存会话三接口核验已通过实测。异常场景为离线验证，待用户确认代码提交。

## 1. 开始条件

- [x] 用户授权在审查 prd.md、design.md 无问题后实现。
- [x] 确认 implement.jsonl / check.jsonl 已有实际条目，按 Trellis 步骤 1.4 执行 `task.py start`（会话指针缺失时降级运行，状态已变为 in_progress）。
- [x] 加载 trellis-before-dev 和 adapter、infra、standards 相关指南。
- [x] 重新检查 git 状态，保留用户已有的修改；不修改来源项目 `D:/Dev/pinduoduo/`。
- [x] 改动范围小（2 个源文件 + 2 个测试文件 + 1 份规范）：由主会话直接实现，用 trellis-check skill 审查，不派发子代理。

## 2. 先写红灯测试

- [x] 在 `test/adapter/merchant-auth-storage.test.js` 让 `createSnapshotContext` 的 mock 按 URL 选择 Cookie（按 path 边界匹配 URL 路径）。构造 check 与店铺目标不同 PASS_ID 的合成快照。
- [x] 断言 `verifyMerchantContext()` 以 `cross_target_pass_id_mismatch` 拒绝，并且 `mockMerchantProbeTransport()` 返回的 spy 调用次数为 0。
- [x] 实现前运行该用例：在调用次数断言上失败，实际 1 次、预期 0 次，不是导入缺失。实现后通过。

## 3. 实现（`src/adapter/merchant-auth-probe.js`、`src/adapter/merchant-auth.js`）

- [x] 新增 `selectMerchantCookies(context)`：对三个固定 URL 分别调用 `context.cookies([url])`，深度复制并冻结。
- [x] 新增 `deriveLoginToken(selection)`：逐组执行 `buildCheckHeader()`，比较三组 PASS_ID 原值，返回 `'PASS_ID=' + 原值`。
- [x] `probeMerchantShop(selection, options)` 改为直接使用传入的材料，删除内部采集和比较。
- [x] 删除 `collectCheckCookies()`；在 `verifyMerchantContext()` 中按 design.md §4 调整顺序。
- [x] 不改动调用方、candidate 结构、认证文件结构、错误码或输出。

## 4. 测试调整（`test/adapter/auth-probe.test.js`）

- [x] 原 `collectCheckCookies` 用例改为验证 `selectMerchantCookies` 的逐 URL 选择、复制和冻结。
- [x] `deriveLoginToken`：值含 `=`、`%xx` 时原样保留；空值、重复、非法字符、分区、`pass_id` 大小写变体、跨目标不一致都被拒绝，且 detail 不含 Cookie 值。
- [x] `probeMerchantShop` 的现有用例改用 selection 入参；"refuses mixed sessions" 用例迁到 `deriveLoginToken`。
- [x] 在 `merchant-auth-storage.test.js` 补充：check 目标缺少/全空 PASS_ID 时返回 `auth_missing`，0 次请求；另覆盖三目标格式异常与两个店铺目标单独不一致。

## 5. 规范

- [x] 按 design.md §6 更新 `.trellis/spec/adapter/auth-mall-context.md`，包括 §6 Tests Required 中的测试文件说明。

## 6. 验证与审查

```bash
npx vitest run test/adapter/auth-probe.test.js test/adapter/merchant-auth-storage.test.js test/adapter/merchant-auth-lifecycle.test.js test/adapter/merchant-auth-save-failure.test.js test/services/merchant-account-storage.test.js test/e2e/merchant-auth.e2e.test.js
npm test
git diff --check
```

- [x] 对 4 个修改过的 ESM 文件运行 `node --check`，全部通过；没有新增依赖，也没有运行时 `console.log`。
- [x] 主会话用 trellis-check 审查：规范与源码一致、三目标校验在请求前完成、错误 detail 仅固定 reason、fixture 未读写真实状态；未发现阻塞问题。
- [x] `npm run lint` 只是 `echo no-lint`，未执行，也不作为静态检查覆盖；项目无 TypeScript 检查和构建步骤。
- [x] git diff --check 通过；跟踪 diff 只有 2 个 adapter 源文件及 2 个测试文件，没有触碰真实账户。规范与任务文档在被 Git 忽略的 `.trellis/` 中。

验证结果：相关 6 个测试文件 75 项全部通过；`npm test` 全量 30 个文件 421 项全部通过。均为合成凭据、模拟 HTTPS/browser 与隔离 fixture 验证，不代表真实后端验收。

### 用户授权后的真实验证

- 用户要求执行 `pdd login`：当前终端未注册全局 pdd，以当前仓库 `PDD_TEST_ADAPTER= node bin/pdd.js login` 执行，正常登录、身份核验及保存成功，退出码 0。
- 用户随后要求检查任务目标：仅对本次登录的商家执行只读验收，不检查其他商家、消费者账号或业务写接口。
- 用现有 `withMerchantAuthUpdate`、`withBrowser`、`verifyStoredMerchant` 重建保存会话，记录 Cookie 选择和 HTTPS 请求的阶段/固定路径，不记录 Cookie、Token、请求头或原始响应。实际前三阶段为 checkLogin、身份、只读目标的 Cookie 选择，之后恰好 3 次请求分别发送到这三个接口；结果 `verified / shop_read`，与已绑定店铺一致。
- 保存材料仍为版本 1、`verified / shop_read`，没有独立 Token/header/repair 副本。验收前后认证文件修订号相同，未改写 Cookie 或检查元数据。
- 随后再次运行上述相关 6 文件测试，75 项全部通过。跨目标不一致、非法材料、失效与网络不确定等异常只用合成/模拟测试，不破坏真实会话，也不宣称验证了服务端续期或全部业务权限。

## 7. 回滚点

改动集中在 adapter 的两个文件，没有数据结构变化。回滚直接还原这两个文件及对应测试，无需迁移。
