# Implementation Plan

## Steps

1. Inspect current task context and relevant Trellis/OpenSpec guidance.
2. Inventory env vars and path helpers from code using targeted searches.
3. Cross-check each item against `.env.example`, `AGENTS.md`, Trellis specs, OpenSpec specs, and tests.
4. Produce a diagnostics artifact in the task directory with anchors and drift classifications.
5. Recommend follow-up task splits for behavior changes, spec corrections, or tests.
6. Validate that no runtime files were changed unintentionally.

## Validation

- `git diff --check`
- Targeted Vitest files only if diagnostics adds or adjusts tests.
- `npm run check` only if shared executable contracts are touched.

## Risk Notes

- Auth and account paths can contain sensitive local state; diagnostics must not print secrets or inspect real auth files.
- Do not normalize path defaults without explicit follow-up approval.
- Treat daemon findings as input to the daemon/auth refresher lifecycle diagnostics task.
