# 01: fixture 传输支持按请求参数选择变体

**What to build:** endpoint spec 可以声明一个可选的 fixture 变体键（由请求参数推导，例如 `goods_id`）。fixture 模式下，同一个 endpoint 能按参数返回不同的原始响应：优先加载 `<spec.name>.<变体>.json`，缺失时回退到 `<spec.name>.json`。未声明变体键的现有 spec 行为完全不变（包括 `.page<N>` 分页 fixture 和空页回退）。这是给 03 用的预重构。参见 `.scratch/goods-receipt/spec.md` 的「模块划分 / fixture 传输层」。

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 声明了变体键的 spec 在变体文件存在时加载变体文件
- [x] 变体文件缺失时回退到 `<spec.name>.json`
- [x] 未声明变体键的 spec 行为不变，现有 fixture transport 测试全部通过
- [x] 变体 fixture 里的 `__throws` 错误注入照常生效

## Comments

- 2026-11-08：已在集成分支 `feat/goods-receipt` 完成（414ac71）；code review 修复见 5de97f1、4054a74。
