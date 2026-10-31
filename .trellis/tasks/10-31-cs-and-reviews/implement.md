# ④ 实施清单

约束：先写测试；函数 < 50 行，嵌套 ≤ 3；ESM + async/await；不加依赖；不提交代码；只用 fixture。

1. [ ] 在 adapter 新增 `customer-service.js` 和 `reviews.js`，并补对应契约测试（payload、isSuccess、白名单投影）。legacy 捕获的写法先读 `endpoint-client.js` 里 legacy 分支的要求，再照着 `GOODS_LIST` 写。
2. [ ] 写两个 view 和 labels，先写 view 测试（映射、掩码、禁止字段、null 透传）。
3. [ ] 写两个 service，先写测试（窗口、days 校验、分页截断、降级规则）。
4. [ ] 写两个命令和 registry 注册；`REDACT_KEYS` 追加新的敏感字段名。
5. [ ] 在 fixtures 中加入新 builder，补 V2_CASES 和 e2e。
   验证：`npx vitest run test/contract/data-contract-v2.test.js test/e2e/customer-service.e2e.test.js test/e2e/reviews.e2e.test.js`
6. [ ] 更新文档：README、`skills/pdd-cli/SKILL.md`，以及 `domain-service-contracts.md` 中客服和评价的契约小节。
7. [ ] 最后执行：`npm test`、`git diff --check`、`git status --short`。
