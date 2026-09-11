## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Atomic durable acceptance

ACS SHALL commit the task, message, append-only event, idempotency record, delivery intent, and initial independent preemption status atomically before reporting durable acceptance. Runtime acceptance SHALL be tracked separately.

#### Scenario: Acceptance write fails

- **WHEN** any write in message acceptance fails
- **THEN** no partial acceptance is committed

#### Scenario: Duplicate message

- **WHEN** an equivalent request repeats an accepted idempotency identity
- **THEN** ACS returns the existing task without creating a duplicate delivery or changing its preemption status
