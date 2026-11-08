# 04: 支持「商家出资所有优惠」口径

**What to build:** 新增 `--caliber regular|all`，默认 `regular`。`all` 口径请求并采用场景值 `[10,11]`，`data.caliber` 和 headline 标明「商家出资所有优惠」；混入其他口径的场景值时忽略并写入 `meta.warnings`。参见 `GLOSSARY.md` 的 Estimated Merchant Receipt 和 `.scratch/goods-receipt/spec.md` 的「领域与口径」。

**Blocked by:** 02

**Status:** resolved

- [x] `--caliber` 只接受 `regular` 和 `all`，其他值返回退出码 2
- [x] `all` 口径下请求的场景值是 `[10,11]`，输出 `caliber: "商家出资所有优惠"`
- [x] 每种口径只采用自己的两个场景值，混入的其他口径场景值被忽略并写入警告
- [x] 如果 03 已合入，补全请求也使用当前口径的场景值
- [x] e2e 和 `data-contract-v2` 覆盖 `all` 口径

## Comments

- 2026-11-08：已在集成分支 `feat/goods-receipt` 完成（a52cacb）；code review 修复见 5de97f1、4054a74。
