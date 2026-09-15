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

### Requirement: Structured command-line interface

The ACS executable SHALL expose its existing command tree through consistent root, group, and command-level help. It SHALL validate commands, positional arguments, and options before loading configuration, opening storage, connecting to sockets, or performing service operations, while preserving established successful command output and exit behavior.

#### Scenario: Help at every command level

- **WHEN** an operator invokes the root command, a command group, or a leaf command with `-h` or `--help`
- **THEN** ACS prints help for that command level and exits successfully
- **AND** it creates, migrates, or modifies no ACS state

#### Scenario: Explicit help command

- **WHEN** an operator invokes `acs help` followed by a valid command path
- **THEN** ACS prints help for that command path and exits successfully
- **AND** it creates, migrates, or modifies no ACS state

#### Scenario: Invalid command input

- **WHEN** an operator supplies an unknown command, a missing required argument, or an invalid option
- **THEN** ACS prints a consistent usage error for the relevant command and exits non-zero
- **AND** it does not execute the requested command handler

#### Scenario: Codex argument passthrough

- **WHEN** an operator invokes `acs codex run --` followed by arguments including `--help`
- **THEN** ACS preserves the order and values of every argument after the literal `--` boundary when launching Codex
- **AND** ACS does not consume the passed `--help` as its own help option

#### Scenario: Managed Codex route

- **WHEN** `acs codex run --` launches Codex for a configured `CODEX_HOME`
- **THEN** ACS connects Codex to that account's managed app-server socket
- **AND** ACS supplies the current directory unless the operator passed `-C` or `--cd`
- **AND** ACS rejects an operator-supplied `--remote` option because ACS owns the managed route

#### Scenario: Obsolete launcher cleanup

- **WHEN** `acs init` finds an ACS-owned `swarm` executable from an earlier release
- **THEN** ACS removes that executable without installing a replacement
- **AND** it removes the legacy ACS zsh integration while preserving unrelated shell startup content
- **AND** it leaves an unrelated command at the same path unchanged

### Requirement: Persistent macOS service

On macOS, `acs init` SHALL install a login service named `local.acs.daemon`, log
to daily files in `~/Library/Logs/acs/`, retaining seven days and the most
recent 10 MiB of each daily file, register the Codex MCP bridge using the same runtime
paths, and install one `local.acs.codex-app-server.<label>` LaunchAgent for every
configured Codex account. Each app-server service SHALL run with `CODEX_HOME` set
to its configured canonical home, `Umask` 077, `KeepAlive`, `RunAtLoad`, and a
4096 soft file-descriptor limit. Persisted path overrides SHALL be absolute.
`--no-service` SHALL initialize files without installing the service or MCP
registration. Initialization SHALL not restart a healthy unchanged app-server.
The LaunchAgent's `ProgramArguments` SHALL invoke `acs daemon run`; that command
is the foreground daemon. `acs daemon start` SHALL bootstrap an installed,
unloaded LaunchAgent and wait for authenticated control readiness without
restarting an already loaded healthy service. `acs daemon stop` SHALL boot out the
supervisor before a bounded shutdown wait, using authenticated shutdown only for
an unmanaged foreground daemon. Start and stop SHALL be idempotent, and restart
SHALL stop then start. These lifecycle commands SHALL NOT mutate per-account
Codex app-server services.

#### Scenario: Account service installation

- **WHEN** an operator initializes ACS with two configured accounts
- **THEN** exactly two account-scoped app-server service definitions are installed
- **AND** each service listens only on its derived account socket

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
- **THEN** registration uses that executable and the ACS service is restarted even if its plist contents match

#### Scenario: Existing foreground daemon

- **WHEN** initialization needs to replace an unmanaged ACS daemon
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

### Requirement: Local operators can create managed Codex workers

The CLI SHALL provide `acs codex workers create <agent>` for a local user to create one persistent Codex worker thread for an existing enabled logical agent with no active binding. The command SHALL accept an optional configured account label and an optional absolute existing working directory, defaulting to the invoking CLI's current directory. It SHALL validate the command, agent, binding state, account route, runtime capability, and working directory before requesting thread creation. It SHALL preserve the configured Codex approval and sandbox policy. The neutral runtime thread-start SHALL start no model turn or task; after confirmed thread creation, the control operation SHALL atomically accept exactly one readiness task/delivery receipt with the binding and success audit. The command SHALL not attach a TUI automatically.

#### Scenario: Managed worker creation succeeds

- **WHEN** a local user creates a worker for an enabled unbound agent on a ready compatible configured account
- **THEN** ACS creates one persistent thread, atomically commits one active managed binding receipt and exactly one asynchronous readiness task/delivery receipt in `submitted` state, and reports the agent and diagnostic binding identity without waiting for or claiming readiness or attaching a client

#### Scenario: Working directory is omitted

- **WHEN** a local user omits `--cwd`
- **THEN** ACS uses the CLI process's absolute current directory for thread creation

#### Scenario: Creation input is invalid

- **WHEN** the agent is missing, disabled, already bound, the account is unknown, the runtime lacks the capability, or `--cwd` is relative or does not exist
- **THEN** ACS rejects the request before runtime thread creation and creates no binding

#### Scenario: Same-daemon creation is already reserved

- **WHEN** another managed creation has reserved the same enabled unbound agent and one target delivery slot before runtime I/O
- **THEN** ACS rejects a competing create, bind/rebind, claim consumption, disable, delete, or last-slot message admission without runtime I/O or local mutation; it releases the reservation on every definite, exceptional, ambiguous, and successful outcome

#### Scenario: Caller is not a local user

- **WHEN** a bound agent, service, or external A2A principal invokes the managed-create control operation
- **THEN** ACS rejects it without runtime or binding mutation

#### Scenario: Creation outcome is ambiguous

- **WHEN** ACS cannot prove both the created thread identity and successful managed binding commit
- **THEN** the command reports `RUNTIME_AMBIGUOUS` with actionable no-blind-retry guidance and does not claim success

#### Scenario: Local transaction fails after thread creation

- **WHEN** persistent thread creation succeeds but the local binding and readiness-task transaction cannot commit
- **THEN** ACS rolls back all local rows, reports `RUNTIME_AMBIGUOUS` with the strongest known installation and thread evidence, and does not delete, adopt, or retry the thread

### Requirement: Local operators can attach to a managed worker by agent

The CLI SHALL provide `acs codex workers attach <agent>` and internally resolve exactly one current active managed binding for that logical agent. Before launching, it SHALL reject missing, attached, revoked, or ambiguous binding ownership; verify the receipt's installation still maps to the same configured account home and derived listening socket recorded by the daemon; and use the exact opaque thread identifier. A successful attach SHALL launch the native Codex TUI with the recorded `CODEX_HOME`, exact remote Unix socket, inherited terminal I/O, hook-trust bypass required by the existing managed launcher, and `resume` for the recorded thread, without an initial prompt or approval or sandbox override.

#### Scenario: Operator attaches by agent

- **WHEN** an agent resolves to exactly one current active managed binding on its matching available configured installation
- **THEN** ACS launches native Codex to resume that binding's exact thread with inherited stdin, stdout, and stderr

#### Scenario: Agent has an attached binding

- **WHEN** the requested agent's current binding is `attached`
- **THEN** ACS rejects the attach command before spawning Codex

#### Scenario: Agent has no current managed binding

- **WHEN** the requested agent is missing or has only a revoked or otherwise inactive managed binding
- **THEN** ACS rejects the attach command before spawning Codex and does not guess from historical threads

#### Scenario: Managed binding resolution is ambiguous

- **WHEN** durable state cannot identify exactly one current active managed binding for the requested agent
- **THEN** ACS fails closed and reports diagnostic binding evidence without launching a client

#### Scenario: Recorded endpoint drifted

- **WHEN** the current account home or derived socket does not match the binding's recorded installation, or that socket is not listening
- **THEN** ACS rejects attachment without selecting another account or spawning Codex

#### Scenario: Native client exits

- **WHEN** the attached native Codex process exits
- **THEN** ACS preserves the managed binding and performs no stop, revoke, interrupt, ownership transfer, or durable detach mutation

### Requirement: Worker help and detach guidance are side-effect-free

Managed-worker help and pre-attach guidance SHALL distinguish native detach from interrupt. Help and invalid command syntax SHALL be handled before configuration, storage, network, runtime, or service mutation. Before a successful attach launch, ACS SHALL state that Ctrl+D with an empty composer, `/exit`, or `/quit` detaches, while Ctrl+C interrupts active work.

#### Scenario: Worker help is requested

- **WHEN** an operator requests help for `acs codex workers`, `create`, or `attach`
- **THEN** ACS prints the relevant syntax and exits successfully without changing files, storage, services, bindings, or runtime threads

#### Scenario: Attach guidance is shown

- **WHEN** ACS has validated a managed binding and is about to launch native Codex
- **THEN** it prints the detach and interrupt distinction before handing terminal I/O to the child

#### Scenario: Operator detaches cleanly

- **WHEN** the pinned native client exits through Ctrl+D with an empty composer, `/exit`, or `/quit` and operator certification observes unsubscribe without turn interruption
- **THEN** ACS describes the action as detach and preserves background ownership and observation

#### Scenario: Operator presses Ctrl+C during work

- **WHEN** operator certification observes Ctrl+C interrupt an active native turn
- **THEN** ACS documentation describes Ctrl+C as interrupt rather than detach
