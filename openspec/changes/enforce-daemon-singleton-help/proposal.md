## Why

ACS daemon ownership is currently inferred from a non-atomic control-socket probe, so concurrent starts can create two same-home daemons and let one remove the other's socket. CLI help is also dispatched after configuration setup, allowing commands such as `acs init --help` to mutate local state.

## What Changes

- Enforce one live daemon per ACS home with an operating-system-held lock covering startup, serving, and cleanup.
- Make daemon handover, crash recovery, and stale-socket cleanup ownership-safe while preserving independent ACS homes.
- Dispatch ACS help before configuration migration, storage access, or service operations, while preserving arguments after the `acs codex run --` boundary.
- Add compiled-binary regressions for concurrent startup, handover and recovery, side-effect-free help, passthrough, and MCP stdin EOF.
- Exclude Codex app-server thread unloading and MCP-runtime replacement from ACS daemon ownership; ACS will not add an inactivity reaper or parent-process watchdog.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-service`: Define exclusive daemon ownership, ownership-safe cleanup and handover, and side-effect-free CLI help behavior.

## Impact

- Affects the ACS CLI/daemon entry point, macOS service handover, and compiled-binary packaging tests.
- Adds no CLI or process-supervision dependency; the broader CLI-library migration is tracked separately in issue #52.
- Does not change A2A, control-protocol, storage-schema, or Codex runtime contracts.
