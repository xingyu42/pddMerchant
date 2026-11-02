# Remove automated operating advice

## Goal

Remove automated operating recommendations and advice-only entry points while preserving factual queries, metrics, and operational or data-quality diagnostics. Independent side-conversation task.

## Confirmed Facts

- `src/commands/action/plan.js:115` calls `generateActionPlan`; `src/services/action-plan.js:24` and `:70` translate promo classifications and goods tiers into pause/reduce/increase-budget, clearance and restock actions.
- `src/commands/goods/segment.js:50` calls `segmentGoods`. `src/services/goods-segmentation.js:164` chooses restock/clearance, while `:181` also returns numerical sales, inventory and ROI data. Removing the entire entry point would therefore remove more than advice.
- `src/commands/promo/roi.js:10` calls `getPromoRoi`. `src/services/promo-roi.js:3` adds scale/optimize/waste classifications to calculated ratios. Grouped spend, revenue, clicks and overall ROI are separately returned by `:109`.
- Diagnosis advice is generated in `src/services/diagnose/{orders,inventory,promo,funnel}-health.js`, collected by `src/services/diagnose/index.js:44`, and displayed by `src/commands/diagnose/_render.js:63`. Those hints mix operating advice with legitimate missing/partial-data guidance; do not delete all hints indiscriminately.
- Diagnosis also applies application-defined scores and color thresholds (`src/services/diagnose/index.js:6`, `:13`, `:27`); the CLI renderer and command descriptions depend on them (`src/commands/diagnose/_render.js:42`, `src/commands/registry/diagnose.js:11`). These assessments are distinct from source metrics and need an explicit removal decision.
- README and `skills/pdd-cli/SKILL.md` advertise these commands and suggested operating workflows. Current factual specs also mention their contracts and will need scoped updates after the final boundary is approved.
- At planning entry, `git status --short` showed only the unrelated staged `.gitattributes`. No source change is attributed to this side task.

## Requirements

- Remove automated merchant-operating advice and advice-only entry points, including recommendation output generated through action plans, goods segmentation, promo ROI and diagnosis.
- Preserve factual order/goods/promo queries, numerical statistics, and data-quality or operational error guidance. Do not equate unknown data with zero.
- Trace producers, callers, renderers, CLI registration and current documentation; do not leave orphan imports or user-facing references to removed commands.
- This is an independent side-conversation task. Do not modify the parent thread's test-task artifacts or manage its agents/tasks.
- Keep changes local to this removal. No dependency installation, account/network access, unrelated refactor, commit or archive is authorized.
- On 2026-09-05 the user approved task creation, then explicitly approved removing health scores, A/B/C/D tiers and promo classifications alongside operating advice. Proceed within that confirmed boundary, preserving numerical data.

## Acceptance Criteria

- [x] Retained reporting does not generate automatically chosen operating actions.
- [x] Health scores, color grades, weights, goods tiers/component scores and promo quality classifications are absent; period comparisons report numerical changes without calling them improvements/regressions.
- [x] Factual metrics, missing/partial-data warnings, login/configuration error guidance, and existing write-confirmation protection remain available.
- [x] Removed commands are no longer registered or advertised by user-facing documentation, and their unused advice generators have no live callers. Protected internal skill references are reported in implement.md.
- [x] Offline targeted tests and available regressions verify the removal and retained behavior; unrun checks are reported honestly.
- [x] Parent-task artifacts and unrelated worktree changes remain untouched.

## Approved Scope

Remove the subjective assessment layer as well as explicit actions. Preserve factual queries, counts, ratios, inventory/sales measurements and data-quality/operational diagnostics. The user explicitly approved the accompanying breaking output changes. Keep existing data-query command names to minimize unrelated interface changes; remove the action-plan command because it has no independent factual result. Final design and verification steps are in design.md and implement.md.

The parent test plan targets segmentation and ROI decision rules. This side task does not edit that plan; if those rules are removed, the main thread will need to reconcile its test scope separately.
