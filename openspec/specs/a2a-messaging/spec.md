# A2A messaging

## Purpose

Define durable inter-agent messaging independently of runtime execution.
See `contracts/a2a-application-port.ts` for the typed implementation boundary.

## Requirements

### Requirement: A2A data plane

ACS SHALL use A2A JSON-RPC for inter-agent messaging and expose Agent Cards and
task send, get, list, and cancel operations. The private control protocol SHALL
NOT provide a general-purpose inter-agent send operation.

#### Scenario: Authenticated message

- **WHEN** an authorized agent submits a valid message to an enabled target
- **THEN** ACS returns the durably accepted task through the A2A interface

### Requirement: Atomic durable acceptance

ACS SHALL atomically commit the task, message, append-only event, idempotency record, direct delivery intent, and initial independent preemption status before reporting durable acceptance. Runtime acceptance SHALL be tracked separately and, when accepted, SHALL record the recipient session and accepting turn evidence plus the runtime-reported execution relationship (`started`, `joined`, or `unknown`) where available.

#### Scenario: Acceptance write fails

- **WHEN** any write in message acceptance fails
- **THEN** no partial acceptance is committed

#### Scenario: Duplicate message

- **WHEN** an equivalent request repeats an accepted idempotency identity
- **THEN** ACS returns the existing task without creating a duplicate delivery or changing its preemption status

#### Scenario: Runtime has not accepted the message

- **WHEN** durable acceptance succeeds but direct runtime delivery is still pending
- **THEN** ACS reports the task as durably accepted without claiming that the recipient session received it

#### Scenario: Runtime accepts into an existing turn

- **WHEN** direct delivery is accepted into an already-active runtime turn
- **THEN** ACS records runtime acceptance for that delivery against the existing turn without creating a second A2A task or inferring a completed result

### Requirement: Cancellation does not imply shared-turn interruption

A requester cancellation SHALL cancel the target A2A task/delivery according to the task state machine. ACS SHALL NOT automatically interrupt a runtime turn merely because the canceled task has a delivery associated with that turn.

#### Scenario: Canceled task shares a turn

- **WHEN** a requester cancels a task whose peer message was accepted into a turn containing other work
- **THEN** ACS records task cancellation without interrupting the shared turn unless isolated runtime ownership is separately proven

### Requirement: Bounded input and admission

ACS SHALL enforce configured request and message-part limits, authenticate
callers, and reject delivery admission when the queue is full.

#### Scenario: Queue capacity reached

- **WHEN** a message arrives at a target whose delivery admission is full
- **THEN** ACS rejects it without partial persistence and returns HTTP 429

### Requirement: Durable task history

ACS SHALL preserve append-only task events and update the materialized task
snapshot in the same transaction.

#### Scenario: Restart after acceptance

- **WHEN** the daemon restarts after an acceptance transaction commits
- **THEN** the accepted task and its pending delivery remain available

### Requirement: Reaping terminates accepted work explicitly

When a target agent is logically reaped, ACS SHALL atomically transition each of its nonterminal accepted tasks to a terminal failure with stable reason `target-reaped`, append the corresponding task event, and remove any pending delivery intent. ACS MUST NOT silently delete, resend, or transfer that work to a later agent that reuses the same slug.

#### Scenario: Offline target is reaped with queued work

- **WHEN** ACS reaps an agent that owns accepted nonterminal tasks or pending deliveries
- **THEN** each task becomes terminally failed with reason `target-reaped` in the same transaction that removes its delivery intent

#### Scenario: Reaped slug is registered again

- **WHEN** a new logical agent registers a slug previously used by a reaped target
- **THEN** the new agent does not inherit, resume, or receive the reaped target's work

#### Scenario: Sender addresses a reaped target

- **WHEN** a sender addresses the identity of a reaped target
- **THEN** ACS rejects the request without accepting a task or delivery intent

### Requirement: Preemption request is independent from priority and send authority

ACS SHALL accept an optional `preempt` boolean that defaults to `false`. `priority: low | normal | high` SHALL remain scheduling-only. A preemption request SHALL require ordinary `a2a:send` authorization and SHALL NOT substitute for it.

#### Scenario: Existing sender omits preemption

- **WHEN** a sender submits an otherwise valid message without `preempt`
- **THEN** ACS treats `preempt` as `false` and preserves existing priority and delivery behavior

#### Scenario: Sender lacks ordinary send authority

- **WHEN** a sender requests preemption without `a2a:send`
- **THEN** ACS rejects the message and does not treat `a2a:preempt` as delivery authority

#### Scenario: High priority has no preemption request

- **WHEN** a sender submits a high-priority message with `preempt: false`
- **THEN** ACS applies scheduling priority without granting or requesting interruption

### Requirement: Only the local user grants binding-lifetime preemption authority

Only the local-user direct-binding and claim-creation control paths MAY put `a2a:preempt` on a new bound-agent principal or enable `allowPeerPreemption` on a recipient binding. Both SHALL default to absent or `false`. The grant and policy SHALL be stored with the binding or claim and SHALL last only for that binding; rebind or revocation SHALL disable the old principal and end its preemption authority.

#### Scenario: Operator creates a direct binding with preemption

- **WHEN** the local user creates a direct binding with the explicit sender grant or recipient opt-in
- **THEN** ACS persists only the selected `a2a:preempt` principal scope and/or `allowPeerPreemption` binding policy for that new binding

#### Scenario: Operator creates a claim with preemption policy

- **WHEN** the local user creates a claim with the explicit sender grant or recipient opt-in
- **THEN** ACS persists those operator-selected values on the claim and consumes them atomically into the resulting binding

#### Scenario: Binding is rebound or revoked

- **WHEN** ACS rebinds or revokes a binding that had `a2a:preempt`
- **THEN** the old principal is disabled and cannot mint or exercise that authority

### Requirement: Claim consumption and self-registration cannot self-grant

`acs_claim` and its `bindings.claim` control operation SHALL accept only consumer-owned session, continuity, and replacement inputs. `acs_register` and `bindings.register` SHALL create safe-default scopes and delivery policy. Neither operation nor unrecognized control fields MAY add `a2a:preempt` or enable `allowPeerPreemption`.

#### Scenario: Claim consumer supplies an escalation field

- **WHEN** a claim consumer supplies `a2a:preempt`, `allowPeerPreemption`, or an unrecognized equivalent field
- **THEN** ACS does not add sender preemption authority or recipient opt-in beyond the values persisted by the local user on the claim

#### Scenario: Agent self-registers

- **WHEN** an agent invokes `acs_register`
- **THEN** its resulting principal lacks `a2a:preempt` and its binding has `allowPeerPreemption: false`

### Requirement: Tokens are bounded by durable current principal scopes

ACS SHALL issue a bridge token only for an enabled current principal and SHALL reject each requested scope not covered by that principal's durable scopes; `*` covers every requested scope. The trusted bridge SHALL freshly attest the current principal before sending: for `preempt: true`, it SHALL request `a2a:preempt` only when that attestation confirms the durable scope; otherwise it SHALL omit that extra scope, send with ordinary authority, and record `downgraded/missing-sender-authority`.

#### Scenario: Over-scoped token issuance is rejected

- **WHEN** any token request includes `a2a:preempt` but the enabled current principal lacks that durable scope
- **THEN** ACS rejects token issuance

#### Scenario: Trusted bridge omits an ungranted preemption scope

- **WHEN** a `preempt: true` message's fresh attestation shows that its current principal lacks `a2a:preempt`
- **THEN** the bridge omits that scope from its token request, sends the message with `a2a:send`, and ACS records `downgraded/missing-sender-authority`

#### Scenario: Disabled principal requests a token

- **WHEN** a disabled or stale principal requests a bridge token
- **THEN** ACS rejects token issuance

### Requirement: Preemption downgrade is visible independently of delivery

ACS SHALL persist preemption request and outcome independently from delivery state and expose `requested`, `attempted`, `state`, and an optional classified reason to the sender. Missing or stale sender authority, missing recipient opt-in, stale recipient binding, unsupported runtime, and definitive runtime rejection SHALL noisily downgrade preemption while ordinary named-tool-output delivery continues. No active execution SHALL be recorded as unnecessary while ordinary named-tool-output delivery continues.

#### Scenario: Preemption gate is missing after acceptance

- **WHEN** ordinary delivery was accepted but a sender or recipient preemption gate is missing or stale at execution time
- **THEN** ACS reports a classified downgrade and continues ordinary delivery without an interrupt

#### Scenario: Runtime rejects interruption

- **WHEN** an eligible interruption receives a definitive runtime rejection
- **THEN** ACS records the rejection as the preemption outcome and continues ordinary named-tool-output delivery

### Requirement: Authenticated principals define requester identity

ACS SHALL derive requester identity from the bearer token's persisted principal. Binding SHALL create a `bound-agent` principal, token creation SHALL create only `external-a2a-client` or `service` principals, and the A2A data plane SHALL reject `local-user` principals. A2A message role SHALL describe protocol content and SHALL NOT select requester identity or work authority.

#### Scenario: Bound Codex agent sends through MCP

- **WHEN** `acs_send` receives host-attested thread metadata for an active binding
- **THEN** ACS issues a short-lived A2A token for that binding's `bound-agent` principal
- **AND** the accepted task persists that principal and its agent as the requester

#### Scenario: Administrative token reaches A2A

- **WHEN** a `local-user` principal presents its token to the A2A data plane
- **THEN** ACS rejects it regardless of the message role

### Requirement: Executor mutations require the assigned bound principal

ACS SHALL authorize acknowledgement, completion, failure, and input requests only from the active `bound-agent` principal assigned to the target task, fenced by its binding and epoch. Delivered content SHALL NOT grant executor authority.

#### Scenario: Unassigned principal attempts completion

- **WHEN** a principal other than the task's active assigned bound principal attempts an executor mutation
- **THEN** ACS rejects the mutation without changing task state

### Requirement: Single direct delivery behavior

ACS SHALL expose one peer-message delivery behavior: `direct`. A2A delivery metadata and MCP send inputs SHALL NOT expose history append or wake policy selection.

#### Scenario: Caller sends a peer message

- **WHEN** an authorized caller submits a valid peer message without delivery metadata
- **THEN** ACS creates a direct delivery intent

#### Scenario: Caller requests a removed delivery mode

- **WHEN** a caller supplies `wake_when_idle`, `append_context`, or `join_active`
- **THEN** ACS rejects the unsupported mode without partially accepting the message

### Requirement: Runtime turn association does not define task result

A peer message/task MAY be accepted into a runtime turn that also contains other work. A2A task and reply semantics SHALL remain message/task-specific and SHALL NOT be inferred solely from runtime turn completion or final assistant output.

#### Scenario: Multiple peer tasks share one runtime turn

- **WHEN** two or more peer tasks are associated with one recipient runtime turn
- **THEN** each task retains its own state and reply correlation

#### Scenario: Runtime turn completes before explicit task completion

- **WHEN** a runtime turn completes but the recipient has not explicitly completed or failed an associated delegated task
- **THEN** ACS records runtime execution completion without terminally completing that A2A task

### Requirement: Explicit delegated-task terminal actions

All delegated tasks SHALL require an explicit, attested task-specific completion or failure operation, except cancellation transitions governed by the task state machine.

#### Scenario: Recipient completes a delegated task

- **WHEN** the attested recipient explicitly completes the task with a summary/artifacts
- **THEN** ACS transitions only that task to completed and emits its normal task event

#### Scenario: Recipient fails a delegated task

- **WHEN** the attested recipient explicitly fails the task
- **THEN** ACS transitions only that task to failed and emits its normal task event
