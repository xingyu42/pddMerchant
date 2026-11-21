# 04: 明文商品明细接口下线时的混淆版受控切换兜底

**What to build:** 为 `goods traffic` 商品明细建立混淆版接口（`queryGoodsDetailVOListForMMS`）的受控兜底路径，经 `02` 解码并与明文汇总交叉核对；明文接口 `queryGoodsDetailVOList` 正常时保持明文优先零回归，下线或失效时可受控切换，核对失败则报错不可用。

**Blocked by:** 02

**Status:** needs-triage

- [ ] 明文接口可用时优先走明文接口，现有行为零回归
- [ ] 切换至混淆版接口时经 `02` 解码并用明文汇总交叉核对，核对不通过 fail-closed 报错不可用
- [ ] 输出字段集保持与现有 `goods traffic` 契约一致
- [ ] 补齐合同测试、合成 fixture e2e 与文档说明
- [ ] `npm run check` 通过

## Comments
