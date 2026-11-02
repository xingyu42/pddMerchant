# Design: Auth/account/mall lifecycle SCAMPER planning

## Design Direction

This planning task does not change runtime behavior. It selects a cross-cutting surface and defines a safe first implementation slice.

The recommended sequence mirrors prior successful cross-cutting work:

```text
SCAMPER planning
  -> diagnostics / invariants
  -> spec-drift decision
  -> optional compatible cleanup
  -> optional extraction only after tests prove the seam
```

## Boundary Model

The auth/account/mall lifecycle spans four owners:

1. `src/infra/paths.js`
   - default and env-overridden auth/account paths;
   - account-specific auth-state paths.
2. `src/infra/account-resolver.js` and `src/infra/account-registry.js`
   - account selection and registry persistence;
   - envelope account metadata.
3. `src/commands/runner/**`
   - command-level account/auth/mall orchestration;
   - fixture/live dispatch;
   - batch per-account shaping and isolation.
4. `src/adapter/auth-state.js`, `src/adapter/auth-refresher.js`, `src/adapter/mall-reader.js`, `src/adapter/mall-writer.js`, and `src/adapter/mall-id.js`
   - browser auth validation/refresh;
   - mall read/switch/validate behavior.

## Recommended First Slice Contract Matrix

The first implementation task should freeze observable behavior for a small representative matrix:

| Scenario | Expected owner | Expected observable contract |
| --- | --- | --- |
| explicit `--account` | account resolver + runner | account meta source `flag`, authPath uses per-account path |
| explicit auth path | account resolver + runner | no account meta, source `explicit-path`, mutually exclusive with `--account` |
| empty registry | account resolver | legacy fallback auth path, no account meta |
| default account | account resolver | default account meta and per-account authPath |
| auto-single enabled account | account resolver | auto-single source and per-account authPath |
| multi enabled accounts without default | account resolver | `E_ACCOUNT_REQUIRED` usage envelope |
| batch all-accounts | batch executor | per-account authPath, no mall override, no explicit account, per-account correlation id |
| `needsMall=none` with `--mall` | runner | warning only, no mall ctx needed |
| `needsMall=switch` with `--mall` | runner + mall writer | switch before command run, ctx.mallCtx reflects post-switch context |
| fixture auth invalid | fixture runtime | `E_AUTH_EXPIRED`, command run is skipped |

## OpenSpec Decision

Planning-only and diagnostics-only tasks do not require OpenSpec proposal.

A proposal is required before any of the following:

- moving default auth state from project `data/` to OS user-data;
- changing invalid mall id error code or exit behavior;
- changing auth/account/mall envelope fields;
- changing account registry schema or credential storage;
- changing mall switch semantics or probe order;
- changing security-sensitive logging/redaction behavior.

## Drift Candidates To Decide Later

- `openspec/specs/auth-state-store/spec.md` states OS user-data default, but current code and Trellis spec still describe project-local `data/auth-state.json`.
- `openspec/specs/mall-context-resolution/spec.md` names `E_MALL_ID_INVALID`, but current `requireMallId()` throws `PddCliError` with code `E_USAGE` for invalid ids.

These should be handled as explicit follow-up decisions, not silent drive-by edits.

## Risk Controls

- Automated tests must avoid real merchant network and real auth state.
- Keep auth/account/mall tests focused on observable ctx/envelope/path behavior.
- Do not commit or print files under `data/` or env-overridden auth/account paths.
- Avoid new runtime abstractions until tests demonstrate a duplicated, stable seam.
