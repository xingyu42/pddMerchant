# Implementation Plan

## Steps

1. Confirm the config/env/path diagnostics status and import any path-contract findings.
2. Inspect daemon command, launcher, state, and auth refresher code paths.
3. Inventory existing daemon/auth refresher tests and identify missing invariants.
4. Add focused tests only where the current seams can cover behavior without real login, network, or browser dependencies.
5. Write a diagnostics artifact with invariant status, gaps, and follow-up recommendations.
6. Validate targeted tests and run broader checks if shared lifecycle code is touched.

## Validation

- Targeted daemon/auth refresher Vitest files selected after inspection.
- `npm run check` if shared daemon, auth, output, or runner behavior changes.
- `git diff --check`

## Risk Notes

- Do not touch real auth-state or account registry files.
- Do not launch a persistent daemon during tests unless isolated and cleaned up.
- Keep stdout/stderr behavior explicit because JSON purity is a CLI contract.
