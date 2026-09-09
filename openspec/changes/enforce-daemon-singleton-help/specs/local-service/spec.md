## ADDED Requirements

### Requirement: Exclusive daemon ownership

ACS SHALL hold one operating-system-enforced exclusive ownership lock per configured ACS home before opening durable storage or binding the A2A and control listeners. The daemon SHALL retain ownership through listener and storage shutdown, and only the owner SHALL remove stale or active control-socket artifacts.

#### Scenario: Concurrent starts for one ACS home

- **WHEN** two daemon processes start concurrently for the same ACS home, including with different A2A listener ports
- **THEN** exactly one process becomes the live daemon
- **AND** each loser exits with a stable, actionable already-running error
- **AND** a loser does not remove or disrupt the winner's listeners or control socket

#### Scenario: Managed daemon handover

- **WHEN** the macOS service restarts a daemon
- **THEN** startup waits boundedly for the previous daemon to release ownership before binding replacement listeners
- **AND** failure to obtain ownership leaves no second daemon running

#### Scenario: Recovery after a crash

- **WHEN** the owning daemon terminates without normal cleanup
- **THEN** the operating system releases its ownership lock
- **AND** the next daemon start recovers stale control-socket artifacts while it holds ownership

#### Scenario: Independent ACS homes

- **WHEN** daemons use different ACS homes and non-conflicting listeners
- **THEN** they can hold ownership and run concurrently

### Requirement: Side-effect-free CLI help

ACS SHALL dispatch recognized help invocations before configuration migration, file initialization, storage access, network connection, or service mutation. Help SHALL exit successfully, and the usage text SHALL distinguish foreground daemon execution from macOS LaunchAgent lifecycle commands.

#### Scenario: Top-level help

- **WHEN** an operator runs `acs`, `acs help`, `acs -h`, or `acs --help`
- **THEN** ACS prints usage and exits with status 0 without changing local state

#### Scenario: Initialization help

- **WHEN** an operator runs `acs init -h` or `acs init --help`
- **THEN** ACS prints usage and exits with status 0 without creating or migrating files or installing, removing, or restarting services

#### Scenario: Wrapped command help passthrough

- **WHEN** an operator runs `acs codex run -- --help`
- **THEN** ACS passes `--help` to Codex instead of consuming it as ACS help

### Requirement: MCP bridge transport lifetime

The ACS MCP bridge SHALL exit promptly when its stdio input reaches EOF and SHALL NOT treat ordinary message inactivity as a disconnected transport.

#### Scenario: Stdio owner closes input

- **WHEN** the process that owns an ACS MCP bridge closes the bridge's stdin writer
- **THEN** the bridge exits within a bounded interval

#### Scenario: Healthy idle bridge

- **WHEN** a bridge's stdin remains open without messages
- **THEN** ACS does not terminate the bridge solely because it is idle
