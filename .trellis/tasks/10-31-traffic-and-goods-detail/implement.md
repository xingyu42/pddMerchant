# ③ 实施清单

约束：先写测试；函数 < 50 行，嵌套 ≤ 3；ESM + async/await；不加依赖；不提交；只用 fixture。

1. [x] adapter：`traffic.js` 3 个端点（含 PUA 防护），`promo-goods.js` 中的 venus 端点（含展开、取值、单位换算）。补上契约测试。
2. [x] views：`traffic.js` 和 `goods-traffic.js`，以及 labels。先写 view 测试，覆盖映射、单位、白名单、null 透传。
3. [x] services：`traffic.js`、`goods-traffic.js`、`goods-traffic-promo.js`。先写测试，覆盖窗口、days 校验、分页截断、推广归属、负差额、降级规则。
4. [x] commands 和两个 registry 的注册。
5. [x] fixtures、V2_CASES、e2e。
   验证：`npx vitest run test/contract/data-contract-v2.test.js test/e2e/traffic.e2e.test.js test/e2e/goods-traffic.e2e.test.js`
6. [x] 文档：README（写明推广拆分的口径还没有经过实测）、`skills/pdd-cli/SKILL.md`、`domain-service-contracts.md` 中的流量契约小节。
7. [x] 最后执行：`npm test`、`git diff --check`、`git status --short`。

## 执行记录（2026-11-01）

- 按先测试后实现推进；新增接口、service/view 和 e2e 均先确认失败再实现。
- 只读独立审查指出逐日 statDate 缺失会被静默过滤；已增加有效日期校验与 4 项回归测试。另补跨批推广过滤，避免上游忽略 searchKeyV2 时重复累计。
- 全量 `npm test`：95 files passed，1285 passed / 1 skipped；其后补充提前空页及取消测试并调整提示，最新相关 5 文件 / 39 项通过。
- data-contract-v2 + 两条 e2e：3 文件 / 66 项通过；`git diff --check` 通过。
- 未运行真实后端；推广导航触发及有投放店铺金额口径仍待授权实测。lint 脚本为 no-op，无 type-check/build 脚本。
- 实现、质量检查及 spec 同步已完成。按本任务“不提交”约束，保留 in_progress，停在 3.4，未提交/归档/运行自动提交 journal 脚本。
