# Frontend Development Guidelines

The only frontend is the daemon console under `src/console/` (task `10-27-daemon-console`, ADR 0003). The other files in this directory stay not-applicable.

## Console conventions

- No build step and no npm runtime dependency: Preact + hooks + htm + `@panzoom/panzoom` are vendored under `src/console/vendor/` (versions, sources and sha256 in its `README.md`; `.gitattributes` keeps the `.mjs` files byte-exact; knip ignores `src/console/**`).
- CSP is `script-src 'self'; style-src 'self'`: no inline scripts, no import maps, no inline `style` attributes. `hooks.mjs` imports `./preact.mjs` relatively for this reason.
- `src/console/public/index.html` loads `/app/app.js` and `/app/styles.css`; `/app/redeem.js` is the only public script (link redemption page).
- API calls: same-origin `fetch`; every POST sends `Content-Type: application/json` and `X-PDD-Console: 1`. 401 means the console session expired — tell the user to ask for a new link.
- Secrets are write-only: password inputs use `autocomplete="new-password"`, are cleared after submit whether or not it succeeds, and saved values are never fetched or shown.
- Takeover: frames arrive over SSE (`event: frame`, `{ jpeg, width, height }`); pointer events are normalised to 0–1 against the rendered (zoomed) image and flushed every 50 ms; the frame element uses `touch-action: none`.
- Takeover gestures: one finger goes to the remote page; two fingers pinch/pan locally through Panzoom (`noBind: true`, `contain: 'outside'`, `pinchAndPan` off with an incremental midpoint pan, because Panzoom's pinch-and-pan overrides the pinch focal point). A touch is held up to 120 ms or 8 px before it is committed to the remote page, so a second finger arriving in that window keeps the whole gesture local; if a second finger joins after commit, send one `up` to release the remote button. Mouse input commits immediately.
- Takeover keyboard: the pointer response carries `editable` / `numeric` (booleans after an `up`, else null). `editable: true` focuses a hidden `.ime` input (numeric → `inputmode="numeric"` + `autocomplete="one-time-code"`), `false` blurs it. The input always holds one sentinel character (`​`): typed text is forwarded via `/text`, a deleted sentinel becomes `Backspace`, Enter is sent from `keydown`; text is flushed on `compositionend`, never mid-composition. A "键盘" button focuses it manually for cross-origin iframes the focus probe cannot see.
- Mobile first: tap targets ≥ 44 px, single column ≤ 720 px, light/dark via `prefers-color-scheme`.
- Verify UI changes on a fixture daemon (`PDD_TEST_ADAPTER=fixture`, temp `PDD_DB_PATH`, `PDD_CONSOLE_PORT`) in a real browser; the API contract itself is covered by `test/e2e/console*.e2e.test.js`.
