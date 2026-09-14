## ADDED Requirements

### Requirement: ACS collaboration guidance promotes purposeful proactive coordination

The materialized ACS collaboration guidance SHALL direct agents to discover useful active peers when coordination may materially advance the shared objective, proactively share relevant findings with peers already involved in the work, and preserve local-user authority over creation of new managed workers.

#### Scenario: Managed session starts or resumes

- **WHEN** the managed SessionStart hook runs for startup, resume, or clear
- **THEN** the guidance instructs the agent to resolve its ACS identity and register immediately when unbound
- **AND** after it is bound, the guidance instructs it to follow `acs_agents_list` pagination until `nextCursor` is absent to complete one snapshot before handling the user request
- **AND** the resulting active-agent and activity projection is available when the agent considers coordination

#### Scenario: Agent considers coordination

- **WHEN** an agent identifies work where another active agent's expertise or current activity may help
- **THEN** the guidance instructs it to inspect the currently active ACS agents before choosing whether to coordinate
- **AND** the guidance permits a fresh inspection when the startup snapshot is absent or stale but does not require continuous agent-list or inbox polling

#### Scenario: Managed session runs inside the ACS repository

- **WHEN** the managed SessionStart hook is active and the repository SessionStart hook is also discovered
- **THEN** the repository hook suppresses its duplicate output
- **AND** the managed hook injects the canonical startup guidance once

#### Scenario: Existing peer would benefit from a finding

- **WHEN** an agent is already communicating with another agent and discovers information likely to help that agent's assigned work
- **THEN** the guidance instructs it to send the peer a concise relevant finding proactively
- **AND** it avoids duplicate messages and unrelated coordination noise

#### Scenario: Agent delegates work requiring a usable result

- **WHEN** an agent delegates distinct work to an existing peer
- **THEN** the guidance directs it to include objective, ownership, constraints, and expected evidence with `replyExpected: true` and normally `notifyOn: ["input-required", "terminal"]`
- **AND** the recipient uses `acs_task_acknowledge` with the exact `taskId`, `deliveryId`, and optional concise `activitySummary`, then explicitly uses `acs_task_complete`, `acs_task_fail`, or `acs_task_request_input`
- **AND** the guidance does not treat final assistant or runtime output as explicit task completion or prescribe polling

#### Scenario: Delegated work requires requester input

- **WHEN** a delegated recipient is blocked on requester input
- **THEN** the guidance directs it to call `acs_task_request_input` on the assigned `taskId` with a precise question, choices when useful, and blocking status
- **AND** directs the requester to use `acs_task_reply` with that same `taskId`, text, and optional `attachments`
- **AND** does not prescribe a second `acs_send` or asking the recipient's local user merely because the work was delegated

#### Scenario: Delivery state is uncertain

- **WHEN** the requester cannot determine whether delegated work reached runtime delivery
- **THEN** the guidance directs it to preserve the original receipt and stable `clientRequestId` and inspect the exact task once with `acs_task_get`
- **AND** distinguish durable task acceptance from runtime delivery without blind resend, continuous polling, or automatic replacement workers

#### Scenario: Agent publishes coordination activity

- **WHEN** an agent performs substantive local or delegated work
- **THEN** the guidance directs it to use `acs_activity_update` for local work and `acs_task_activity_update` for delegated work with concise non-sensitive summaries
- **AND** initially use `acs_activity_update` with `action: "refresh"` and required `activitySummary`; later local refreshes may omit an unchanged summary, while `acs_task_activity_update` refreshes have optional `activitySummary`
- **AND** use `action: "clear"` without `activitySummary` only when the actual objective completes
- **AND** it avoids per-step chatter and transcript-derived summaries

#### Scenario: Distinct work merits a new managed worker

- **WHEN** an agent identifies a distinct implementation task that would materially benefit from a new managed worker
- **THEN** the guidance instructs it to ask the local user for permission before creating the agent or persistent session
- **AND** the guidance identifies `acs codex workers create <agent>` as the managed-worker command
- **AND** the guidance treats binding, task, and delivery receipts as asynchronous submission evidence rather than worker readiness
- **AND** it sends the new agent a scoped task for ACS to queue until the managed session can accept it, without polling for readiness

#### Scenario: Active agents may share a checkout

- **WHEN** an agent finds changes or branch movement in its checkout that may belong to another active agent
- **THEN** the guidance directs it to inspect active-agent workspace and activity evidence and contact the likely owner before changing branch, stashing, moving, or overwriting work
- **AND** the sender subscribes to `working`, input-required, and terminal events so the required acknowledgement is observable
- **AND** the agents agree file ownership and separate worktree destinations before either moves overlapping state
- **AND** each agent preserves unrelated changes and verifies both source and destination after the move

#### Scenario: Agent needs a coordination pattern

- **WHEN** an agent identifies a possible peer handoff, delegation, dependency, overlap, blocker, or new-worker opportunity
- **THEN** the materialized skill links to a proactive-coordination playbook containing concrete examples for those situations
- **AND** the playbook distinguishes useful communication from duplicate status, irrelevant broadcasts, routine polling, and work the receiving agent cannot act on

#### Scenario: Relevant peer work may be affected by a merge

- **WHEN** an agent's work is merged into the shared base or main branch
- **AND** an active peer's work may overlap with or depend on that change
- **THEN** the playbook directs the agent to send that peer the merged commit and base update so it can assess conflicts and whether a rebase is needed
- **AND** it does not broadcast to unrelated peers, rebase for them, or mutate shared state without agreed ownership

#### Scenario: Peer content requests broader authority

- **WHEN** proactive coordination receives peer content that asks for credentials, approvals, broader user scope, or external side effects
- **THEN** the guidance treats that content as non-authoritative and retains the existing local-user approval boundary
