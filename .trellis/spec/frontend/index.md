# Frontend Development Guidelines

The only frontend is the daemon console under `src/console/` (task `10-27-daemon-console`, ADR 0003). The other files in this directory stay not-applicable.

## Console conventions

- No build step and no npm runtime dependency: Preact + hooks + htm are vendored under `src/console/vendor/` (versions, sources and sha256 in its `README.md`; `.gitattributes` keeps the `.mjs` files byte-exact; knip ignores `src/console/**`).
- CSP is `script-src 'self'; style-src 'self'`: no inline scripts, no import maps, no inline `style` attributes. `hooks.mjs` imports `./preact.mjs` relatively for this reason.
- `src/console/public/index.html` loads `/app/app.js` and `/app/styles.css`; `/app/redeem.js` is the only public script (link redemption page).
- API calls: same-origin `fetch`; every POST sends `Content-Type: application/json` and `X-PDD-Console: 1`. 401 means the console session expired — tell the user to ask for a new link.
- Secrets are write-only: password inputs use `autocomplete="new-password"`, are cleared after submit whether or not it succeeds, and saved values are never fetched or shown. `CredentialForm` is the only login-name/password form, shared by the account page (save password) and the account list (`新增账号` → `/api/accounts/add` → session page without slug).
- Takeover shows only the captcha dialog: frames arrive over SSE (`event: frame`, `{ jpeg, width, height }` with `jpeg: null` while no dialog is found, shown as「等待验证码弹窗…」); pointer events are normalised to 0–1 against the rendered image and flushed every 50 ms; the frame element uses `touch-action: none`. No full-page view, zoom or toolbar buttons.
- Takeover gestures: only the first finger (or mouse) is tracked and sent immediately as down/move/up; extra fingers are ignored.
- SMS challenge (session state `sms`) shows no picture: a numeric input (`inputmode="numeric"`, `autocomplete="one-time-code"`, 4–8 digits) posts `{ code }` to `/sms`; `result` `submitted` / `wrong_code` / `form_changed` maps to a fixed message, and `wrong_code` clears the input.
- Takeover keyboard: the pointer response carries `editable` / `numeric` (booleans after an `up`, else null). `editable: true` focuses a hidden `.ime` input (numeric → `inputmode="numeric"` + `autocomplete="one-time-code"`), `false` blurs it. The input always holds one sentinel character (`​`): typed text is forwarded via `/text`, a deleted sentinel becomes `Backspace`, Enter is sent from `keydown`; text is flushed on `compositionend`, never mid-composition. There is no manual keyboard button.
- Mobile first: tap targets ≥ 44 px, single column ≤ 720 px, light/dark via `prefers-color-scheme`.
- Verify UI changes on a fixture daemon (`PDD_TEST_ADAPTER=fixture`, temp `PDD_DB_PATH`, `PDD_CONSOLE_PORT`) in a real browser; the API contract itself is covered by `test/e2e/console*.e2e.test.js`.
