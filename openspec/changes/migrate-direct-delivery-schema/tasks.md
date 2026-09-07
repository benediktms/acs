## 1. Persisted Schema Upgrade

- [x] 1.1 Add an ordered startup migration runner that preserves legacy delivery intents, runtime executions, and their current schema fields; verify with the targeted legacy-upgrade cases in `tests/storage.test.ts`.
- [x] 1.2 Cover fresh-database and repeated-startup idempotency in `tests/storage.test.ts`, then run only that test file.

## 2. Correlated Failure Diagnostics

- [x] 2.1 Report unexpected A2A application errors with the same correlation identifier returned in the sanitized response, wire the daemon structured logger, and verify with targeted cases in `tests/a2a.test.ts`.

## 3. Validation

- [x] 3.1 Run type checking, linting, formatting checks, `git diff --check`, and strict OpenSpec validation without running the full test suite.
