## 1. Operator-owned authority and public contract

- [x] 1.1 Add migration 6 for claim-persisted operator-selected principal scopes and recipient delivery policy plus `delivery_intents.preemption_status_json`; verify fresh and upgraded databases default to no `a2a:preempt` and `allowPeerPreemption: false`.
- [x] 1.2 Add local-user direct-bind and claim-creation flags for `a2a:preempt` and `allowPeerPreemption`; persist claim values atomically, reject those flags without a claim, and verify rebind or revocation disables the old principal and its grant.
- [x] 1.3 Restrict `acs_claim` to consumer-owned session, continuity, and replacement inputs and keep `acs_register` at safe defaults; verify neither, including unrecognized control fields, can self-grant scope or recipient opt-in.
- [x] 1.4 Load current durable principal scopes during attestation and cap bridge-token issuance to enabled principal scopes; verify `*` coverage and over-scoped issuance rejection, then verify the trusted bridge freshly attests, omits ungranted `a2a:preempt`, sends with ordinary authority, and records `downgraded/missing-sender-authority`.
- [x] 1.5 Preserve `low`, `normal`, and `high` priority and add optional `preempt` to A2A, MCP, storage, and runtime-neutral delivery contracts with a default of `false`; verify absent, false, true, and invalid values plus idempotency conflicts.
- [x] 1.6 Extend delivery-status projection to persist and expose independent requested, attempted, pending confirmation, achieved, unnecessary, downgraded-with-reason, and unresolved preemption state across duplicates, task reads, streams, retries, terminals, and restart.
- [x] 1.7 Require ordinary `a2a:send` before durable acceptance, then gate interruption separately on current sender `a2a:preempt` authority and recipient opt-in; verify missing or stale gates noisily downgrade without blocking ordinary delivery.

## 2. Scheduling and runtime interruption

- [x] 2.1 Add the fixed 60-second age override to the existing priority scheduler; verify sustained fresh high-priority traffic cannot starve eligible normal or low delivery and priority alone never interrupts.
- [x] 2.2 Add a harness-neutral find-active, exact-interrupt, and exact-reconciliation capability over opaque execution references; keep harness-specific turn or process identifiers inside adapters.
- [x] 2.3 Recheck current sender principal/binding/`a2a:preempt` and recipient binding epoch/`allowPeerPreemption` before adapter invocation, repeat the complete fence immediately before `turn/interrupt`, and verify a post-scheduling stale sender or recipient fence makes zero interrupt mutations while ordinary delivery continues.
- [x] 2.4 Discover only the newest exact `inProgress` Codex turn through `thread/turns/list` and map it to one exact `turn/interrupt`; treat pinned delayed RPC success or matching exact interruption evidence as authoritative.
- [x] 2.5 Classify generic Codex interruption RPC failures as unsupported, definitively rejected, or unresolved; classify idle or not-running exact-turn state as unnecessary; retain safe diagnostics for audit and noisily downgrade only definitive failures.
- [x] 2.6 Handle ambiguous interruption acceptance by persisting exact reconciliation identity and reconciling exact turn notifications and `thread/read` without a second interrupt mutation, retaining the pending message and attempting direct delivery as soon as runtime state is safe within the existing message deadline.
- [x] 2.7 Keep fallback on the existing `turn/start` named-tool-output path, including when Codex queues it behind active work; do not use `turn/steer` for peer content.
- [x] 2.8 Add isolated real-Codex coverage for active turn -> interrupt acceptance -> confirmed interrupted completion -> fallback delivery, idle or stale turn -> unnecessary -> fallback delivery, and post-write interrupt response loss -> reconciliation -> exactly-once fallback delivery before advertising interruption support.

## 3. Evidence and validation

- [x] 3.1 Update `docs/threat-model.md` with the binding-granted exception for active user-owned Codex turns, complete final mutation fence, safe defaults, and noisy downgrade; add audit and telemetry for preemption request, authorization and recipient-policy decisions, interruption outcome, downgrade, ambiguity, and subsequent delivery outcome without duplicating existing acceptance, acknowledgement, or reply milestones.
- [x] 3.2 Run `mise run specs:check`, confirm the A2A delta exists, search the change for `a2a:preempt`, `allowPeerPreemption`, registration and lifecycle terms, and run `git diff --check -- openspec/changes/define-peer-message-urgency-and-preemption`.
- [x] 3.3 Run targeted storage, control, CLI, A2A, MCP bridge, scheduler, app-server client, and runtime-adapter conformance tests plus type checking, linting, formatting checks, boundary checks, enum/generated-protocol checks, build, and strict OpenSpec validation; leave the full suite to CI.
