# Implement — 巡航改走请求库

## 执行顺序

- [x] P1 adapter：在 `src/adapter/merchant-auth-probe.js` 新增 `selectCheckCookiesFromState(state)`，按 design §3 实现固定 URL 的 RFC 6265 匹配，导出。
- [x] P2 service：重写 `src/services/patrol.js` 的 `checkLive`，按 design §2 数据流分流（请求库探测优先，浏览器仅在 rejected/已知 rejected/PASS_ID 缺失时启动）；抽出 `browserRelogin` 内部函数复用现有逻辑。
- [x] P3 测试：
  - `test/adapter/merchant-auth-probe*.test.js` 补 `selectCheckCookiesFromState` 用例（design §6 第一组）。
  - 巡航测试补分支用例（design §6 第二、三组）；用注入探针区分是否启动 `withBrowser`。
- [x] P4 spec：更新 `.trellis/spec/adapter/*`（probe 的无浏览器 cookie 选择契约）与 `.trellis/spec/services/*`（巡航两段式检查）；如有 daemon/patrol 文档一并更新。
- [x] P5 校验与审查：`npx vitest run` 定向 + `npm test` 全量；`git diff` 范围核对；Claude 审查 Codex 改动。

## 验证命令

```bash
npx vitest run test/adapter/merchant-auth-probe.test.js
npx vitest run test/services/patrol.test.js   # 实际文件名以仓库为准
npm test
```

## 风险与回滚点

- 风险集中在 cookie 匹配的正确性（域/路径/过期），用单测覆盖边界；匹配过宽会让探测带错 cookie，过窄会漏 PASS_ID 误判 rejected。
- 回滚点：`checkLive` 与新纯函数两处，独立可回退。

## 分工

- 后端实现（P1/P2/P3）：Codex（`codex:codex-rescue`）。
- 审查 + spec/文档（P4/P5 的 spec 与审查）：Claude。
