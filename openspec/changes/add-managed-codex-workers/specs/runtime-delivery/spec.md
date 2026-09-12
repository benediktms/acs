## ADDED Requirements

### Requirement: Managed delivery may recover only the owned thread

Runtime delivery SHALL carry the current binding control class. If a fenced managed target is not loaded, its owning adapter MAY perform at most one resume of the exact opaque thread on the binding's recorded installation during that delivery attempt, then SHALL obtain a fresh observation and apply every existing delivery gate before mutation. ACS SHALL NOT resume attached targets, foreign installations, stale or revoked bindings, or every managed worker proactively after reconnect.

#### Scenario: Detached managed worker remains loaded

- **WHEN** a managed target is loaded and safely accepts direct input but has no interactive subscriber
- **THEN** ACS may deliver through the existing direct-input path without requiring an operator attachment

#### Scenario: Managed worker is unloaded

- **WHEN** a delivery targets an unloaded managed thread on its recorded compatible installation and its binding fence is current
- **THEN** the adapter resumes that exact thread at most once, re-inspects it, and delivers only if the fresh state passes the existing gates

#### Scenario: Attached target is unloaded

- **WHEN** a delivery targets an unloaded attached thread
- **THEN** ACS defers delivery and does not call the runtime resume operation

#### Scenario: Managed fence is stale

- **WHEN** a managed binding is missing, revoked, replaced, or at a different epoch immediately before resume or delivery
- **THEN** ACS performs no further runtime mutation for that attempt

#### Scenario: Recorded installation differs from adapter route

- **WHEN** a managed delivery reaches an adapter other than the binding's recorded installation
- **THEN** ACS defers or rejects the route without searching another account or resuming the thread elsewhere

#### Scenario: Resume cannot find the thread

- **WHEN** the recorded installation definitively cannot resume the managed thread
- **THEN** ACS leaves delivery undelivered, preserves the managed ownership receipt, and does not adopt, recreate, or delete a thread

#### Scenario: App-server reconnects

- **WHEN** an owning app-server reconnects while managed workers have pending deliveries
- **THEN** ACS refreshes observations and permits delivery-scoped recovery without proactively waking every managed worker

### Requirement: Readiness delivery is narrowly authorized

The readiness task SHALL be deliverable only when its task and delivery receipt are scoped to the exact current managed binding and epoch, and carry `principalKind: local-user`, `workAuthority: local-bootstrap`, and `purpose: managed-worker-readiness`. Unmarked or mismatched local-user work SHALL remain terminal `unsupported`; public A2A work remains rejected. All existing runtime fences and prompt-ownership gates continue to apply.

#### Scenario: Readiness receipt matches its binding

- **WHEN** a submitted readiness task has the exact managed binding and current epoch plus the required provenance fields
- **THEN** ACS may deliver it subject to the existing runtime observation, installation, and prompt-ownership gates

#### Scenario: Readiness provenance or fence mismatches

- **WHEN** readiness work is unmarked, has mismatched binding or epoch, or uses another principal, authority, or purpose
- **THEN** ACS marks it terminal `unsupported` and performs no runtime mutation

### Requirement: Managed prompts remain locally owned

ACS SHALL observe and expose managed-worker approval, authentication, and user-input waits, but SHALL NOT answer, deny, bypass, or synthesize local user input for them. Delivery SHALL remain deferred while the block is present and may continue only after a fresh runtime observation proves that the local block has cleared. Attach or detach SHALL NOT authorize `turn/interrupt` or any prompt response from ACS.

#### Scenario: Detached worker requests approval

- **WHEN** a managed worker without an attached operator waits for approval
- **THEN** ACS exposes `auth-required`, keeps delivery deferred, and sends no approval response or denial

#### Scenario: Detached worker requests user input

- **WHEN** a managed worker without an attached operator waits for user input
- **THEN** ACS exposes `input-required`, keeps delivery deferred, and sends no synthetic input

#### Scenario: Operator resolves a native prompt

- **WHEN** an attached operator responds to the managed worker's native prompt and later detaches
- **THEN** ACS resumes delivery only after a fresh observation proves the block cleared and does not treat detachment as interruption

#### Scenario: Prompt restoration is unsupported

- **WHEN** the pinned native client cannot restore a pending prompt after attachment
- **THEN** ACS leaves the worker visibly blocked and does not compensate with an automatic response

### Requirement: Managed Codex claims match their evidence layer

ACS SHALL distinguish policy evidence from native runtime and operator-interaction evidence. Contract and emulator tests SHALL establish ACS validation, fencing, method selection, and non-response policy only. Claims about persistent thread creation, same-installation unload and resume, background completion, and reconnect SHALL require isolated tests against the pinned Codex binary. Claims about terminal detach keys and commands, transport close, prompt restoration, or multiple interactive clients SHALL require recorded operator certification for the pinned version and tested topology.

#### Scenario: Emulator selects unsubscribe-compatible behavior

- **WHEN** an emulator test observes the intended ACS method selection or lack of prompt response
- **THEN** documentation may claim the ACS policy but not native TUI detach or prompt-routing behavior

#### Scenario: Pinned native background execution is verified

- **WHEN** an isolated credential-free pinned-binary test proves a persistent thread completes after its creator disconnects and is observed once
- **THEN** ACS may claim that exact background-completion behavior for the tested version and topology

#### Scenario: Operator detach behavior is certified

- **WHEN** operator evidence records the Codex version, topology, installation, action, observed RPCs, final turn status, and completion count
- **THEN** ACS may document only the detach, interrupt, prompt, or multi-client behavior directly supported by that evidence

## MODIFIED Requirements

### Requirement: Codex presence distinguishes owners from observers

The Codex adapter SHALL consume app-server data that distinguishes interactive subscribers from observer or service subscribers. The ACS-managed app-server connection SHALL identify itself as non-interactive and MUST NOT fabricate interactive presence merely by observing a thread. Codex thread reads and presence-change notifications SHALL provide a fresh interactive-subscriber presence value for reconciliation. For attached bindings, that presence remains part of availability. For managed bindings, subscriber presence describes operator attachment but SHALL NOT determine durable ownership or by itself make a loaded worker offline.

#### Scenario: User closes the Codex session

- **WHEN** the last interactive subscriber leaves an attached Codex thread while the ACS observer remains connected
- **THEN** app-server reports no interactive subscriber and ACS can derive the attached agent as `offline`

#### Scenario: User detaches from a managed Codex worker

- **WHEN** the last interactive subscriber leaves a managed Codex thread while the ACS observer remains connected
- **THEN** app-server reports no interactive subscriber and ACS retains the managed binding and derives state from the loaded runtime observation

#### Scenario: User reopens the Codex session

- **WHEN** an interactive subscriber joins a bound Codex thread
- **THEN** app-server reports interactive presence and ACS reconciles the agent from the current thread status without changing its control class

#### Scenario: ACS reconnects to app-server

- **WHEN** the Codex adapter reconnects after missing notifications
- **THEN** it refreshes thread status and interactive presence before publishing a current observation
