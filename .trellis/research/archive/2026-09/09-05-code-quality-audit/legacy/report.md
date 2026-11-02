# 代码质量审查报告

日期：2026-09-05。基线：`03c53f7b3ef3532409558d92d43c530a7970a9bb` 的当前工作区，包含原有未提交修改。

## 结论

首轮确认 9 项功能问题、2 项维护负担。问题集中在“是否真的成功”和“数据是否完整”的边界，而不只是文件长、命名或排版。建议先修成功/失败误判和不完整数据生成建议的问题，再做小范围去重，不建议直接全项目重写。

所有“确认”均指代码和本地模拟可证明的行为，不代表这些问题已在真实账号上发生。没有登录、请求真实接口、启动真实浏览器/daemon，或读取现有账号与登录态。

P1：建议下一轮优先修复。P2：应安排修复，但可以在 P1 后处理。编号用于复现对应，不代表排名；下文按优先级排序。

## 功能问题

### F2 [P1] 登录刷新将 HTTP 成功当成登录有效，并保存状态

- 位置：`src/adapter/auth-refresher.js:20` 的 `heartbeat()`、`:82` 的 `refreshAuth()`。
- 条件：心跳 HTTP 200、没有跳转，但正文表示业务失败或登录无效。
- 证据：只读取 `status/ok/redirected/url`，不读取正文；随后直接调用 `saveAuthState()`，返回 `success:true, reason:refreshed`。模拟正文含 `success:false/result.login:false` 时，正文读取次数为 0，保存次数为 1。
- 影响：后台把未经证实的登录状态报成刷新成功，并写回状态文件，掩盖重新登录的需要。不能由此推断真实服务器续期效果。
- 反证核对：已有测试 `test/auth-refresher-lifecycle.unit.test.js:192` 明确接受非重定向 200；这锁定了旧行为，不证明登录有效。当前规格 `.trellis/spec/adapter/auth-mall-context.md:163` 要求自然 `checkLogin` 的布尔登录结果，并禁止 HTTP-only fallback；代码没有实现此契约。
- 建议：以明确登录业务结果区分有效、失效、无法判断；只有有效才保存；删除旧心跳和首页 HTTP 的成功替代路径。同步更新旧测试，避免把错误行为继续当成正确。

### F1 [P1] live 命令结束前就清除了总超时定时器

- 位置：`src/commands/runner/single-lifecycle.js:191`，`executeSingle()`。
- 条件：非 fixture 路径设置 `timeoutMs`，业务等待依赖 `ctx.signal` 取消。
- 证据：`return executeLive(...)` 没有 `await`，`finally` 立即 `clearTimeout`。10ms 限时下，模拟 100ms 的 `abortableSleep` 仍成功返回，signal 未取消；相同 fixture 路径得到 `E_TIMEOUT`。
- 影响：依赖总取消信号的工作与重试等待可越过命令期限，出现“设置了超时仍等很久”。
- 反证核对：`:145` 注释刻意保留旧时序，但旧时序并不满足总超时目标。`endpoint-client.js:352` 和 `endpoint-attempt.js:48` 仍用 `deadlineAt` 限制部分请求，所以不能宣称所有请求都无限等待。
- 建议：在生命周期内等待 live promise 后再清理定时器，并用真正 live 分支的模拟工作验证到期取消和清理。只断言 signal 存在不够。

### F3 [P1] 陈旧的 running 文件能冒充新 daemon 启动成功

- 位置：`src/infra/daemon-launcher.js:100`，`ensureDaemonRunning()`；此文件有原有 WIP，本次未改动。
- 条件：旧进程已经退出，但状态文件仍为 `running`；新启动尚未写入状态，或者启动失败。
- 证据：初始检查发现旧 PID 死亡后启动进程，轮询却只检查 `s.status === 'running'`，不检查 PID 存活及是否为新实例。模拟新子进程 PID 54321、旧死 PID 12345，返回 `{started:true,pid:12345}`。
- 影响：`daemon.start`、登录后的自动启动确认收到虚假成功，实际可能没有后台刷新进程。
- 反证核对：等待锁的另一条路径 `:85` 有存活检查；但新启动路径没有，因此不能覆盖此故障。
- 建议：启动确认绑定本次实例标识，并核对进程存活；超时或陈旧状态返回未确认。Windows 启动器 PID 和真实 daemon PID 不相同，不能简单只比较 spawn 返回的 PID。

### F8 [P1] 订单未采完仍推导零销量，生成清仓建议

- 位置：`src/services/goods-segmentation.js:157`、`:185`；下游 `src/services/action-plan.js:67`、`:196`。
- 条件：订单采集被限流或截断，某商品在已采部分中没有订单。
- 证据：`orders-collector.js:37` 可在首轮限流后返回空数组与 `ratelimited:true`；分层仍将未匹配商品标为 D 类和 `clearance`。行动计划继续输出 `clearance`、`confidence:medium`，只用布尔值表示分层数据存在。
- 影响：把“没查到销量”误当“确实零销量”，产生不可靠的降价/下架建议。这里只生成建议，并未自动执行商品写操作。
- 反证核对：分层摘要确实标记 `partial_orders`；但没有阻止清仓规则，下游也未保留这一完整性状态。现有测试只检查 partial 标签。
- 建议：不完整扫描下，不凭未匹配推导零销量清仓；将不确定性传至行动计划，抑制或明确降级依赖完整销量的建议。

### F4 [P2] 停止进程失败仍报告停止成功，并删除控制状态

- 位置：`src/commands/daemon.js:115`，`stop()`。
- 条件：终止命令因权限等原因失败，进程仍存活。
- 证据：模拟两次 taskkill 都抛错，PID 始终存活，最终仍返回 `ok:true/stopped:true`，并删除同标识状态文件。
- 影响：用户以为后台已停止，后续 status 又失去追踪信息。
- 反证核对：存在无状态和无 token 的安全分支，但不能覆盖有 token、终止失败的情况。
- 建议：最终核对进程存活；未停止时返回明确失败并保留状态，不能吞掉失败后继续报告成功。

### F5 [P2] 保本 ROI 高于 2 时，亏损区间仍被建议增加预算

- 位置：`src/services/promo-roi.js:7`，`classifyRow()`；`src/services/action-plan.js:49`。
- 条件：`--break-even 3`，花费 100、成交金额 250，ROI 为 2.5。
- 证据：固定的 `roi >= 2` 在保本判断之前执行，结果为 `scale`，行动计划为 `increase_budget`。
- 影响：建议与用户明确设置的保本线冲突。
- 反证核对：`src/commands/registry/promo.js:15` 和 `registry/action.js:13` 均明确把参数称为保本阈值，没有限制其必须小于 2；现有自定义测试只覆盖 1.5。增加预算建议的 confidence 为 low，但这不消除方向矛盾。
- 建议：先判定是否达到用户保本线，再判扩量；保留现有默认行为并补充阈值大于 2 的边界用例。

### F6 [P2] 商品没采完的标记在库存评分和分层中丢失

- 位置：`src/services/diagnose/inventory-health.js:161`；`src/commands/goods/segment.js:50`。
- 条件：商品扫描达到上限或限流，订单扫描则完整。
- 证据：`collectors.js:65` 保留 `goodsScanTruncated/goodsScanRateLimited`，评分函数不接收它们；分层命令只传订单扫描标记。模拟商品截断、订单和推广完整，结果 `data_completeness:'full'` 且无 warning。
- 影响：局部商品统计看起来像覆盖了全店。库存评分在总数未知时可与完整扫描结果完全相同。
- 反证核对：`inventory-health.js:221` 在已知总数较大时给出文字提示；这只覆盖部分情形，且不能修复分层的 full 标记。
- 建议：分别保存商品和订单的扫描完整性，并贯穿库存、分层、行动计划；已采样本的评分可保留，但不能声称覆盖完整。

### F7 [P2] 缺字段的成功响应被转换为真实零数据

- 位置：`src/adapter/endpoints/goods.js:23`、`:38`；`src/adapter/endpoints/promo.js:85`、`:119`。
- 条件：平台返回 `{success:true,result:{}}`，例如响应结构改变或上游缺少必要字段。
- 证据：商品结果变为 `total:0/goods:[]`；推广变为零花费、空实体。`endpoint-client.js:282` 到 `:299` 先用宽松 success 检查再直接归一化，没有补充形状校验。
- 影响：无法区分“真的没商品/没花费”和“响应不完整”，下游统计会被假零污染。
- 反证核对：合法的显式零值和空数组应继续允许；问题是缺字段，不是零本身。推广旧测试接受 `result:{}`，而当前规格 `endpoint-xhr-contracts.md:49` 禁止缺必需字段默认成业务零。
- 建议：先验证必要结果字段及类型，缺失时报可诊断错误；不改变合法零结果。这是一项共同的契约缺陷，商品与推广不重复计数。

### F9 [P2] 独立诊断命令丢弃取消、期限和页面会话上下文

- 位置：`src/commands/diagnose/inventory.js:13`；同形问题见 `orders.js:13`、`promo.js:13`、`funnel.js:23`。
- 条件：执行独立诊断，而非传递完整 ctx 的组合诊断路径。
- 证据：命令只把 `{mallId}` 传给采集器；模拟验证传入的 signal、deadlineAt、client、pageSession 均丢失。`run-endpoint.js:20` 转发余下 ctx，`endpoint-attempt.js:46`、`:48`、`:58` 依赖这些字段。
- 影响：这些诊断请求失去命令期限和取消信号，也绕过共享页面会话选择能力。修复 F1 本身不能修复这里。
- 反证核对：共享 client 已初始化时仍能取到，因此不声称必然配置报错；普通 fixture 成功也不证明 live 的上下文完整。
- 建议：传递完整 ctx，必要时追加 mallId，补充逐个诊断命令的上下文传递测试。

## 维护负担

### M1 [P2] 行动计划的多路编排重复采集同一份订单数据

- 位置：`src/services/diagnose/collectors.js:57` 与 `src/commands/action/plan.js:70`。
- 证据：库存输入已采集 30 天订单并保留 `orders30d/truncated/ratelimited`，开启分层后又采一次。模拟完整 action handler，订单采集器调用两次。
- 成本：一次行动计划最多多出一轮 10 页订单采集和等待，失败处理也分成两份；两次时间窗口略有差异，不保证同一数据快照。这里证明的是代码重复调用，没有把它归因为真实平台限流。
- 建议：在同一次行动计划内复用已有订单快照与扫描标记；统一编排所有权。不要为此建立跨命令缓存或通用工作流框架。

### M2 [P2] 商品身份匹配规则存在两份相同实现

- 位置：`src/services/diagnose/inventory-health.js:20`、`:78`、`:86`；`src/services/goods-segmentation.js:39`、`:49`、`:57`。
- 证据：`readGoodsId/detectStrategy/detectMatchedBy` 分别维护 ID 合法性、按 ID/名称降级、mixed 标签三项相同规则；分层已经复用同文件的另外三项辅助函数，却仍复制这些规则。
- 成本：调整商品 ID 或名称兜底策略时必须同步改两处，遗漏会让“库存诊断”和“商品分层”对同一商品得出不一致的匹配结果。当前两份规则相同，未声称已经出现匹配差异。
- 建议：只为这套已重复的身份匹配规则设一个小的服务层所有者，配一组共同契约测试；库存评分和分层算法仍各自保留。

## 验证

1. 任务内隔离复现：4 文件、13 用例通过。它们断言上述错误行为确实发生，属于审查证据，不是“修复已通过”；修复后应改写为正确行为的回归测试。
2. 现有定向测试：8 文件、107 用例通过。包括 ROI、分层、库存评分、商品采集、行动计划、层级守卫、daemon 生命周期、auth-refresher 生命周期。
3. 未跑全量 npm test、live/e2e 或浏览器验证；统一 `test/setup.js` 仅清除输出环境变量，不能保证所有测试的账号/文件隔离。
4. 无有效 lint/build 门禁：`npm run lint` 是 `echo no-lint`，项目无 build 脚本。未把这些计为验证成功。

实际命令：

```bash
node node_modules/vitest/vitest.mjs run --config .trellis/tasks/09-05-code-quality-audit/audit.vitest.config.js
node node_modules/vitest/vitest.mjs run test/promo-roi.unit.test.js test/goods-segmentation.unit.test.js test/diagnose-scoring.unit.test.js test/goods-collector.unit.test.js test/action-plan.unit.test.js test/layering-guard.unit.test.js test/daemon-lifecycle.unit.test.js test/auth-refresher-lifecycle.unit.test.js
```

复现文件在本任务 `repro/`。浏览器、fetch、文件和进程操作均被模拟；现有生命周期测试使用自建临时文件及模拟进程状态。未运行启动真实 daemon 的测试。测试输出的 `E_DAEMON_START_FAILED` 是预期模拟失败用例，不是本机 daemon 状态。

## 推荐整改顺序

1. 修 F2/F3/F4：让登录刷新与进程启动/停止结果可信。
2. 修 F1/F9：补全总超时和诊断上下文传递。
3. 修 F8/F6/F7/F5：先保留数据不确定性，再校正建议规则。
4. 修 M1/M2：减少重复采集和重复规则，避免大规模结构重写。

本次仅完成审查，没有修复、提交或归档。覆盖与待核验线索见 `coverage.md`。
