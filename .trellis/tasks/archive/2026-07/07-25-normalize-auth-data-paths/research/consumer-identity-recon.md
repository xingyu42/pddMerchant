# Consumer Identity Recon

## Method

- Loaded the existing consumer storage state without writing it.
- Opened `https://mobile.yangkeduo.com/` in the repository browser runtime.
- Inspected response field names and value shapes only.
- Did not print cookies, tokens, raw nickname, raw phone, avatar URL, or storage values.

## Result

- The stale auth state first redirected to `/login.html`.
- After an interactive consumer login refreshed the state, the home page loaded successfully.
- The home page issued `GET /proxy/api/api/apollo/v3/user/me` with HTTP 200.
- The response contains top-level `uid`, `nickname`, and `avatar` fields.
- `uid` is numeric and is the preferred stable identity key.
- `nickname` is a string and is the preferred human-readable directory label after privacy and filesystem normalization.
- `avatar` is not required for path selection and must not be logged.

## Design Consequences

- Consumer identity probing can happen after login succeeds and before the browser context closes.
- Directory collision and rename handling should use stable `uid`, not only `nickname`.
- A nickname that resembles a phone number must not be written to logs or command output unchanged.
- Identity probe failure must not silently assign the login state to an unrelated account.
