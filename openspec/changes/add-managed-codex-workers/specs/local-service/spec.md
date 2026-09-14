## ADDED Requirements

### Requirement: Local operators can create managed Codex workers

The CLI SHALL provide `acs codex workers create <agent>` for a local user to create one persistent Codex worker thread for an existing enabled logical agent with no active binding. The command SHALL accept an optional configured account label and an optional absolute existing working directory, defaulting to the invoking CLI's current directory. It SHALL validate the command, agent, binding state, account route, runtime capability, and working directory before requesting thread creation. It SHALL preserve the configured Codex approval and sandbox policy, start no model turn or task, and attach no TUI automatically.

#### Scenario: Managed worker creation succeeds

- **WHEN** a local user creates a worker for an enabled unbound agent on a ready compatible configured account
- **THEN** ACS creates one persistent thread, commits one active managed binding receipt, and reports the agent and diagnostic binding identity without starting work or attaching a client

#### Scenario: Working directory is omitted

- **WHEN** a local user omits `--cwd`
- **THEN** ACS uses the CLI process's absolute current directory for thread creation

#### Scenario: Creation input is invalid

- **WHEN** the agent is missing, disabled, already bound, the account is unknown, the runtime lacks the capability, or `--cwd` is relative or does not exist
- **THEN** ACS rejects the request before runtime thread creation and creates no binding

#### Scenario: Caller is not a local user

- **WHEN** a bound agent, service, or external A2A principal invokes the managed-create control operation
- **THEN** ACS rejects it without runtime or binding mutation

#### Scenario: Creation outcome is ambiguous

- **WHEN** ACS cannot prove both the created thread identity and successful managed binding commit
- **THEN** the command reports `RUNTIME_AMBIGUOUS` with actionable no-blind-retry guidance and does not claim success

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
