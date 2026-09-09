## Why

ACS hand-parses `Bun.argv` in the executable entry point, interleaving command discovery, validation, resource loading, and execution. This produces inconsistent nested help and makes it too easy for parsing-only requests to trigger stateful setup.

## What Changes

- Record a compiled-Bun spike of maintained TypeScript CLI libraries and its selection criteria.
- Define the existing ACS command tree directly with the selected library, without an ACS-specific parser layer.
- Dispatch generated help and usage errors before configuration, storage, socket, or service work.
- Preserve command names, options, JSON output, and exit behavior while making `acs codex run --` the single Codex launch boundary.
- Make `acs codex run --` the single managed interactive-launch command, including socket selection, current-directory propagation, and Codex argument passthrough.
- Stop installing a `swarm` executable, remove ACS-owned copies during initialization, and document an optional user-owned `alias swarm='acs codex run --'`.
- Keep development validation isolated from installed ACS and Codex services.
- Remove superseded hand-written argument and dispatch helpers.
- Extend compiled-executable coverage for nested help, usage failures, and passthrough.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `local-service`: Define consistent command-level help and usage behavior for the standalone ACS executable without stateful side effects.

## Impact

The compiled CLI entry point, obsolete launcher cleanup, packaging and service tests, A2A TCK setup, direct dependency inventory, lockfile, third-party notices, and operator documentation change. Daemon, control protocol, storage, and installed Codex lifecycle behavior remain unchanged.
