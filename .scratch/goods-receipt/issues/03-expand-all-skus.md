# 03: 补全每个商品的全部 SKU

**What to build:** 对 `remain_sku_num > 0` 的商品按顺序调用 `expand_all_sku`，请求带上已拿到的 SKU ID（`exposed_sku_id_list`）和当前口径的场景值，合并后每个商品输出全部 SKU，`sku_count` 是全部 SKU 的数量。补全接口返回业务错误时，整个命令以退出码 6 失败，不输出不完整的 SKU 列表。参见 `.scratch/goods-receipt/spec.md` 的上游接口一节。

**Blocked by:** 01, 02

**Status:** resolved

- [x] 只对 `remain_sku_num > 0` 的商品调用补全，按顺序发起请求
- [x] 补全后的 SKU 和列表接口带回的 SKU 字段规则完全一致，不重复输出
- [x] `sku_count` 是补全后的 SKU 总数
- [x] 补全请求使用当前口径的场景值（如果 04 已合入，`--caliber all` 时为 `[10,11]`）
- [x] 补全接口业务错误时，命令以退出码 6 失败
- [x] e2e 测试借助 01 的 fixture 变体，让不同商品返回不同的补全结果

## Comments

- 2026-11-08：已在集成分支 `feat/goods-receipt` 完成（f137628）；code review 修复见 5de97f1、4054a74。
