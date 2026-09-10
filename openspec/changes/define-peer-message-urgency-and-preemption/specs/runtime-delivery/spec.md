## ADDED Requirements

### Requirement: Delivery priority is distinct from preemption

ACS SHALL preserve `low`, `normal`, and `high` delivery priority as scheduling input and SHALL represent preemption as a separate optional request. Priority alone SHALL NOT authorize or cause runtime interruption.

#### Scenario: High-priority message targets a busy recipient

- **WHEN** a high-priority message is eligible alongside lower-priority pending deliveries without a preemption request
- **THEN** ACS may schedule it first but does not interrupt the recipient's active execution

#### Scenario: Normal-priority message requests preemption

- **WHEN** a normal-priority message includes a valid preemption request
- **THEN** ACS evaluates preemption independently of its scheduling priority

### Requirement: Preemption failure preserves delivery

Once a message is authorized and durably accepted for ordinary delivery, ACS SHALL treat preemption as best-effort acceleration. If interruption is unauthorized, disabled by recipient policy, unsupported, unnecessary, or rejected, ACS SHALL proceed through ordinary direct delivery and SHALL expose that delivery proceeded without interruption.

#### Scenario: Preemption authority is absent

- **WHEN** a message is authorized for ordinary delivery but its sender lacks preemption authority
- **THEN** ACS skips interruption, proceeds with ordinary direct delivery, and reports the preemption downgrade

#### Scenario: Recipient does not permit preemption

- **WHEN** a message is authorized for ordinary delivery but the recipient binding has not opted into peer preemption
- **THEN** ACS skips interruption, proceeds with ordinary direct delivery, and reports the preemption downgrade

#### Scenario: Runtime cannot interrupt

- **WHEN** the target adapter does not support interruption or rejects the interruption request definitively
- **THEN** ACS proceeds with ordinary direct delivery and reports the interruption outcome separately from delivery

#### Scenario: Ordinary delivery is unauthorized

- **WHEN** the sender lacks authority to send the message
- **THEN** ACS rejects the message without treating preemption as alternate delivery authority

### Requirement: Preemption is interrupt-then-deliver

For an eligible preemption request, ACS SHALL interrupt only the exact runtime execution authorized by policy, establish a safely deliverable runtime state, and then submit the peer message through the existing direct-delivery path. Runtime interruption itself SHALL NOT carry or upgrade peer content. Runtime acceptance of an interruption request SHALL NOT by itself be reported as confirmed interruption.

#### Scenario: Eligible active execution

- **WHEN** ACS proves the target execution is current, active, interruptible, and authorized for preemption
- **THEN** ACS interrupts that execution and submits the peer message through direct delivery once the session is safely deliverable

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

### Requirement: Preemption and delivery outcomes are independently visible

ACS SHALL expose whether preemption was requested, attempted, pending confirmation, achieved, unnecessary, downgraded with a reason, or unresolved independently from the message's delivery state. A successful delivery after failed interruption SHALL remain successful while retaining the preemption outcome for the sender.

#### Scenario: Delivery succeeds after interruption fails

- **WHEN** interruption fails definitively and subsequent ordinary direct delivery is runtime-accepted
- **THEN** the sender can observe successful delivery and the reason preemption was downgraded

#### Scenario: Preemption remains unresolved

- **WHEN** interruption acceptance is ambiguous while delivery remains pending
- **THEN** the sender can observe the unresolved preemption outcome without ACS claiming runtime delivery acceptance

#### Scenario: Codex interruption is rejected definitively

- **WHEN** the Codex adapter classifies a generic interruption RPC error as unsupported, not running, or definitively rejected
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

Delivery scheduling SHALL include anti-starvation behavior so sustained higher-priority traffic cannot indefinitely block eligible lower-priority messages. Preemption attempts SHALL be rate-limited or otherwise bounded by policy.

#### Scenario: Sustained high-priority traffic

- **WHEN** high-priority messages continue to arrive while normal or low-priority messages remain pending
- **THEN** the scheduler eventually services eligible lower-priority traffic according to its anti-starvation policy
