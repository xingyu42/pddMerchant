# LoginToken 消费路径设计

## 当前恢复方案（已实现并通过离线验收）

用户已撤销下面收缩版的目标。当前设计新增真实的 Token 消费与 Cookie 建立/恢复流程，保留已完成的请求前校验。不能以 Cookie 重建已有机制为由再次删除独立来源和消费入口。

### 1. 材料与兼容

保持顶层 Playwright cookies/origins 和 merchant_auth.version=1，新增可选 `merchant_auth.repair_credential`（version=1）：规范化 login_token、稳定 mall_id、同次完整 state、checked_at 和该来源的 last_check。工作状态与独立来源在同一文件中原子提交；这是一份有意保留的来源，不是服务端新凭据，也不新增扫描/导入入口。

`verifyMerchantContext` 返回的 branded candidate 增加内部规范化 login_token。只有这样的候选能建立/更新来源，来源 Token 与来源状态的 PASS_ID 必须匹配。业务视图不接收该候选或来源。来源非法时显式拒绝，不能静默改用工作材料掩盖错误；完整旧文件可在核验后升级，不凭空补材料。

### 2. 独立消费模块

在 adapter 增加一个专门模块，输入账号绑定的保存来源、浏览器、工作上下文及任务限制，输出可供调用方使用的 context、核验结果和内部恢复标记。模块不读写文件、不取得锁，文件事务仍由调用方持有。

明确执行 Token 到 Cookie 的转换：解析规范化 Token；以来源 Cookie 的域、路径、安全、HttpOnly、SameSite、原始过期属性为模板构造 PASS_ID；保留同次其余 Cookies/origins，并写入隔离浏览器上下文。不根据 Token 字符串猜属性，不把 checkLogin 当作签发接口，不混入损坏工作状态的辅助项。

在独立上下文执行现有三目标格式/一致性校验、GET checkLogin、身份及 shop_read 核验；失败不交付可用 context，不提交。成功后交付本次建立的账号 Cookie 上下文，确保业务入口使用它。临时冻结核验上下文与业务上下文分别清理，最终保存仍使用冻结且再次核验的 branded candidate。

### 3. 自动接入

- login：事务内加载来源或完整旧材料，自动消费/核验；成功提交当前 Cookie 和来源。来源明确拒绝时清空工作上下文并进入正常交互授权，新的已核验授权材料替换来源。
- 普通命令：事务内在业务执行前恢复 Cookie/context/page；pageSession 只能在选定可用上下文后创建。业务失败不保存恢复结果；业务成功后延续最终快照核验和持久化，保存失败保留成功 envelope 与现有警告。
- doctor：仅对本次选中商家取得显式事务，消费并核验；整体检查通过后提交必要恢复/旧文件升级。消费端检查逻辑不变，不遍历修复其他账号；其他 needsAuth:false 命令仍禁止写入。

如浏览器加载损坏的工作 Cookie 就会失败，给 launchBrowser/withBrowser 增加内部 storageState 对象输入，由事务选择安全的初始状态；不新增公开配置/参数，沿用现有 runtime profile。拒绝信息必须绑定被核验来源；工作 B 被拒绝不能自动使独立来源 A 失效。

### 4. 保存、失败与脱敏

扩展 `commitMerchantCandidate` 原子写入来源并保留原有锁、修订、注册复制、显式路径绕过、realpath 和店铺绑定。已知 rejected 的同一来源不在普通操作无限重试；indeterminate 不删除来源、不打开登录页。一次调用最多一次恢复，网络重试沿用原有有界行为。

新增 repair_credential 容器整体指纹脱敏；不暴露 Token/ck/context。不放宽 malformed JSON/缺少 storage arrays 的恢复规则。不同新旧写入器不能并发操作；旧程序可读顶层状态但可能丢弃来源，降级仅失去自动消费能力。

### 5. 验证与规范

先在实际 lifecycle 接入点构造合成保存来源 A + 缺失/不一致工作 Cookie，证明未实现时失败，再实现模块和三个调用入口。必须断言业务实际收到 A、旧文件得到核验后升级、失败不覆盖、材料拒绝归属正确以及来源/Token 不输出。全量回归只作基线，新增行为有独立失败/成功证据。

实现时同步 `.trellis/spec/adapter/auth-mall-context.md`：撤销收缩版的“本地 Cookie 修复不适用/不得保留独立来源”规定，加入来源取得、消费、验证、提交、doctor 显式事务及拒绝归属契约。无需删除现有三目标请求前校验。

## 收缩版设计历史（已撤销，不再约束本次实现）

状态：已按修订范围实现并通过离线验收；用户授权后，正常登录及保存会话的三接口核验已通过真实后端验证。异常场景仍仅用模拟材料验收，代码待提交确认。

## 1. 目标与边界

把"三目标选择 Cookie → 提取规范化 login_token → 校验一致性"整体前移到第一次网络请求之前。消费形态不变：已核验冻结快照中的 PASS_ID Cookie 仍是唯一的提交和业务材料。

不新增模块、认证文件字段、CLI 参数、错误码或输出字段。本地 Cookie 修复不适用的理由见 prd.md 的"审计结论"。

## 2. 现状与缺口

`verifyMerchantContext()`（`src/adapter/merchant-auth.js:44-62`）的现有顺序：

1. 冻结 `context.storageState()` 并建立快照上下文。
2. `collectCheckCookies()` 只采集 checkLogin 目标的 Cookie；`hasPassId()` 不通过时返回 `rejected / auth_missing`。
3. `probeCheckLogin()` 发出第一个请求，`buildCheckHeader()` 只校验 check 目标。
4. `probeMerchantShop()` 此时才采集身份、只读两个目标的 Cookie，并与 check 目标比较 PASS_ID。

不一致在第 4 步才被发现，第 3 步的 checkLogin 请求已经发出。快照上下文由冻结快照建立、内容不会变化，所以把店铺目标的采集提前不改变任何选择结果，只改变校验时机。

## 3. 接口变更（`src/adapter/merchant-auth-probe.js`）

```js
// 浏览器按固定 URL 分别选择 Cookie；返回深度冻结的三组材料。
export async function selectMerchantCookies(context)
  // -> { check: Cookie[], identity: Cookie[], shopRead: Cookie[] }

// 逐组执行 buildCheckHeader() 规则，要求三组 PASS_ID 值完全一致；
// 返回规范化 login_token（'PASS_ID=' + 原值）。不一致抛 cross_target_pass_id_mismatch。
export function deriveLoginToken(selection)

// 改为接收已选择并校验过的材料，不再自行采集或比较 PASS_ID。
export async function probeMerchantShop(selection, options)
```

- `collectCheckCookies()` 被 `selectMerchantCookies()` 取代，删除该导出及其测试，改为测试新函数的复制与冻结行为。
- `hasPassId()`、`buildCheckHeader()`、`probeCheckLogin()`、分类函数和传输逻辑都不变。
- `login_token` 只是校验时的内部参照值，不挂到 candidate、不返回、不持久化，与现有"不保存 token 或派生头副本"的契约（`test/adapter/merchant-auth-storage.test.js:52`）一致。

## 4. 新流程（`verifyMerchantContext()`）

```js
const selection = await selectMerchantCookies(frozenContext);
if (!hasPassId(selection.check)) return { verdict: 'rejected', reason: 'auth_missing', ... };
deriveLoginToken(selection);                       // 失败即抛 E_AUTH_CANDIDATE_INVALID，0 次请求
const check = await probeCheckLogin(selection.check, task);
if (check.verdict !== 'verified') return check;
const shop = await probeMerchantShop(selection, task);
```

其余部分不变：mock 分支、身份比对、candidate 冻结与 WeakSet 标记、`finally` 中关闭快照上下文。

| 输入 | 结果 | 请求数 |
| --- | --- | --- |
| check 目标无非空 PASS_ID | `rejected / auth_missing`（不变） | 0 |
| 任一目标格式非法、重复、分区或 PASS_ID 空值/逗号 | `E_AUTH_CANDIDATE_INVALID`（不变） | 0（原先为 0 或 1） |
| 跨目标 PASS_ID 不一致 | `E_AUTH_CANDIDATE_INVALID / cross_target_pass_id_mismatch` | 0（原先为 1） |
| 三组一致 | 进入现有核验 | 不变 |

调用方 `src/services/auth.js`、`src/adapter/merchant-auth-storage.js`、`src/commands/runner/single-lifecycle.js` 和 doctor 不需要修改。

## 5. 输出与敏感数据

错误仍由 `invalidCandidate(reason)` 构造，detail 只有固定的 reason，不含 Cookie 值或 login_token。`login_token`、`cookies`、`PASS_ID` 已在 `REDACT_KEYS` 中（`src/infra/logger.js:7`），无需新增。

## 6. 规范调整（`.trellis/spec/adapter/auth-mall-context.md`）

- §3 Contracts 增加一条：三个固定目标的 Cookie 必须在第一次核验请求前，从同一冻结快照中选择并校验；规范化 login_token 只作为内部一致性参照，不持久化、不输出。
- §1 Scope 或 §7 增加说明：本地 Cookie 修复不适用。原因是上下文每次都从只含已核验材料的文件重建，且接口拒绝会作用于同一 PASS_ID 的所有副本。不得引入独立的修复凭据副本；如有人再提出，必须先给出一条真实写入路径，证明文件中的工作材料会与有效来源分离。

## 7. 兼容与回滚

认证文件结构、错误码、输出不变；回滚只需还原代码，与新旧写入器之间没有兼容问题。

## 8. 验证范围

只做 adapter 层单测：模拟 HTTPS，并使用按 URL 选择 Cookie 的快照上下文。fixture 模式下 `verifyMerchantContext()` 直接短路，不经过 Cookie 路径，e2e 无法证明本变更，只用来回归。真实后端验收需要另行授权。
