# Runtime delivery

## Purpose

Define the harness-neutral delivery boundary and safe Codex integration.
See `contracts/runtime-adapter.ts` for the typed implementation boundary.

## Requirements

### Requirement: Harness isolation

Application code SHALL depend on the harness-neutral runtime contract for runtime state, blocking reason, interactive presence, and observation time. Only the Codex adapter SHALL import generated app-server protocol types or translate Codex thread status and subscriber data.

#### Scenario: Protocol regeneration

- **WHEN** the pinned Codex protocol is regenerated
- **THEN** vendor-specific changes remain confined to the adapter boundary

### Requirement: Installation-scoped runtime routing

ACS SHALL route delivery, cancellation, reconciliation, and session inspection through the installation referenced by the binding. Failure of one installation SHALL not make another configured installation unavailable.

#### Scenario: One account is offline

- **WHEN** an account app-server is unavailable while another is ready
- **THEN** deliveries for the unavailable account defer according to normal policy
- **AND** deliveries for the ready account continue

### Requirement: Untrusted peer provenance

ACS SHALL deliver peer content as named tool output with untrusted peer
provenance. It SHALL NOT forge user, developer, or system messages or treat
peer content as permission to act.

#### Scenario: Peer requests privileged action

- **WHEN** a peer message contains instructions requesting permission or approval
- **THEN** the content remains untrusted and ACS grants no permission

### Requirement: Capability and policy controlled wake

Context-only delivery SHALL be supported. Codex wake SHALL require explicit
per-binding non-atomic opt-in while no atomic named tool-output queue primitive
is available. Mutations SHALL honor current binding fences.

#### Scenario: Default wake policy

- **WHEN** a wake is requested without an atomic capability or per-binding opt-in
- **THEN** ACS refuses the unsafe wake

### Requirement: Ambiguous acceptance is not blindly retried

A flushed request whose response is lost SHALL enter `acceptance-unknown`.
ACS SHALL reconcile acceptance only from authoritative evidence; an exact
named wake delivery marker can recover its owning turn. A missing marker
SHALL remain inconclusive and require audited operator resolution.

#### Scenario: Context-only delivery has no history marker

- **WHEN** reconciliation finds no authoritative evidence for an ambiguous injection
- **THEN** ACS does not automatically resend it

### Requirement: Local approvals and owned cancellation

ACS SHALL leave permission and user-input responses to the local owner and
SHALL interrupt only executions created and correlated by ACS.

#### Scenario: Fanned-out user-input request

- **WHEN** Codex sends ACS a request for local user input
- **THEN** ACS records the wait without answering the request

#### Scenario: Unrelated active turn

- **WHEN** cancellation would affect a turn not owned by ACS
- **THEN** ACS does not interrupt that turn

### Requirement: Runtime adapters report authoritative agent observations

The runtime contract SHALL report a harness-neutral observation containing runtime state, blocking reason, interactive-subscriber presence, and observation time for each bound session. Application code SHALL derive agent state only from that normalized observation. An adapter SHALL report an unavailable dimension as `unknown` rather than infer it from process existence, loaded state, prompts, transcripts, activity publication, or elapsed time.

#### Scenario: Adapter observes a bound session

- **WHEN** a runtime adapter refreshes a bound session
- **THEN** it reports normalized runtime state, blocking reason, interactive presence, and observation time

#### Scenario: Presence is not supported

- **WHEN** a harness cannot distinguish interactive subscribers authoritatively
- **THEN** its adapter reports interactive presence as `unknown`

### Requirement: Codex presence distinguishes owners from observers

The Codex adapter SHALL consume app-server data that distinguishes interactive subscribers from observer or service subscribers. The ACS-managed app-server connection SHALL identify itself as non-interactive and MUST NOT keep a logical agent present merely by observing its thread. Codex thread reads and presence-change notifications SHALL provide a fresh interactive-subscriber presence value for reconciliation.

#### Scenario: User closes the Codex session

- **WHEN** the last interactive subscriber leaves a bound Codex thread while the ACS observer remains connected
- **THEN** app-server reports no interactive subscriber and ACS can derive the agent as `offline`

#### Scenario: User reopens the Codex session

- **WHEN** an interactive subscriber joins a bound Codex thread
- **THEN** app-server reports interactive presence and ACS reconciles the agent from the current thread status

#### Scenario: ACS reconnects to app-server

- **WHEN** the Codex adapter reconnects after missing notifications
- **THEN** it refreshes thread status and interactive presence before publishing a current observation
