## Purpose

Define how authenticated ACS clients discover an agent's stable expertise and safely observe its current ACS-assigned activity.

## ADDED Requirements

### Requirement: ACS discovery exposes agent expertise

ACS SHALL return each logical agent's description and configured skills through its authenticated control-protocol and MCP agent list/get operations. Skills SHALL retain their configured identifiers, names, descriptions, and tags in the control protocol; the MCP projection SHALL retain enough names and tags for model-visible expertise selection.

#### Scenario: Discover an agent by expertise

- **WHEN** an authenticated caller lists or gets an enabled logical agent with configured expertise
- **THEN** ACS returns that agent's description and configured skill information

#### Scenario: Filter agents by skill

- **WHEN** an authenticated caller filters the agent list by a configured skill identifier, name, description, or tag
- **THEN** ACS returns matching logical agents without requiring A2A Agent Card retrieval

### Requirement: ACS discovery projects current assigned activity

ACS SHALL project at most one `currentActivity` for a logical agent from its most recently published or refreshed eligible task activity. The projection SHALL identify the task state, activity update time, expiry time, and any concise summary explicitly designated by the assigned agent for discovery.

#### Scenario: Submitted task has not been acknowledged

- **WHEN** a task has been submitted but its assigned agent has not acknowledged it
- **THEN** ACS does not advertise that task as the agent's `currentActivity`

#### Scenario: Agent acknowledges assigned work

- **WHEN** an agent with a current online runtime claimant acknowledges an assigned task
- **THEN** ACS publishes that task as `currentActivity` in the `working` state with a 30-minute expiry

#### Scenario: Several task activities are eligible

- **WHEN** an agent has more than one nonterminal, unexpired activity owned by its current binding
- **THEN** ACS returns the most recently published or refreshed activity and uses task identity as a deterministic timestamp tie-breaker

#### Scenario: Agent has no eligible activity

- **WHEN** an agent has no acknowledged, nonterminal, unexpired task activity owned by its current binding
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

ACS SHALL expose `currentActivity` only while the logical agent has a current runtime claimant, the publishing binding and epoch still own the activity, its task remains nonterminal, and its 30-minute expiry has not elapsed. ACS SHALL evaluate eligibility at read time rather than requiring automatic reaping of the logical agent or a cleanup job.

#### Scenario: Assigned agent reports a task transition

- **WHEN** the assigned agent moves an advertised task among `working`, `input-required`, and `auth-required`
- **THEN** ACS updates the advertised state and resets the activity expiry to 30 minutes after that transition

#### Scenario: Requester activity changes the task

- **WHEN** a requester sends task input or otherwise changes task data without an assigned-agent activity or lifecycle update
- **THEN** ACS does not refresh the activity expiry

#### Scenario: Activity expires

- **WHEN** 30 minutes elapse without acknowledgement, an assigned-agent task transition, or an explicit activity update for the selected task
- **THEN** subsequent discovery selects the next eligible activity or omits `currentActivity`

#### Scenario: Runtime ownership is lost

- **WHEN** the current runtime claimant disconnects, becomes dormant, is revoked, or is replaced by a binding that does not own the task execution
- **THEN** subsequent agent discovery omits `currentActivity`

#### Scenario: Task becomes terminal

- **WHEN** the selected task becomes `completed`, `failed`, `canceled`, or `rejected`
- **THEN** subsequent discovery selects the next eligible task or omits `currentActivity`

#### Scenario: Current ownership resumes

- **WHEN** a session resumes under the same current binding and epoch before its task activity expires
- **THEN** subsequent discovery may project that activity again without recreating the logical agent

#### Scenario: Task moves to a new binding epoch

- **WHEN** a logical agent is rebound while an activity from an earlier binding epoch remains nonterminal and unexpired
- **THEN** ACS omits the earlier activity until the new binding acknowledges or explicitly publishes activity for the task

### Requirement: Delivered tasks instruct agents to maintain activity

ACS SHALL include task-maintenance instructions in direct-delivery prompts. The instructions SHALL tell the assigned agent to publish a concise initial activity during acknowledgement, replace it when the task objective or scope materially changes, refresh it before expiry while work continues, and finish the task through the appropriate terminal or input-required operation. Correct expiry and clearing MUST NOT depend on the agent following those instructions.

#### Scenario: ACS directly delivers assigned work

- **WHEN** ACS constructs the runtime prompt for an assigned task
- **THEN** the prompt explains when and how the agent maintains its peer-visible activity

#### Scenario: Agent ignores maintenance instructions

- **WHEN** an agent does not refresh or clear its advertised activity
- **THEN** ACS still expires or clears it according to binding ownership, task lifecycle, and the 30-minute TTL

### Requirement: Activity discovery does not disclose task content or runtime identity

The `currentActivity` projection MUST NOT contain task, context, message, requester, binding, installation, session, or runtime-execution identifiers. It MUST NOT contain prompts, conversation contents, credentials, attachments, artifacts, or runtime output.

#### Scenario: Peer inspects current activity

- **WHEN** an authenticated ACS peer lists or gets an agent with current activity
- **THEN** the peer receives only the activity state, optional explicitly designated summary, update time, and expiry time

### Requirement: Live activity remains outside the A2A Agent Card

ACS SHALL keep transient availability and `currentActivity` out of public and authenticated extended A2A Agent Cards. Agent Cards SHALL continue to represent stable identity, description, and configured skills.

#### Scenario: Fetch either Agent Card form

- **WHEN** a caller retrieves an agent's public or authenticated extended A2A Agent Card while its ACS activity changes
- **THEN** the card does not expose `currentActivity` or require a profile-version change for that activity transition
