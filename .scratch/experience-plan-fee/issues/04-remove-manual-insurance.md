# 04: 从商品成本中删除手填运费险 `insurance_yuan`

**What to build:** 运费险改由平台收费记录自动计算（03）后，`goods cost` 不再接受、存储或输出手填的运费险。`goods cost set` 去掉 `--insurance-yuan`，`goods cost list` / `remove` 的输出去掉 `insurance_yuan`，`goods cost import` 遇到 `insurance_yuan` 字段时报用法错误并说明运费险已改为自动计算。

**Blocked by:** 03

**Status:** resolved

- SQLite：`goods_costs.insurance_fen` 列**保留不动**，不升级 `user_version`（升级会让旧版 CLI 拒绝打开数据库）。新代码不再读写该列，插入时依赖默认值 0。`.trellis/spec/infra/sqlite-storage.md` 注明该列已停用
- `--insurance-yuan` 作为未知选项由 commander 报错，退出码 2
- `goods cost import` 的 JSON 中出现 `insurance_yuan`：整个导入以 `E_COST_IMPORT_INVALID` 失败，行错误信息写明「运费险已改为按平台收费记录自动计算，请删除 insurance_yuan」

- [x] `goods cost set --insurance-yuan 1` 退出码 2
- [x] `goods cost list` 的条目字段不含 `insurance_yuan`（`GOODS_COST_ENTRY_FIELDS` 与 data-contract-v2 同步）
- [x] 导入文件带 `insurance_yuan` 时失败并给出上述提示；不带时照常导入
- [x] 已有数据库（`insurance_fen` 有非 0 历史值）打开、列出、利润计算都正常，且历史值不再出现在任何输出
- [x] SKILL.md、README、reports.md、domain-service-contracts、sqlite-storage 规范同步；CHANGELOG 标注为不兼容变更
- [x] `npm test` 通过

## Comments

- 2026-11-15：按用户决定「完全去掉手填运费险」创建。
- 2026-11-15：已合入 feat/auto-insurance-fee（b67e2d3）。已有行更新时旧 insurance_fen 留在库里但不再输出。
