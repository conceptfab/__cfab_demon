# TIMEFLOW — LAN / Online HTTP Security Audit Roadmap

This document enumerates the HTTP endpoints exposed by the daemon for
LAN and online sync, and tracks whether each one has been reviewed
against the project's security expectations.

Review expectations (minimum bar for every endpoint):

1. **AuthN:** the request carries a bearer `secret` that matches the
   device's pairing record, unless the endpoint is explicitly in the
   unauthenticated allow-list (`/lan/ping`, `/lan/local-identity`,
   `/lan/pair`, `/lan/sync-progress`, `/online/sync-progress`,
   `/lan/paired-devices`, `/lan/generate-pairing-code`,
   `/lan/store-paired-device`, `/lan/remove-paired-device`,
   `/lan/trigger-sync`, `/online/trigger-sync`, `/online/cancel-sync`
   — see `src/lan_server.rs:~425`).
2. **AuthZ:** where the endpoint mutates DB state or triggers a sync,
   the caller's `device_id` must be in the paired list.
3. **Input hardening:** JSON bodies validated (sizes capped, strings
   length-limited, numbers clamped).
4. **Rate-limiting:** for endpoints that return secrets or can be
   brute-forced (`/lan/pair`).
5. **Information disclosure:** responses do not include the device
   secret unless the caller already proved pairing.
6. **Logging:** security-sensitive events emit `[LAN][SEC]` log lines.
7. **Error handling:** distinct status codes (`401`, `403`, `404`,
   `413`, `429`) without leaking internal errors.

## Endpoint matrix

| Method | Path                              | Purpose                                         | Released in | Reviewed? |
| :----- | :-------------------------------- | :---------------------------------------------- | :---------- | :-------- |
| GET    | `/lan/ping`                       | Liveness probe                                  |             | [ ]       |
| GET    | `/lan/local-identity`             | `device_id` + `machine_name` (no secret, P0)    |             | [ ]       |
| POST   | `/lan/pair`                       | Exchange pairing code for device secret (P0 throttled) |      | [ ]       |
| POST   | `/lan/generate-pairing-code`      | Issue a one-time pairing code                   |             | [ ]       |
| POST   | `/lan/store-paired-device`        | Record a new paired peer                        |             | [ ]       |
| POST   | `/lan/remove-paired-device`       | Remove a paired peer                            |             | [ ]       |
| GET    | `/lan/paired-devices`             | List paired peers                               |             | [ ]       |
| GET    | `/lan/sync-progress`              | Sync progress (percentage + phase)              |             | [ ]       |
| POST   | `/lan/preflight`                  | Pre-sync metadata exchange                      |             | [ ]       |
| POST   | `/lan/negotiate`                  | Negotiate sync params                           |             | [ ]       |
| POST   | `/lan/freeze-ack`                 | Acknowledge local DB freeze                     |             | [ ]       |
| POST   | `/lan/upload-db`                  | Upload full DB dump (sync body)                 |             | [ ]       |
| POST   | `/lan/upload-ack`                 | Acknowledge upload complete                     |             | [ ]       |
| POST   | `/lan/db-ready`                   | Signal that merged DB is ready                  |             | [ ]       |
| POST   | `/lan/unfreeze`                   | Release DB freeze after merge                   |             | [ ]       |
| POST   | `/lan/pull`                       | Pull remote DB dump                             |             | [ ]       |
| POST   | `/lan/trigger-sync`               | Request a LAN sync                              |             | [ ]       |
| GET    | `/online/sync-progress`           | Online-sync progress                            |             | [ ]       |
| POST   | `/online/trigger-sync`            | Request an online sync                          |             | [ ]       |
| POST   | `/online/cancel-sync`             | Cancel in-flight online sync                    |             | [ ]       |

## How to audit an endpoint

1. Look up the handler in `src/lan_server.rs` (`handle_<name>`).
2. Walk through the seven review expectations above. Confirm each
   one applies (or document why it doesn't).
3. Add a row to the corresponding commit / PR description summarising
   what was checked.
4. Tick the row above and fill in the release version from
   [`VERSION`](../VERSION).

## Recent security work

See [`CHANGELOG.md`](../CHANGELOG.md) → *P0 — Security*.

- Task 1: `/lan/local-identity` no longer returns the device secret.
- Task 2: `/lan/pair` is rate-limited per source IP.
- Task 22: `check_auto_unfreeze` no longer races with active syncs
  (prevents accidental unfreeze during merge).
- Task 8: `MERGE_MUTEX` + `db_frozen` guard prevent writes during
  merge.

## Known gaps

- Pairing secret is a long-lived bearer token; rotation flow is not
  documented (follow-up).
- No TLS on the LAN HTTP server — relies on the LAN being trusted.
  Add to the roadmap if LAN sync is ever exposed beyond a private
  subnet.
- `/online/trigger-sync` and `/online/cancel-sync` currently trust the
  UI-side pairing check — confirm end-to-end auth in a dedicated
  review pass.
