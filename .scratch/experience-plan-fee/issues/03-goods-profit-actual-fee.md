# 03: `goods profit` 使用平台实际服务费

**What to build:** `goods profit` 优先用平台逐单服务费，拿不到时回退到商家手填的每单值，并在输出里标明每部分费用的来源。先更新 ADR 0004。

**Blocked by:** 02；且 01 确认存在逐单数据

**Status:** needs-triage

- [ ] ADR 0004 补充服务费来源、回退规则、退款处理
- [ ] 输出平台实际服务费合计和使用手填值回退的订单数
- [ ] 服务费拉取失败时的行为与推广费一致（相关利润为 `null`）
- [ ] `goods profit` 的契约测试同步更新

## Comments
