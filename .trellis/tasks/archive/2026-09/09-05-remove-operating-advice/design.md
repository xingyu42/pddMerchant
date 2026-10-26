# Data-Only Reporting

## Approved Boundary

Remove both operating advice and application-defined assessments. Keep numerical results and data-quality/operational hints. Do not replace them with another recommendation engine or silently retain old advice behind null fields.

## Command And Data Contracts

- Delete `src/commands/registry/action.js`, `src/commands/action/plan.js` and `src/services/action-plan.js`; remove `registerAction` from `bin/pdd.js`. `action plan` becomes an unknown command with the existing usage envelope/exit 2.
- Retain `goods segment` as the existing data-query entry point, but describe it as goods sales/inventory statistics. Preserve goods identity, observed sales, full-period sales where available, quantity, stock days, promo ROI, matching and completeness. Remove tiers, ranking/component/composite scores and actions. Remove its unused `--break-even` option.
- Retain `promo roi` and its plan/sku/channel grouping. Preserve spend, revenue, clicks, impressions, CTR, ROI, inactive filtering and totals. Remove row classifications, classification summaries and `--break-even`.
- Retain all `diagnose` queries. Replace score functions with summarizers and statuses with data availability (`full`/`partial`). No score, color health grade, weight, profit judgment or prescriptive hint. Preserve objective measurements and incomplete-data explanations. Missing input is not fabricated as zero.
- Retain `diagnose shop --compare`, comparing factual metrics with current/previous/delta/delta_pct. Do not compare current inventory snapshots or current pending/delayed counts as historical metrics. Remove score deltas and improvement/regression labels.
- Human renderers show numeric details, source availability and data-quality hints instead of score bars/colors. JSON envelope top-level and error handling remain unchanged.

## Compatibility

This is an explicitly approved breaking payload change. Existing command names remain except `action plan`; consumers must stop reading advice/score/tier fields. Unsupported `--break-even` is rejected rather than silently ignored. Observation counts such as zero-sales inventory and below-threshold stock are retained without operational conclusions.

## Data Flow

Unchanged endpoint adapters -> unchanged collectors -> data-only service summaries -> unchanged runner envelope -> factual renderer. Collector limits and missing-source flags survive the removal. Retained diagnostic hints may explain missing data or a valid command to retrieve data, but must not recommend merchant actions.

## Scope And Coordination

Update README, the user-facing `skills/pdd-cli/SKILL.md`, and applicable factual `.trellis/spec` contracts. Do not rewrite archived research/history or the main thread's test-task artifacts. Agent-owned protected instruction files are not silently edited; report any stale factual references remaining there.

Tests are newly authored and limited to this removal: numerical preservation, absence of assessments, partial data, comparison semantics, rendering, and CLI registration. No old test source is consulted. No real accounts/network, new dependencies, commit or archive.
