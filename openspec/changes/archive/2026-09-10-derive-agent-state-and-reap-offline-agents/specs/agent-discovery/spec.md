## ADDED Requirements

### Requirement: ACS derives peer-visible agent state from runtime observations

ACS SHALL derive exactly one peer-visible `state` from the current binding's fresh harness-neutral runtime observation. The allowed states SHALL be `unknown`, `offline`, `ready`, `working`, `input-required`, `auth-required`, and `error`. ACS SHALL apply this precedence: an explicitly not-loaded runtime or absent interactive subscriber is `offline`; unknown interactive presence is `unknown`; an interactive runtime waiting on approval is `auth-required`; one waiting on user input is `input-required`; a system error is `error`; an active runtime is `working`; an idle runtime is `ready`; and an unrecognized combination is `unknown`. Approval SHALL take precedence if both blocking reasons are reported.

#### Scenario: Closed interactive session is offline

- **WHEN** a bound runtime remains loaded or idle but has no interactive subscriber
- **THEN** ACS derives `offline` rather than `ready`

#### Scenario: Agent needs a user selection

- **WHEN** a present interactive runtime is active and reports that it is waiting on user input
- **THEN** ACS derives `input-required`

#### Scenario: Agent needs approval

- **WHEN** a present interactive runtime is active and reports that it is waiting on approval
- **THEN** ACS derives `auth-required`

#### Scenario: Interactive presence is unsupported

- **WHEN** the runtime adapter cannot report interactive presence authoritatively
- **THEN** ACS derives `unknown` and does not treat the agent as available or offline

### Requirement: Peer discovery exposes a minimal useful agent projection

Authenticated MCP agent discovery SHALL expose stable identity, description, configured skills, derived `state`, and eligible `currentActivity`. It SHALL NOT expose bindings, installations, sessions, runtime identifiers, raw runtime observations, or adapter-specific status. Administrative control surfaces MAY expose those diagnostic fields. The default peer list SHALL omit agents whose state is `offline` or `unknown`; exact lookup MAY return an enabled, non-reaped agent in either state so known peers can inspect its condition during the grace period. The existing coarse `availability` field and available/unavailable list filter SHALL be removed rather than retained beside `state`.

#### Scenario: Peer lists useful agents

- **WHEN** an authenticated peer lists agents without an expertise filter
- **THEN** ACS returns only enabled, non-reaped agents whose derived state is neither `offline` nor `unknown`

#### Scenario: Peer gets a known offline agent

- **WHEN** an authenticated peer gets an enabled, non-reaped agent by exact stable identifier during its offline grace period
- **THEN** ACS may return the minimal peer projection with `state: offline`

#### Scenario: Peer inspects an agent

- **WHEN** an authenticated peer lists or gets an agent
- **THEN** the result contains no binding or runtime implementation details and no legacy `availability`

### Requirement: Continuously offline agents are logically reaped

ACS SHALL record when an enabled logical agent first enters the explicit `offline` state and SHALL logically reap it after a configurable continuous offline retention period whose default is 24 hours. Any later non-offline observation SHALL clear that offline interval. `unknown` and `error` SHALL NOT start or advance reaping. Reaping SHALL revoke the current binding and principal, preserve referential history through the existing logical deletion mechanism, and exclude the agent from peer list, exact lookup, and routing. Re-registering a previously reaped slug SHALL create a new logical agent identity.

#### Scenario: Agent stays offline through retention

- **WHEN** an agent remains continuously `offline` for the configured retention period
- **THEN** ACS logically reaps the agent and revokes its binding and principal

#### Scenario: Agent reconnects before retention

- **WHEN** an offline agent receives an authoritative non-offline observation before the retention period elapses
- **THEN** ACS clears the offline interval and does not reap the agent from that interval

#### Scenario: Runtime state is unknown

- **WHEN** ACS cannot determine authoritative interactive presence
- **THEN** ACS does not reap the agent regardless of how long the `unknown` state persists

#### Scenario: Reaped slug registers again

- **WHEN** a caller registers the slug of a logically reaped agent
- **THEN** ACS creates a new logical agent identity without restoring the reaped identity or its ownership

## MODIFIED Requirements

### Requirement: ACS discovery projects current assigned activity

ACS SHALL project at most one `currentActivity` for a logical agent from its eligible task-linked activities and its task-independent activity published by the current bound agent. ACS SHALL select the most recently published or refreshed eligible candidate and use stable source identity as a deterministic timestamp tie-breaker. The projection SHALL identify the update time, expiry time, any concise summary explicitly designated by the agent, and the optional working directory and Git branch captured for that publication. Agent state SHALL come only from the runtime-derived top-level `state`, not from manually assigned activity state.

#### Scenario: Submitted task has not been acknowledged

- **WHEN** a task has been submitted but its assigned agent has neither acknowledged it nor independently published activity
- **THEN** ACS does not advertise that task as the agent's `currentActivity`

#### Scenario: Agent acknowledges assigned work

- **WHEN** an agent with a current online runtime claimant acknowledges an assigned task
- **THEN** ACS publishes that task as `currentActivity` with a 30-minute expiry without assigning peer-visible agent state

#### Scenario: Agent publishes task-independent work

- **WHEN** the current bound agent publishes activity without a task identifier
- **THEN** ACS considers that activity for the agent's `currentActivity` without assigning peer-visible agent state

#### Scenario: Task-linked and task-independent activities are eligible

- **WHEN** both task-linked and task-independent activities are eligible for one agent
- **THEN** ACS returns the activity most recently published or refreshed

#### Scenario: Several task activities are eligible

- **WHEN** an agent has more than one nonterminal, unexpired activity owned by its current binding
- **THEN** ACS returns the most recently published or refreshed activity and uses task identity as a deterministic timestamp tie-breaker

#### Scenario: Agent has no eligible activity

- **WHEN** an agent has no acknowledged, nonterminal, unexpired task activity and no eligible task-independent activity owned by its current binding
- **THEN** ACS omits `currentActivity`

### Requirement: Activity follows live ownership and task lifecycle

ACS SHALL expose `currentActivity` only while the logical agent has a current runtime claimant, the publishing binding and epoch still own the selected activity, and its 30-minute expiry has not elapsed. A task-linked activity additionally requires its task to remain nonterminal; a task-independent activity does not acquire a synthetic task lifecycle. ACS SHALL evaluate activity eligibility at read time independently of the agent reaping schedule.

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

- **WHEN** the current runtime claimant disconnects, becomes dormant, is revoked, or is replaced by a binding that does not own the activity
- **THEN** subsequent agent discovery omits that activity

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

### Requirement: Activity discovery does not disclose task content or runtime identity

The `currentActivity` projection MUST NOT contain task state, task, context, message, requester, binding, installation, session, or runtime-execution identifiers. It MUST NOT contain prompts, conversation contents, credentials, attachments, artifacts, or runtime output. It MAY contain the explicitly published summary and the publishing session's full absolute working directory and attached Git branch.

#### Scenario: Peer inspects current activity

- **WHEN** an authenticated ACS peer lists or gets an agent with current activity
- **THEN** the peer receives only the optional explicitly designated summary, optional working directory and Git branch, update time, and expiry time

#### Scenario: Bridge inspects identity before activity publication

- **WHEN** a bridge client attests its caller or reads its ACS identity
- **THEN** ACS does not include the runtime working directory or Git branch in the attestation response

### Requirement: Live activity remains outside the A2A Agent Card

ACS SHALL keep transient state and `currentActivity` out of public and authenticated extended A2A Agent Cards. Agent Cards SHALL continue to represent stable identity, description, and configured skills.

#### Scenario: Fetch either Agent Card form

- **WHEN** a caller retrieves an agent's public or authenticated extended A2A Agent Card while its ACS state or activity changes
- **THEN** the card does not expose `state` or `currentActivity` or require a profile-version change for that transition
