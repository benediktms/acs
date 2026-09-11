## Why

Existing ACS databases created before direct delivery retain a legacy SQLite constraint that rejects every new delivery intent and lack the execution-relationship field needed after runtime acceptance. Updating the installed binary must not leave durable messaging unusable or require deleting registered agents and task history.

## What Changes

- Add forward database migrations for the legacy delivery-mode constraint and runtime-execution schema.
- Preserve existing tasks, messages, delivery records, registrations, and bindings while upgrading.
- Record applied schema versions so startup upgrades are idempotent.
- Log unexpected A2A application failures with their correlation identifier while keeping public errors sanitized.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-service`: Require compatible persisted-state upgrades when a newer ACS binary starts against an older supported database.

## Impact

- Changes SQLite initialization and migration handling in `packages/storage-sqlite` and `storage/`.
- Adds focused storage upgrade and A2A error-observability tests.
- Does not change the public A2A or control protocol and adds no dependency.
