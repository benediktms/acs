## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Harness isolation

Application code SHALL depend on the harness-neutral runtime contract for runtime state, blocking reason, interactive presence, and observation time. Only the Codex adapter SHALL import generated app-server protocol types or translate Codex thread status and subscriber data.

#### Scenario: Protocol regeneration

- **WHEN** the pinned Codex protocol is regenerated
- **THEN** vendor-specific changes remain confined to the adapter boundary
