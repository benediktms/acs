## ADDED Requirements

### Requirement: Explicit account configuration

ACS SHALL use only explicitly configured Codex account homes. Each enabled account SHALL have a unique label and canonical home path, and ACS SHALL derive a non-configurable owner-only Unix socket from that home.

#### Scenario: Duplicate account identity

- **WHEN** two configured accounts use the same label or canonical home
- **THEN** configuration loading fails before ACS starts

### Requirement: Explicit managed launcher

ACS SHALL provide a `swarm` executable that routes interactive new, resume, and fork sessions through the managed app-server for the configured account selected by `CODEX_HOME`. ACS SHALL leave the native `codex` executable and shell command unchanged, and `swarm` SHALL fail without falling back to a standalone session when managed routing is unavailable.

#### Scenario: Managed interactive session

- **WHEN** `swarm`, `swarm resume`, or `swarm fork` runs with a configured `CODEX_HOME` and available app-server
- **THEN** it invokes Codex through that account's managed Unix socket and preserves the requested session arguments

#### Scenario: Native Codex remains native

- **WHEN** ACS is initialized and the operator invokes `codex`, `codex exec`, or `codex review`
- **THEN** the native Codex executable handles the command without ACS shell interception

#### Scenario: Unsupported swarm command

- **WHEN** the operator invokes `swarm exec`, `swarm review`, or another non-interactive Codex subcommand
- **THEN** `swarm` rejects the command and directs the operator to invoke it with `codex`

#### Scenario: Unconfigured home

- **WHEN** `swarm` runs with an unconfigured `CODEX_HOME` or unavailable managed app-server
- **THEN** it fails with remediation and does not silently fall back to standalone Codex
