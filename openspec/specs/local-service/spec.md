# Local service

## Purpose

Define the ACS executable, configuration, and local service lifecycle.

## Requirements

### Requirement: Standalone local daemon

ACS SHALL build a standalone `acs` binary, persist state with SQLite, expose
versioned authenticated JSON-RPC over an owner-only Unix socket, and restrict
its A2A listener to loopback addresses.

#### Scenario: Default startup

- **WHEN** the operator initializes ACS and starts the daemon with default settings
- **THEN** A2A listens on `127.0.0.1:7432` and administration requires a valid scoped bearer token

### Requirement: Persistent macOS service

On macOS, `acs init` SHALL install a login service named `local.acs.daemon`, log
to `~/Library/Logs/acs.log`, and register the Codex MCP bridge using the same
runtime paths. Persisted path overrides SHALL be absolute. `--no-service`
SHALL initialize files without installing the service or MCP registration.
The LaunchAgent's `ProgramArguments` SHALL invoke `acs daemon run`; that command
is the foreground daemon. `acs daemon start` SHALL bootstrap an installed,
unloaded LaunchAgent and wait for authenticated control readiness without
restarting an already loaded healthy service. `acs daemon stop` SHALL boot out
the supervisor before a bounded shutdown wait, using authenticated shutdown only
for an unmanaged foreground daemon. Start and stop SHALL be idempotent, and
restart SHALL stop then start. These lifecycle commands SHALL NOT mutate
per-account Codex app-server services.

#### Scenario: Service status

- **WHEN** an operator runs `acs daemon status`
- **THEN** it performs no lifecycle mutation and prints `control-ready` with exit 0
  when authenticated control is ready, including an unmanaged foreground daemon
- **AND** it prints `stopped` with exit 1 when neither control nor supervisor is running
- **AND** it prints `supervisor-running/control-unavailable` with exit 2 when the
  LaunchAgent is running but authenticated control is unavailable

#### Scenario: Non-macOS lifecycle operations

- **WHEN** an operator runs a daemon lifecycle command other than `run` outside macOS
- **THEN** ACS directs the operator to run `acs daemon run` under their service manager

#### Scenario: Rename an existing service

- **WHEN** `acs init` finds the legacy `local.asc.daemon` service
- **THEN** it unloads that service and removes its legacy plist before starting the ACS service
- **AND** it aborts if unloading fails

#### Scenario: Reinstall after rebuilding or moving the checkout

- **WHEN** the operator reruns `acs init` from the rebuilt executable
- **THEN** registration uses that executable and the service is restarted even if the plist contents match

#### Scenario: Existing foreground daemon

- **WHEN** initialization needs to replace an unmanaged daemon
- **THEN** it requests shutdown before bootstrapping the service

### Requirement: Reproducible development tools

The repository SHALL pin development tools in `mise.toml`, direct JavaScript
packages in `package.json`, transitive packages in `bun.lock`, and the A2A TCK
revision in `conformance/a2a-tck-revision.txt`.

#### Scenario: Fresh checkout

- **WHEN** a developer installs the mise tools and runs `bun install --frozen-lockfile`
- **THEN** the selected tools and packages use the repository's pinned versions

### Requirement: Compatible persisted-state upgrades

ACS SHALL upgrade a supported older database schema before accepting requests, preserve its durable agents, bindings, tasks, messages, events, and delivery records, and record each schema migration exactly once.

#### Scenario: Legacy delivery schema starts on a current binary

- **WHEN** ACS starts with a database whose delivery intents use the supported legacy delivery-mode constraint
- **THEN** ACS upgrades those intents to the direct-delivery schema without deleting durable state
- **AND** authenticated message submission succeeds after startup

#### Scenario: Migration is retried

- **WHEN** ACS starts again after a schema migration was recorded successfully
- **THEN** ACS does not apply that migration again

#### Scenario: Migration fails

- **WHEN** a required schema migration cannot complete atomically
- **THEN** ACS fails startup without accepting requests or leaving a partially migrated schema

### Requirement: Correlated internal failure logging

ACS SHALL keep unexpected A2A application failures sanitized in public responses while recording the underlying failure in the daemon log with the same correlation identifier.

#### Scenario: Unexpected message-acceptance failure

- **WHEN** message acceptance raises an unexpected internal error
- **THEN** the caller receives a retryable sanitized error with a correlation identifier
- **AND** the daemon log records that correlation identifier and the underlying error
