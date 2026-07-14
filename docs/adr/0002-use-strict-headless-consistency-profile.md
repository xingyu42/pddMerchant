# ADR 0002: Use a strict true-Headless consistency profile

## Status

Accepted — 2026-07-15

## Context

pdd-cli already uses Patchright and Chromium's unified Headless mode, but the previous Context combined a real `HeadlessChrome` UA with a fixed `1920x1080` viewport, DPR `2`, and no taskbar difference. Public test pages exposed contradictions that were created by project configuration rather than by the host browser itself.

The goal is not to promise an undetectable browser. Modern detection can combine browser, protocol, network, session, and behavioral signals. Broad JavaScript spoofing also creates new inconsistencies and increases maintenance risk. Chromium documents unified Headless as the same browser code path without visible windows, and Playwright-compatible channels provide an explicit way to select Chrome or bundled Chromium: [Chrome Headless](https://developer.chrome.com/docs/chromium/headless), [Playwright browsers](https://playwright.dev/docs/browsers).

## Decision

- Keep true `headless:true`; do not add Xvfb or a hidden headed mode.
- Try system Chrome first for both headless and headed runs. Fall back to Patchright Chromium only when the preferred Chrome executable is explicitly missing; preserve every other launch error.
- Pass only `--enable-gpu` for headless launches so Chrome may use a real compatible renderer. Do not force an ANGLE/Vulkan backend, disable a GPU blocklist, or add this flag to headed launches.
- Derive a simplified Chrome UA from `browser.version()` and the host platform for headless Contexts. The Context option owns both HTTP and JavaScript UA.
- Fix headless viewport to `1902x984`, screen to `1920x1080`, DPR to `1`, locale to `zh-CN`, and timezone to `Asia/Shanghai`.
- Limit handwritten property changes to `outerWidth=1920`, `outerHeight=1080`, and `screen.availHeight=1050`. Wrap the native getters with `Proxy` and retain their descriptors.
- Keep headed Contexts natural with `viewport:null` and no UA, locale, timezone, DPR, screen, or init-script overrides.
- Bind the resolved mode, channel, browser version, and Context profile to the Browser with a WeakMap. Fresh consumer Contexts inherit it and may then add only their read-only storage state and source-fetch proxy.
- Do not patch webdriver, plugins, WebGL, Canvas, Audio, memory, Client Hints, languages, color depth, or GPU identity.
- Keep doctor focused on the required bundled Chromium runtime and login checks; do not turn it into an online fingerprint scorer.
- Treat Sannysoft WebGL Vendor/Renderer as a non-blocking compatibility warning for the system-Chrome path only when CDP reports `gl=none`/WebGL disabled, browser logs independently identify an EGL configuration failure, every other required check passes, and the bundled-Chromium path demonstrates a real hardware WebGL renderer. This is a narrow acceptance exception, not a general waiver.

## Consequences

- Browser configuration becomes deterministic and internally coherent, while the fallback remains usable on hosts without system Chrome.
- A missing or unsupported runtime version/platform now fails as `E_BROWSER_RUNTIME` instead of continuing with a guessed UA.
- System Chrome upgrades automatically change the UA major version, so browser-runtime tests and Linux acceptance must be rerun after runtime upgrades.
- The fixed profile is intentionally not randomized per account and does not guarantee future test-site results.
- Debian/Ubuntu x86_64 is the only production target promised for the four browser-focused sites: Sannysoft, Javabin, Passer-by, and Tools321. Windows and macOS remain development-compatible but carry no such promise.
- Software rendering that fails a target's GPU checks is an environment problem; this decision does not authorize WebGL/GPU spoofing. Bundled Chromium must still demonstrate a real hardware WebGL renderer for completion.
- `--enable-gpu` enables Chrome's normal hardware discovery; it does not guarantee that discovery succeeds. A GPU device visible to the OS or container is not sufficient by itself. An unclassified software renderer remains incomplete; the system-Chrome `gl=none`/EGL case may use only the narrow exception defined above.
- Ping0 combines browser, IP, DNS, CDN, and route-dependent signals. It may be recorded as a redacted observation, but page availability or its score is not a completion gate for this browser-runtime decision.
- The application does not unconditionally force Vulkan because hosts without a compatible Vulkan userspace can leave Chrome's GPU process spinning and prevent clean shutdown. The accepted system-Chrome compatibility warning does not justify forcing Vulkan, spoofing WebGL, or ignoring any other Sannysoft failure.

## Verification

Automated tests cover channel selection, strict fallback classification, dynamic UA, fixed Context parameters, headed natural mode, consumer inheritance, cleanup, and init-script ordering. A real local-browser integration test covers the main page, same-origin and opaque cross-origin iframes, a later page, and HTTP/JavaScript UA equality.

Completion additionally requires Debian/Ubuntu x86_64 validation for both system Chrome and bundled Chromium paths against the four required browser-focused sites. The bundled path must pass the selected WebGL checks with a real hardware renderer; the system-Chrome path may carry only the independently diagnosed `gl=none`/EGL WebGL exception above. Ping0 is optional observation only. Records may contain browser/system versions and redacted outcomes only; they must not contain IP addresses, cookies, account state, or sensitive screenshots.
