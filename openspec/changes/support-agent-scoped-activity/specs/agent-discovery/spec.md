## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: ACS discovery projects current assigned activity

ACS SHALL project at most one `currentActivity` for a logical agent from its eligible task-linked activities and its task-independent activity published by the current bound agent. ACS SHALL select the most recently published or refreshed eligible candidate and use stable source identity as a deterministic timestamp tie-breaker. The projection SHALL identify the activity state, update time, expiry time, any concise summary explicitly designated by the agent, and the optional working directory and Git branch captured for that publication.

#### Scenario: Submitted task has not been acknowledged

- **WHEN** a task has been submitted but its assigned agent has neither acknowledged it nor independently published activity
- **THEN** ACS does not advertise that task as the agent's `currentActivity`

#### Scenario: Agent acknowledges assigned work

- **WHEN** an agent with a current online runtime claimant acknowledges an assigned task
- **THEN** ACS publishes that task as `currentActivity` in the `working` state with a 30-minute expiry

#### Scenario: Agent publishes task-independent work

- **WHEN** the current bound agent publishes activity without a task identifier
- **THEN** ACS considers that `working` activity for the agent's `currentActivity`

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

ACS SHALL expose `currentActivity` only while the logical agent has a current runtime claimant, the publishing binding and epoch still own the selected activity, and its 30-minute expiry has not elapsed. A task-linked activity additionally requires its task to remain nonterminal; a task-independent activity does not acquire a synthetic task lifecycle. ACS SHALL evaluate eligibility at read time rather than requiring automatic reaping of the logical agent or a cleanup job.

#### Scenario: Assigned agent reports a task transition

- **WHEN** the assigned agent moves an advertised task among `working`, `input-required`, and `auth-required`
- **THEN** ACS updates the advertised state and resets the activity expiry to 30 minutes after that transition

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

The `currentActivity` projection MUST NOT contain task, context, message, requester, binding, installation, session, or runtime-execution identifiers. It MUST NOT contain prompts, conversation contents, credentials, attachments, artifacts, or runtime output. It MAY contain the explicitly published summary and the publishing session's full absolute working directory and attached Git branch.

#### Scenario: Peer inspects current activity

- **WHEN** an authenticated ACS peer lists or gets an agent with current activity
- **THEN** the peer receives only the activity state, optional explicitly designated summary, optional working directory and Git branch, update time, and expiry time
