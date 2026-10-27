# ADR 0003: Reintroduce an explicit resident daemon for the console

## Status

Accepted — 2026-10-28

## Context

The original merchant auth daemon (removed in `aecc0ae`) only refreshed sessions on a timer. Session lifetime did not improve, and it added a background process that ordinary commands depended on. AGENTS.md then forbade any auth daemon or automatic background launch.

Task tree `10-27-password-relogin-console` changed the problem. Merchant sessions still expire within days. Implicit password relogin (task ③) recovers many of them. Every challenge (SMS, slider, risk page) needs a human. The CLI is driven by an LLM agent over Telegram (Hermes), and nothing sent there should be a password or an SMS code. A real-account experiment also showed that the password submit itself sends the SMS, and that device trust needs one human SMS pass on the same device state.

So a human-only channel is required. It must stay up longer than one command, hold a browser while a person works through a challenge, and accept passwords without passing them through the chat or the CLI.

## Decision

- Add an explicit `pdd daemon start / stop / status / run`. The daemon hosts a `node:http` web console, interactive relogin with CDP screen takeover, and the QR fallback. Patrol is optional and off by default.
- The daemon backgrounds itself (`detached` + `windowsHide`, `unref()`). There is no boot autostart, no OS service template and no pidfile.
- Single instance via a SQLite lease (`scope='daemon'`) judged by heartbeat (30 s beat, 90 s TTL), even on the same host with a live pid. Stop goes through a DB request; force-kill happens only for a same-host lease whose heartbeat is still fresh.
- Ordinary commands, login and doctor never start or depend on the daemon. When the account has open pending actions and the daemon is not running, they append `daemon_not_running`.
- Console access uses a one-time 10-minute link from `pdd console link`. The page redeems the token with a scripted POST (so chat link previews cannot consume it) and receives an 8-hour HttpOnly SameSite=Strict session cookie. Tokens and sessions are stored only as hashes. The server checks the Host header, requires JSON plus `X-PDD-Console: 1` on state changes, serves a strict CSP and returns only whitelisted views.
- The console listens on `127.0.0.1:47821` by default. A LAN address is allowed with a plaintext warning. TLS stays outside the CLI (nginx/Caddy, `consolePublicUrl`).
- Patrol, when enabled, reuses the ordinary command check path (browser-selected cookies). It adds no Node-only probe rhythm, pending the session-lifetime research (task ⑤).
- Logs go to `log/daemon/YYYY-MM-DD.log` with the existing redaction.

## Consequences

- The AGENTS.md rule "Do not introduce an auth daemon or automatic background launch" is replaced by "ordinary commands never launch or depend on a background process; the daemon is started explicitly".
- After a reboot or a host restart the daemon must be started again. Agents learn this from `daemon_not_running` and `E_DAEMON_NOT_RUNNING`.
- Schema v2 (`console_tokens`, `console_sessions`) cannot be opened by older binaries.
- An interactive session holds the account lease for up to 12 minutes; other commands on that account fail fast with `E_LOCK_TIMEOUT` meanwhile.
- The console is a single-user tool for the OS user that owns the data directory. A session can manage every account. It defends against accidental exposure, not against local processes of the same user.
- Still unverified and recorded in the task: whether PDD accepts touch traces replayed as mouse events on sliders, SSE latency, whether a systemd-managed host kills the detached daemon, and whether Chromium survives a killed node process.

## Verification

- Fixture e2e: single instance, lease expiry after kill, link redemption and replay, write-only passwords, challenge → takeover → success → pending action resolved → ordinary command succeeds, takeover timeouts → breaker, QR mode, patrol on/off.
- Manual fixture walkthrough of the console in a real browser (list, password save, takeover view, cancel, QR view).
