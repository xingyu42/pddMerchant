# Workbench 30-day auto-login dynamic capture

## Boundary

- Each run starts in a fresh Windows Sandbox.
- The signed `3.7.0.14` sample is mapped read-only and copied inside the sandbox before launch.
- `redacted/` contains only registry metadata, file metadata/hashes, process names, and command-line switch names.
- `raw-sensitive/` may contain ETL, PCAPNG, TLS key material, and a narrowly selected local-auth artifact copy. Keep it local and ignored; never paste it into logs, issues, or chat.
- The artifact copy runs only after the first full Workbench shutdown. Public output records only redacted paths, lengths, hashes, and copy status; file contents stay under `raw-sensitive/`.
- No existing host Workbench profile, registry key, Cookie, account registry, or merchant auth state is read.

## Runs

1. Open `sandbox-checked.wsb`, leave the 30-day checkbox selected, then scan.
   Approve the administrator prompt first; it starts PktMon before Workbench opens.
2. After the merchant home page is stable, run `1-Relaunch-Workbench` from the sandbox desktop.
3. Record only whether restart restored the account without another scan, then run `2-Finish-Capture`.
   Approve its administrator prompt so the traces can be stopped and converted.
4. Close the sandbox and repeat from a fresh instance with `sandbox-unchecked.wsb`, clearing the checkbox before scanning.

The host must be restarted once after enabling Windows Sandbox before these files can run.
