# Services Spec Index

服务层承接命令层的意图，编排 adapter，执行领域计算与稳定数据归一化。服务层不拥有 CLI 输出、不直接驱动浏览器、不读取 raw 平台响应给上层。

## 文件

| 文件                                                         | 内容                                        | 使用场景                                     |
| ------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------- |
| [domain-service-contracts.md](./domain-service-contracts.md) | 领域服务边界、归一化、错误与测试契约        | 修改 orders/goods/promo/diagnose 服务 |
| [goods-publish.md](./goods-publish.md)                       | 商品发布、选品抓取、草稿/提交、软封冷却契约 | 修改 `src/services/goods-publish*`           |

## Pre-Development Checklist

- [ ] 确认领域逻辑属于 `src/services/**`，不是 `bin/`、`commands/` 或 `infra/`。
- [ ] 找到已有 service/normalizer/helper，避免重复解析同一 raw payload。
- [ ] 确定 service 返回的是稳定领域结构，不是 endpoint 原始响应。
- [ ] 确认错误通过 `PddCliError` 或 adapter/infra 统一映射，不在 service 打印。
- [ ] 涉及写操作时，确认 command 层已有 `--confirm` / dry-run 保护。

## Quality Check

- [ ] service 只通过 `ctx` 和 adapter 访问外部资源。
- [ ] service 输出字段可被 envelope 直接放入 `data`。
- [ ] null/空数组/缺字段有明确默认值或错误。
- [ ] 新业务规则有 unit 测试，跨 adapter 的流程有 fixture e2e。
