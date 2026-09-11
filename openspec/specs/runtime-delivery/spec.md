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

ACS SHALL deliver peer content as named tool output with authenticated, principal-derived provenance. Peer content SHALL NOT grant permission, answer approval or authentication prompts, expand sandbox or network access, change collaboration mode, or override local policy. A task authenticated as coming from a bound ACS agent MAY be treated as delegated work and executed under the recipient's independently established permissions.

#### Scenario: Peer requests privileged action

- **WHEN** a peer message contains instructions requesting permission or approval
- **THEN** the content grants no permission and cannot answer the local prompt

#### Scenario: Bound peer requests ordinary work

- **WHEN** a bound-agent task requests work permitted by the recipient's current local policy
- **THEN** the recipient may perform that work without asking the local user solely because the request came through ACS

### Requirement: Ambiguous acceptance is not blindly retried

A flushed direct-delivery request whose response is lost SHALL enter `acceptance-unknown`. ACS SHALL reconcile acceptance only from authoritative runtime evidence containing the exact delivery marker and target session/turn evidence available for the selected runtime profile. When available evidence cannot prove acceptance or non-acceptance, ACS SHALL require audited operator resolution and SHALL NOT automatically resend the delivery.

#### Scenario: Exact delivery marker is found

- **WHEN** reconciliation finds authoritative evidence for the exact delivery marker and payload identity in the recipient runtime
- **THEN** ACS records the delivery as accepted against the evidenced turn without sending it again

#### Scenario: Runtime evidence proves non-acceptance

- **WHEN** the runtime provides authoritative evidence that the flushed direct request was not accepted
- **THEN** ACS MAY return the delivery to a retryable pending state if policy permits

#### Scenario: Runtime evidence is inconclusive

- **WHEN** authoritative runtime evidence cannot prove whether direct delivery was accepted
- **THEN** ACS leaves the delivery in `acceptance-unknown` for audited operator resolution

#### Scenario: Context-only delivery has no history marker

- **WHEN** available runtime evidence contains no exact direct-delivery marker
- **THEN** ACS retains acceptance uncertainty and does not infer rejection or resend
- **AND** history-only context append is not an available fallback

### Requirement: Local approvals and owned cancellation

ACS SHALL leave permission and user-input responses to the local owner and SHALL interrupt only executions created and correlated by ACS, except that it MAY interrupt an active user-owned Codex turn for its current bound agent when the current sender principal belongs to its matching enabled binding, has `a2a:preempt`, and the current recipient binding matches the exact fenced epoch with `allowPeerPreemption: true` immediately before `turn/interrupt`.

#### Scenario: Fanned-out user-input request

- **WHEN** Codex sends ACS a request for local user input
- **THEN** ACS records the wait without answering the request

#### Scenario: Unrelated active turn

- **WHEN** interruption would affect a turn that is neither created and correlated by ACS nor an active user-owned Codex turn for the current recipient binding with all final sender and recipient fences satisfied
- **THEN** ACS does not interrupt that turn

#### Scenario: Bound agent has an active user-owned Codex turn

- **WHEN** the current recipient binding has an active user-owned Codex turn and the final sender principal/binding/`a2a:preempt` and recipient binding/`allowPeerPreemption` fences all hold
- **THEN** ACS MAY interrupt that exact turn before continuing ordinary direct delivery

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

### Requirement: Delivery priority is distinct from preemption

ACS SHALL preserve `low`, `normal`, and `high` delivery priority as scheduling input and SHALL represent preemption as a separate optional request. Priority alone SHALL NOT authorize or cause runtime interruption.

#### Scenario: High-priority message targets a busy recipient

- **WHEN** a high-priority message is eligible alongside lower-priority pending deliveries without a preemption request
- **THEN** ACS may schedule it first but does not interrupt the recipient's active execution

#### Scenario: Normal-priority message requests preemption

- **WHEN** a normal-priority message includes a valid preemption request
- **THEN** ACS evaluates preemption independently of its scheduling priority

### Requirement: Preemption failure preserves delivery

Once a message is authorized and durably accepted for ordinary delivery, ACS SHALL treat preemption as best-effort acceleration. If interruption is unauthorized, disabled by recipient policy, stale, unsupported, unnecessary, or rejected, ACS SHALL proceed through ordinary direct delivery and SHALL expose that delivery proceeded without interruption.

#### Scenario: Preemption authority is absent

- **WHEN** a message is authorized for ordinary delivery but its sender lacks preemption authority
- **THEN** ACS skips interruption, proceeds with ordinary direct delivery, and reports the preemption downgrade

#### Scenario: Recipient does not permit preemption

- **WHEN** a message is authorized for ordinary delivery but the recipient binding has not opted into peer preemption
- **THEN** ACS skips interruption, proceeds with ordinary direct delivery, and reports the preemption downgrade

#### Scenario: Sender or recipient authority becomes stale

- **WHEN** the sender principal or binding is disabled, the recipient binding changes, or recipient preemption policy is missing before interruption
- **THEN** ACS makes no interrupt mutation, proceeds with ordinary direct delivery, and reports the classified preemption downgrade

#### Scenario: Runtime cannot interrupt

- **WHEN** the target adapter does not support interruption or rejects the interruption request definitively
- **THEN** ACS proceeds with ordinary direct delivery and reports the interruption outcome separately from delivery

#### Scenario: Ordinary delivery is unauthorized

- **WHEN** the sender lacks authority to send the message
- **THEN** ACS rejects the message without treating preemption as alternate delivery authority

### Requirement: Preemption is interrupt-then-deliver

For an eligible preemption request, ACS SHALL revalidate the current sender principal, matching binding, and `a2a:preempt` scope and the exact recipient binding epoch and `allowPeerPreemption` policy immediately before adapter invocation. ACS SHALL interrupt only the exact runtime execution authorized by that current policy, establish a safely deliverable runtime state, and then submit the peer message through the existing direct-delivery path. Immediately before `turn/interrupt`, the adapter SHALL repeat the complete sender and recipient fence; no stale scheduler gate may call the runtime mutation. Runtime interruption itself SHALL NOT carry or upgrade peer content. Runtime acceptance of an interruption request SHALL NOT by itself be reported as confirmed interruption.

#### Scenario: Eligible active execution

- **WHEN** ACS proves the target execution is current, active, interruptible, and authorized for preemption
- **THEN** ACS interrupts that execution and submits the peer message through direct delivery once the session is safely deliverable

#### Scenario: Sender authority changes after scheduling

- **WHEN** scheduling found both preemption gates valid but the sender principal, sender binding, sender `a2a:preempt` scope, recipient binding epoch, or `allowPeerPreemption` changes before `turn/interrupt`
- **THEN** the final fence makes zero interrupt mutations, records a classified noisy downgrade, and continues ordinary direct delivery

#### Scenario: No active execution

- **WHEN** an authorized preemption request finds no active execution to interrupt
- **THEN** ACS immediately attempts ordinary direct delivery and reports that interruption was unnecessary

#### Scenario: Runtime accepts the interruption request

- **WHEN** the runtime accepts an interruption request but has not yet produced authoritative evidence that the exact execution was interrupted
- **THEN** ACS reports interruption as pending confirmation and waits for completion or reconciled runtime state before claiming interruption succeeded

#### Scenario: Exact execution is confirmed interrupted

- **WHEN** authoritative runtime evidence identifies the exact target execution as interrupted
- **THEN** ACS reports interruption as achieved and proceeds with direct delivery once the runtime is safely deliverable

#### Scenario: Interruption outcome is ambiguous

- **WHEN** an interruption request may have been accepted but ACS cannot prove the resulting runtime state
- **THEN** ACS keeps the message pending, reconciles runtime state without blind mutation retries, and delivers as soon as a safe direct-delivery state is established within the message deadline

#### Scenario: Flushed interruption response is lost

- **WHEN** the exact runtime interrupt request was flushed but ACS receives no definitive response
- **THEN** ACS records the exact execution for reconciliation, performs no second interrupt mutation for that message, and reconciles that exact execution before ordinary delivery

### Requirement: Preemption and delivery outcomes are independently visible

ACS SHALL expose whether preemption was requested, attempted, pending confirmation, achieved, unnecessary, downgraded with a reason, or unresolved independently from the message's delivery state. A successful delivery after failed interruption SHALL remain successful while retaining the preemption outcome for the sender.

#### Scenario: Delivery succeeds after interruption fails

- **WHEN** interruption fails definitively and subsequent ordinary direct delivery is runtime-accepted
- **THEN** the sender can observe successful delivery and the reason preemption was downgraded

#### Scenario: Preemption remains unresolved

- **WHEN** interruption acceptance is ambiguous while delivery remains pending
- **THEN** the sender can observe the unresolved preemption outcome without ACS claiming runtime delivery acceptance

#### Scenario: Codex interruption is rejected definitively

- **WHEN** the Codex adapter classifies a generic interruption RPC error as unsupported or definitively rejected
- **THEN** ACS records the classified downgrade, preserves safe diagnostic detail for audit, and proceeds with ordinary delivery

#### Scenario: Fallback reaches an active Codex turn

- **WHEN** ACS proceeds with ordinary delivery while a Codex turn remains active
- **THEN** ACS uses the existing named tool-output delivery path so Codex may queue the message without representing peer content as user input

### Requirement: Acceptance and observation milestones remain separate

ACS SHALL distinguish durable acceptance, preemption outcome, runtime delivery acceptance, explicit agent acknowledgement when available, and task reply or state transition. None of these milestones SHALL be inferred from another.

#### Scenario: Tool-heavy active turn

- **WHEN** the runtime accepts a peer message while the recipient remains inside long-running tool activity
- **THEN** ACS reports runtime delivery acceptance and leaves acknowledgement or reply unset until message-specific evidence exists

#### Scenario: Runtime lacks acknowledgement evidence

- **WHEN** the runtime provides no authoritative message-specific observation signal
- **THEN** ACS omits the acknowledgement milestone rather than inferring it from elapsed time, interruption, turn completion, or generic assistant output

### Requirement: Interruption is harness-neutral

Application and domain code SHALL express interruption through runtime-neutral capabilities and opaque execution references. Harness-specific operations such as Codex `turn/interrupt` SHALL remain inside the runtime adapter.

#### Scenario: Adapter lacks interruption support

- **WHEN** a runtime adapter reports no interruption capability and a caller requests preemption
- **THEN** ACS noisily downgrades to ordinary direct delivery without branching on the harness identity in application or domain code

### Requirement: Delivery priority is bounded

An eligible intent waiting at least 60 seconds SHALL sort ahead of fresh traffic while preserving per-recipient serialization. Priority alone SHALL NOT cause runtime interruption.

#### Scenario: Sustained high-priority traffic

- **WHEN** high-priority messages continue to arrive while normal or low-priority messages remain pending
- **THEN** the scheduler eventually services eligible lower-priority traffic according to its anti-starvation policy

#### Scenario: Eligible intent reaches the age threshold

- **WHEN** a pending eligible intent has waited at least 60 seconds
- **THEN** ACS sorts it ahead of fresh traffic without interrupting active work solely because of priority

### Requirement: Direct session delivery

ACS SHALL deliver each peer message directly to the reachable bound runtime session using a runtime-native active-input mechanism. For Codex, ACS SHALL submit the canonical delivery envelope as named tool output with empty local-user input. When the recipient is idle, the runtime MAY start a new turn; when the runtime accepts the input into an already-active supported turn, ACS SHALL record that existing turn. ACS SHALL NOT use history-only context append as a delivery fallback.

#### Scenario: Recipient is idle

- **WHEN** a direct delivery targets a reachable idle recipient
- **THEN** ACS submits the peer message through native named tool output and records the new accepting turn identifier

#### Scenario: Recipient has an active supported turn

- **WHEN** a direct delivery targets a reachable recipient whose runtime accepts peer input into the current active turn
- **THEN** ACS records runtime acceptance against that active turn without pretending ACS owns a new turn

#### Scenario: Runtime reports an unknown start-or-join relationship

- **WHEN** the runtime accepts the direct input and returns a turn identifier but cannot prove whether the delivery started or joined the turn
- **THEN** ACS records runtime acceptance with execution relationship `unknown` rather than inferring `started`

#### Scenario: Active runtime state cannot accept direct input

- **WHEN** the recipient runtime rejects direct input in the current state
- **THEN** ACS keeps the delivery pending for a later direct attempt and does not append the message to history

#### Scenario: Recipient is blocked on local input or approval

- **WHEN** the runtime reports that the recipient is awaiting locally-owned approval, authentication, or user input and direct delivery is not safe
- **THEN** ACS keeps the delivery pending or reports the precise blocked state and does not answer, deny, or bypass the local request

#### Scenario: Recipient runtime route is unavailable

- **WHEN** ACS cannot reach the app-server/runtime control plane that owns the recipient session
- **THEN** ACS keeps the delivery pending and does not append it to history or require inbox polling as successful delivery

#### Scenario: Owning app-server disconnects

- **WHEN** an app-server disconnects after reporting a bound session available
- **THEN** ACS atomically marks the app-server's persisted runtime installation record and its active bindings offline
- **AND** ACS preserves the logical agents and refreshes binding availability from the sessions owned by the app-server after reconnect

### Requirement: Peer provenance is preserved

ACS SHALL deliver peer content through a runtime representation that names the authenticated sender and carries principal-derived provenance. `bound-agent` requesters SHALL have `workAuthority: "delegated"`; `external-a2a-client` and `service` requesters SHALL have `workAuthority: "untrusted"`. ACS SHALL NOT accept authority fields from callers or fabricate local user, developer, or system input solely to make direct delivery succeed.

#### Scenario: Codex peer message is delivered

- **WHEN** ACS submits a peer message to Codex
- **THEN** the canonical delivery envelope is represented as named tool output under the ACS namespace, visibly identifies the peer agent, and no local `UserInput` item is fabricated

#### Scenario: Recipient explicitly replies to a bound requester

- **WHEN** the recipient explicitly completes, fails, or requests input on a subscribed task from an attested bound agent
- **THEN** ACS durably queues and directly injects the task event into the requester's pinned originating session without requiring mailbox polling

#### Scenario: Peer requests privileged action

- **WHEN** peer content asks the recipient to approve or authorize an operation
- **THEN** ACS grants no permission and the recipient runtime retains its own local approval policy

#### Scenario: Bound agent delegates ordinary work

- **WHEN** an authenticated `bound-agent` requester sends a task
- **THEN** ACS marks the work as delegated so the recipient may execute it under its existing sandbox, approval policy, and permissions
- **AND** the delegation cannot approve prompts or expand those permissions

#### Scenario: External principal sends work

- **WHEN** an `external-a2a-client` or `service` requester sends a task
- **THEN** ACS marks the work authority as untrusted

#### Scenario: Requester principal is malformed

- **WHEN** scheduler delivery cannot map the persisted requester principal to a supported principal kind
- **THEN** delivery fails closed instead of guessing work authority

### Requirement: Delegated task reply contract is explicit

Each delivered delegated task SHALL identify its task and delivery and SHALL name the tools for acknowledgement, completion, failure, and requesting input. A final assistant response alone SHALL NOT satisfy this contract.

#### Scenario: Recipient receives delegated work

- **WHEN** ACS builds the runtime envelope for an A2A task
- **THEN** the reply contract contains `taskId`, `deliveryId`, `acknowledgeTool`, `completeTool`, `failTool`, and `requestInputTool`

#### Scenario: Recipient cannot continue

- **WHEN** a recipient is genuinely blocked on information from the requester
- **THEN** it uses the task-specific input-request operation rather than seeking local authorization merely because the work was delegated

### Requirement: Unsupported context-only steering is not used

ACS SHALL NOT use Codex `turn/steer` with empty input and `additionalContext` as its peer-message delivery path for a Codex profile whose upstream behavior rejects context-only steering. ACS SHALL NOT add fake user input to work around that rejection.

#### Scenario: Pinned Codex profile rejects empty-input steering

- **WHEN** compatibility evidence shows `turn/steer` with empty `input` and context-only peer data is rejected
- **THEN** ACS uses the supported native named-tool-output direct-delivery path instead and records exact-turn conditional steering as unsupported for that profile

### Requirement: Shared-turn task correlation

ACS SHALL allow multiple direct deliveries to reference one runtime turn without treating that turn's final output as the result of every task. Each delivery SHALL retain its own message/task identity and reply contract.

#### Scenario: Several peer messages enter one active turn

- **WHEN** two or more peer messages/tasks are accepted into the same runtime turn
- **THEN** ACS records each delivery separately and preserves independent reply/task correlation

#### Scenario: Shared turn produces a final assistant response

- **WHEN** a runtime turn associated with multiple peer deliveries completes
- **THEN** ACS records the runtime output but does not automatically attribute that response as the result of every associated task

### Requirement: Runtime completion does not imply task completion

A delegated A2A task SHALL enter a terminal completed or failed state only through an explicit task-specific operation or requester cancellation semantics. Runtime `turn/completed` SHALL NOT automatically complete a delegated task, even when the task's first delivery started the runtime turn.

#### Scenario: ACS-started turn completes

- **WHEN** a peer task delivery causes Codex to start a new turn and that turn later completes
- **THEN** ACS records the runtime execution as completed but leaves the A2A task non-terminal until the recipient explicitly completes, fails, or requests further input on that task

#### Scenario: Recipient explicitly completes the task

- **WHEN** the attested recipient calls the task-completion operation for that task
- **THEN** ACS transitions that task according to the task state machine independently of the runtime turn lifecycle

### Requirement: Task cancellation is isolated from shared-turn interruption

Canceling a peer task SHALL NOT automatically interrupt a runtime turn that may contain local work or other peer tasks. Runtime interruption is permitted only when ACS can prove isolated execution ownership and policy explicitly allows interruption.

#### Scenario: Cancel one task sharing a runtime turn

- **WHEN** the requester cancels one peer task whose delivery is associated with a turn containing other work
- **THEN** ACS changes the task/delivery cancellation state without interrupting the shared runtime turn

#### Scenario: Isolated ACS-owned execution is cancelable

- **WHEN** ACS can prove the runtime execution is isolated to the canceled work and interruption is authorized
- **THEN** the runtime adapter MAY interrupt that execution and record the runtime cancellation evidence
