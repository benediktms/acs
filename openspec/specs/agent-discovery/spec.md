# Agent discovery

## Purpose

Define how authenticated ACS clients discover an agent's stable expertise and safely observe its current ACS-assigned activity.

## Requirements

### Requirement: ACS discovery exposes agent expertise

ACS SHALL return each logical agent's description and configured skills through its authenticated control-protocol and MCP agent list/get operations. Skills SHALL retain their configured identifiers, names, descriptions, and tags in the control protocol; the MCP projection SHALL retain enough names and tags for model-visible expertise selection.

#### Scenario: Discover an agent by expertise

- **WHEN** an authenticated caller lists or gets an enabled logical agent with configured expertise
- **THEN** ACS returns that agent's description and configured skill information

#### Scenario: Filter agents by skill

- **WHEN** an authenticated caller filters the agent list by a configured skill identifier, name, description, or tag
- **THEN** ACS returns matching logical agents without requiring A2A Agent Card retrieval

### Requirement: Bound agents maintain activity for local work

ACS SHALL provide an authenticated task-independent operation through which the currently bound agent can publish, replace, refresh, or clear its own peer-visible activity. An initial publication MUST include a non-empty summary of at most 240 Unicode characters; a refresh MAY retain or replace that summary. ACS SHALL derive the target agent and binding fence from the attested caller rather than accepting them from tool input. For Codex MCP calls, ACS SHALL resolve the full absolute working directory from the attested runtime thread and SHALL resolve its current Git branch when attached, without accepting either value from model or executor input.

#### Scenario: Agent begins locally assigned work

- **WHEN** a bound agent begins substantive work assigned directly through its local session rather than through an ACS inbox task
- **THEN** the agent can publish a concise activity without supplying a task or delivery identifier

#### Scenario: Agent changes local focus

- **WHEN** the bound agent replaces its current local-work summary
- **THEN** ACS exposes the replacement and resets its expiry to 30 minutes after the update

#### Scenario: Agent continues local work

- **WHEN** the bound agent refreshes an existing task-independent activity without a replacement summary
- **THEN** ACS retains the existing summary and resets its expiry to 30 minutes after the refresh

#### Scenario: Agent publishes without an existing summary

- **WHEN** the bound agent requests a task-independent refresh without a summary and has no existing task-independent activity
- **THEN** ACS rejects the update as invalid without changing discoverable activity

#### Scenario: Agent finishes local work

- **WHEN** the bound agent clears its task-independent activity
- **THEN** ACS stops considering that activity for discovery

#### Scenario: Caller attempts to update another agent

- **WHEN** a caller attempts to select another logical agent or use a stale or non-current binding to publish activity
- **THEN** ACS rejects the update without changing either agent's discoverable activity

#### Scenario: Bound session receives MCP instructions

- **WHEN** ACS initializes its MCP bridge for a bound session
- **THEN** the instructions tell the agent to publish activity when substantive local work begins, replace it when focus materially changes, refresh it before expiry or after changing working directory or branch, and clear it when the work ends

#### Scenario: Agent publishes from an attached Git branch

- **WHEN** a Codex agent publishes or refreshes activity from a working directory on an attached Git branch
- **THEN** ACS records the full absolute working directory and current branch with that activity

#### Scenario: Agent publishes without an attached Git branch

- **WHEN** a Codex agent publishes or refreshes activity outside a Git worktree or from detached HEAD
- **THEN** ACS records the full absolute working directory and omits the Git branch

#### Scenario: Agent changes workspace context

- **WHEN** the agent changes working directory or branch and then refreshes its activity
- **THEN** ACS replaces the activity's workspace context with the newly captured values

#### Scenario: Current workspace cannot be resolved

- **WHEN** ACS cannot freshly resolve an absolute working directory while publishing, acknowledging, or refreshing activity
- **THEN** ACS rejects that activity mutation without changing the existing activity, while an explicit clear remains permitted

#### Scenario: Git workspace inspection fails

- **WHEN** ACS identifies a Git worktree but cannot inspect its current branch
- **THEN** ACS rejects the activity mutation without changing the existing activity instead of treating the failure as detached HEAD

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

### Requirement: Assigned agents control their activity summary

ACS SHALL accept an optional non-empty activity summary of at most 240 Unicode characters when the authenticated assigned agent acknowledges a task. While that task remains nonterminal, ACS SHALL also provide an authenticated task-activity operation through which the assigned agent can refresh the activity with an optional replacement summary or explicitly clear the whole activity. ACS MUST NOT derive an activity summary from requester messages, input questions, task conversation history, artifacts, or runtime output.

#### Scenario: Acknowledgement includes an initial summary

- **WHEN** the assigned agent acknowledges a task with a valid activity summary
- **THEN** ACS publishes that summary with the task activity

#### Scenario: Acknowledgement omits a summary

- **WHEN** the assigned agent acknowledges a task without an activity summary
- **THEN** ACS publishes the task state and freshness without inventing summary text

#### Scenario: Assigned agent changes focus

- **WHEN** the assigned agent replaces the summary for a nonterminal task activity
- **THEN** ACS exposes the replacement summary and resets that activity's expiry to 30 minutes after the update

#### Scenario: Assigned agent refreshes unchanged activity

- **WHEN** the assigned agent republishes the current summary while continuing the same task
- **THEN** ACS retains the summary and resets that activity's expiry to 30 minutes after the refresh

#### Scenario: Assigned agent clears its activity

- **WHEN** the assigned agent explicitly clears a nonterminal task activity
- **THEN** ACS stops advertising that task until the agent acknowledges a later delivery for it or explicitly republishes activity under a current binding

#### Scenario: Another principal attempts to advertise activity

- **WHEN** a principal that is not assigned to the task attempts to publish, refresh, or clear its activity
- **THEN** ACS rejects the update without changing discoverable activity

#### Scenario: Activity summary is invalid

- **WHEN** the assigned agent submits an empty summary or one longer than 240 Unicode characters
- **THEN** ACS rejects it as invalid without changing discoverable activity

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

### Requirement: Delivered tasks instruct agents to maintain activity

ACS SHALL include task-maintenance instructions in direct-delivery prompts. The instructions SHALL tell the assigned agent to publish a concise initial activity during acknowledgement, replace it when the task objective or scope materially changes, refresh it before expiry while work continues, and finish the task through the appropriate terminal or input-required operation. Correct expiry and clearing MUST NOT depend on the agent following those instructions.

#### Scenario: ACS directly delivers assigned work

- **WHEN** ACS constructs the runtime prompt for an assigned task
- **THEN** the prompt explains when and how the agent maintains its peer-visible activity

#### Scenario: Agent ignores maintenance instructions

- **WHEN** an agent does not refresh or clear its advertised activity
- **THEN** ACS still expires or clears it according to binding ownership, task lifecycle, and the 30-minute TTL

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
