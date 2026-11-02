# ② 店铺综合体验星级

## Goal

把平台的「店铺综合体验星级」（原店铺领航员）及其各维度指标原样透传出来，用来追踪服务分是否下滑。星级下滑会导致搜索降权、被大促活动清退。

父任务：`10-31-operating-data-gaps`。接口依据：`docs/research/pilot-mall-recon-2026-10-31.md`。术语见 `CONTEXT.md` 中的 Platform-Reported Score。

## Requirements

- R1 新增 `pdd diagnose experience [--days 7]`，envelope 命令名为 `diagnose.experience`。headline 使用平台新名称「店铺综合体验星级」。
- R2 当前快照，数据来自 `queryUpgradeMallNavigatorInfo`：星级（后台展示值）、较前一天的变化、下一星级、达到下一星级所需的综合分排名、领航员综合分行业排名百分位、平台评级文案（如"良"）、统计日期。
- R3 指标明细：每个指标输出所属维度、指标名、值、达到下一星级的门槛、平台给出的达标状态（已达标 / 未达标）。维度包括售后服务、商品品质、物流服务、店铺活跃、特色服务。
- R4 单位规整：0-1 的比率转成 0-100，后缀 `_pct`；时长用 `_hours` 或 `_days`；平台返回 null 的指标输出 null。
- R5 平台的分数、文案、达标判定原样透传，不额外标注来源，CLI 也不生成任何评分。
- R6 含义还没确认的 `*Rk`、`*RkDesc`、`*4p5Standard`、`*5Standard`、`*RkStage` 字段，本期不输出。
- R7 趋势数据来自 `queryUpgradeMallNavigatorList`：`--days` 取 1–30，默认 7。窗口截止到 `queryUpgradeMallNavigatorReadyDate` 返回的就绪日期。每天输出星级、综合分排名和各指标的值，不含 `*Rk`。平台缺数据的日期直接缺行，不补 0。
- R8 第一版不并入 `diagnose shop`。

## Acceptance Criteria

- [ ] fixture（来自侦察样本，已脱敏）能复现页面上展示的值，例如 3 分钟人工回复率 50.00%、门槛 80.00%、未达标。
- [ ] 平台返回 null 的指标（例如签收退货后的平均退款时长）输出 null。
- [ ] 趋势中缺失的日期不出现在输出里。
- [ ] `--days 0` 和 `--days 31` 返回 exit 2。
- [ ] 输出中不含 `mallId`、`mallName` 和图片 URL。
- [ ] data 契约 v2 测试覆盖 `diagnose experience`。
