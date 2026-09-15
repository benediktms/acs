## MODIFIED Requirements

### Requirement: Activity follows live ownership and task lifecycle

ACS SHALL expose `currentActivity` only while the logical agent has a current runtime binding that owns the selected activity and its 30-minute expiry has not elapsed. Transient interactive detachment from a managed binding SHALL NOT end that ownership. A task-linked activity additionally requires its task to remain nonterminal; a task-independent activity does not acquire a synthetic task lifecycle. ACS SHALL evaluate activity eligibility at read time independently of the agent reaping schedule.

#### Scenario: Assigned agent reports a task transition

- **WHEN** the assigned agent moves an advertised task among `working`, `input-required`, and `auth-required`
- **THEN** ACS updates the task lifecycle and resets the activity expiry to 30 minutes without using that transition as the peer-visible agent state

#### Scenario: Requester activity changes the task

- **WHEN** a requester sends task input or otherwise changes task data without an assigned-agent activity or lifecycle update
- **THEN** ACS does not refresh the activity expiry

#### Scenario: Activity expires

- **WHEN** 30 minutes elapse without an eligible task lifecycle update or explicit activity refresh for the selected activity
- **THEN** subsequent discovery selects the next eligible activity or omits `currentActivity`

#### Scenario: Runtime ownership is lost

- **WHEN** the current attached runtime claimant disconnects, becomes dormant, is revoked, or is replaced by a binding that does not own the activity
- **THEN** subsequent agent discovery omits that activity

#### Scenario: Managed operator detaches

- **WHEN** the interactive operator leaves a current managed binding while its activity remains unexpired
- **THEN** ACS continues to treat that binding as the activity owner without creating a durable detached state

#### Scenario: Task becomes terminal

- **WHEN** the selected task-linked activity becomes `completed`, `failed`, `canceled`, or `rejected`
- **THEN** subsequent discovery selects the next eligible task-linked or task-independent activity or omits `currentActivity`

#### Scenario: Older task becomes terminal after local focus changes

- **WHEN** an agent publishes newer task-independent activity and an older task-linked activity later becomes terminal
- **THEN** the older task transition does not clear or alter the newer task-independent activity

#### Scenario: Current ownership resumes

- **WHEN** a session resumes under the same current binding and epoch before its activity expires
- **THEN** subsequent discovery may project that activity again without recreating the logical agent

#### Scenario: Task moves to a new binding epoch

- **WHEN** a logical agent is rebound while an activity from an earlier binding epoch remains unexpired
- **THEN** ACS omits the earlier activity until the new binding publishes task-linked or task-independent activity

### Requirement: ACS derives peer-visible agent state from runtime observations

ACS SHALL derive exactly one peer-visible `state` from the current binding's control class and fresh harness-neutral runtime observation. The allowed states SHALL be `unknown`, `offline`, `ready`, `working`, `input-required`, `auth-required`, and `error`. An explicitly offline runtime SHALL be `offline` for either control class. For an attached binding, an explicitly not-loaded runtime or absent interactive subscriber SHALL be `offline`, and unknown interactive presence SHALL be `unknown`. For a managed binding, interactive presence SHALL NOT determine state; a not-loaded runtime SHALL be `unknown` until safely resumed, and a loaded runtime SHALL retain its observed blocking, error, active, or idle state. Approval SHALL take precedence over user input, followed by system error, unknown blocking state, active, idle, and unknown.

#### Scenario: Closed interactive session is offline

- **WHEN** an attached bound runtime remains loaded or idle but has no interactive subscriber
- **THEN** ACS derives `offline` rather than `ready`

#### Scenario: Detached managed worker is ready

- **WHEN** a managed bound runtime is loaded and idle with no interactive subscriber
- **THEN** ACS derives `ready`

#### Scenario: Detached managed worker is working

- **WHEN** a managed bound runtime is loaded and active with no interactive subscriber
- **THEN** ACS derives `working`

#### Scenario: Unloaded managed worker is unknown

- **WHEN** a managed bound runtime is not loaded on its recorded installation
- **THEN** ACS derives `unknown` until a safe same-installation resume produces a fresh observation

#### Scenario: Agent needs a user selection

- **WHEN** a loaded managed runtime reports that it is waiting on user input without an interactive subscriber
- **THEN** ACS derives `input-required`

#### Scenario: Agent needs approval

- **WHEN** a loaded managed runtime reports that it is waiting on approval without an interactive subscriber
- **THEN** ACS derives `auth-required`

#### Scenario: Interactive presence is unsupported

- **WHEN** an attached runtime adapter cannot report interactive presence authoritatively
- **THEN** ACS derives `unknown` and does not treat the agent as available or offline

### Requirement: Continuously offline agents are logically reaped

ACS SHALL record when an enabled logical agent with an attached binding first enters the explicit `offline` state and SHALL logically reap it after a configurable continuous offline retention period whose default is 24 hours. Any later non-offline observation SHALL clear that offline interval. `unknown` and `error` SHALL NOT start or advance reaping. ACS SHALL NOT automatically reap or revoke a managed binding, including when its installation is unreachable or the thread is unloaded. Reaping an attached binding SHALL revoke the current binding and principal, preserve referential history through the existing logical deletion mechanism, and exclude the agent from peer list, exact lookup, and routing. Re-registering a previously reaped slug SHALL create a new logical agent identity.

#### Scenario: Agent stays offline through retention

- **WHEN** an agent with an attached binding remains continuously `offline` for the configured retention period
- **THEN** ACS logically reaps the agent and revokes its binding and principal

#### Scenario: Agent reconnects before retention

- **WHEN** an offline attached agent receives an authoritative non-offline observation before the retention period elapses
- **THEN** ACS clears the offline interval and does not reap the agent from that interval

#### Scenario: Runtime state is unknown

- **WHEN** ACS cannot determine an agent's authoritative runtime state
- **THEN** ACS does not reap the agent regardless of how long the `unknown` state persists

#### Scenario: Managed installation remains unreachable

- **WHEN** a managed binding's recorded runtime installation remains unreachable beyond the offline retention period
- **THEN** ACS retains the managed ownership receipt and does not logically reap or revoke it

#### Scenario: Reaped slug registers again

- **WHEN** a caller registers the slug of a logically reaped attached agent
- **THEN** ACS creates a new logical agent identity without restoring the reaped identity or its ownership
