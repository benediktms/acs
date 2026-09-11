## Context

ACS already accepts `low`, `normal`, and `high` delivery priority and orders pending intents by that stored priority. Direct delivery uses named tool output through `turn/start`; runtime acceptance does not prove that the model has observed the message, especially while a turn is executing tools.

Codex exposes `turn/interrupt`, but the current shared app-server adapter does not claim ownership of user sessions and therefore does not advertise owned-execution cancellation. Preemption must preserve that safety boundary while ensuring that failure to accelerate an important message does not discard the message itself.

## Goals / Non-Goals

**Goals:**

- Preserve the existing priority contract and add preemption as an independent request.
- Attempt interruption only with explicit caller authority, recipient opt-in, a current binding, and an exactly identified eligible execution.
- Continue toward ordinary direct delivery when interruption is unavailable or fails.
- Tell the sender whether interruption happened and whether delivery proceeded without it.
- Preserve ambiguous-acceptance and binding-fence safety.

**Non-Goals:**

- Guarantee immediate model observation.
- Make `high` priority interrupt active work.
- Let preemption bypass ordinary send authorization or local runtime policy.
- Interrupt an unowned or ambiguously identified execution.

## Decisions

### Keep priority and preemption orthogonal

The existing `priority?: "low" | "normal" | "high"` contract remains unchanged. A separate optional `preempt?: boolean` defaults to `false`.

Priority controls ordering among pending deliveries. Preemption asks ACS to accelerate one delivery by interrupting eligible active work. A high-priority message need not request preemption, and a normal-priority message may request it.

### Make interruption authority operator-owned and binding-lifetime

Only the local-user control plane can grant `a2a:preempt` while directly binding an agent or creating its claim. The grant is stored on the bound principal and lasts only for that binding. Rebinding or revoking disables the old principal and ends its grant.

Only that same local-user path can enable `allowPeerPreemption` on a recipient binding; it defaults to `false`. Claim creation persists both operator-selected values. `acs_claim` can supply only consumer-owned session, continuity, and replacement inputs and cannot add scopes or delivery policy. `acs_register` always creates safe defaults. Neither ordinary `a2a:send`, priority, message content, nor unrecognized control input grants interruption authority.

Token issuance rejects every requested scope outside the enabled, current principal's durable scopes. The trusted bridge first freshly attests that principal: for `preempt: true`, it requests `a2a:preempt` only when that attestation confirms the durable grant; otherwise it omits the extra scope, sends with ordinary authority, and records `downgraded/missing-sender-authority`.

### Treat preemption as best-effort acceleration

Ordinary send authorization is evaluated first. Once ACS durably accepts a message, failure to preempt is not a delivery failure.

ACS attempts interruption only when:

1. the sender has explicit preemption authority;
2. the recipient binding opts into peer preemption;
3. the binding fence is current;
4. the adapter advertises interruption support;
5. the exact active execution is known and eligible under local policy.

If sender authority or recipient policy/fencing fails, or the runtime reports unsupported or rejected, ACS skips or stops interruption and immediately proceeds through the existing direct-delivery path with a noisy downgrade. If there is no active execution, interruption is unnecessary rather than downgraded, and ACS immediately proceeds through ordinary delivery.

This reuses the existing binding delivery-policy boundary for recipient opt-in. It does not treat peer content, priority, or ordinary `a2a:send` authority as permission to interrupt.

The scheduler rechecks the sender's current non-disabled principal, matching binding, and `a2a:preempt` scope plus the recipient's current binding epoch and `allowPeerPreemption` immediately before adapter invocation. Immediately before `turn/interrupt`, the adapter repeats that complete sender and recipient fence; no stale scheduling gate may authorize a runtime mutation. Missing or stale authority or policy produces a classified noisy downgrade and ordinary delivery continues; sender authority is not snapshotted when delivery is accepted.

### Report preemption separately from delivery

The existing delivery-status projection remains the sender-facing source. For a preemption request it records:

- that preemption was requested;
- whether interruption was attempted;
- the interruption outcome or reason;
- whether delivery proceeded without interruption;
- the independent delivery state.

The initial durable-acceptance response may report preemption as pending. Later task reads or subscribed updates expose the resolved outcome. A successful ordinary delivery after failed interruption remains a successful delivery with an explicit preemption downgrade.

### Interrupt, reconcile, then deliver

The preferred sequence is:

```text
durably accept message
  -> validate preemption authority and target policy
  -> discover one exact in-progress execution through newest-first thread/turns/list
  -> revalidate complete authority fence and interrupt that exact execution once
  -> establish a safely deliverable runtime state
  -> submit through existing direct delivery
  -> report interruption and delivery outcomes separately
```

Codex returning success from `turn/interrupt` proves only that the interrupt request was accepted. ACS reports interruption as achieved only after `turn/completed` identifies the exact turn with status `interrupted`, or equivalent authoritative adapter evidence establishes the same outcome. A definitive failure proceeds directly to ordinary delivery.

If interruption acceptance is ambiguous, ACS does not blindly issue another interruption or start conflicting replacement work. It reconciles runtime state, keeps the message pending, and delivers as soon as the adapter can establish a safe direct-delivery state. Existing message deadlines remain authoritative; without a deadline, ambiguity delays rather than abandons delivery.

For Codex, discovery uses only `thread/turns/list` with `cursor: null`, `limit: 1`, descending sort, and omitted items; only a sole non-empty `inProgress` ID is eligible. The reconciliation read with turns included applies only to that already-known exact ID; it is not a lookup for an active execution. Exact stale-ID and no-active rejection are unnecessary, not a retry signal; generic RPC rejection is classified as unsupported, definitive, or unresolved without exposing harness-specific identifiers through domain contracts.

Fallback delivery continues to use `turn/start` with named `toolOutput`, including when Codex queues that input behind active work. ACS does not use `turn/steer`, because steering represents peer content as user input and would lose the existing named-tool provenance boundary.

### Keep interruption harness-neutral

The runtime contract gains separate find-active, exact-interrupt, and exact-reconciliation operations over opaque execution references. Application and domain code never branch on the harness identity or expose Codex turn IDs.

The Codex adapter maps an eligible request to exact `turn/interrupt(threadId, turnId)`. An active user-owned Codex turn may be eligible only when it belongs to the current recipient binding and the complete final sender and recipient fence still holds. It advertises the capability only after real-Codex tests establish the pinned runtime's state transitions and ambiguous-write behavior.

One preemption request makes at most one interrupt mutation. After a flushed request with no definitive response, ACS persists the exact reconciliation identity, reconciles exact turn state, and never blindly retries the interrupt.

The runtime-neutral interruption result distinguishes request acceptance from confirmed interruption and exposes only the minimum states needed by delivery orchestration: pending confirmation, interrupted, unnecessary, downgraded with a reason, or unresolved. Sender authorization and recipient policy failures are ACS decisions, not Codex outcomes; runtime delivery success or failure remains independent.

### Preserve existing milestones

Durable acceptance, interruption outcome, runtime delivery acceptance, explicit agent acknowledgement, and task reply or transition remain distinct. ACS does not infer model observation from interruption, turn completion, elapsed time, or generic assistant output.

### Bound priority without redesigning it

Existing numeric priority storage and ordering stay in place. An eligible intent waiting at least 60 seconds sorts ahead of fresh traffic while preserving per-recipient serialization.

## Risks / Trade-offs

- **Downgraded delivery may still be observed late** -> report the downgrade immediately and preserve the message's priority while it remains pending.
- **Interruption succeeded but its response was lost** -> reconcile before direct delivery; do not blindly repeat either mutation.
- **Codex accepts an interrupt request but has not completed the turn** -> retain a pending interruption outcome until authoritative completion or reconciliation evidence arrives.
- **Codex returns only a generic RPC rejection** -> classify it in the adapter, retain safe diagnostic detail for audit, and noisily downgrade unless acceptance remains ambiguous.
- **A sender treats preemption as authority** -> require ordinary send authority plus a separate preemption grant and recipient opt-in.
- **Runtime support differs from advertised capability** -> keep capability advertisement behind pinned real-runtime evidence.
- **A deadline expires during ambiguous reconciliation** -> expose the independent terminal delivery failure and the unresolved preemption outcome.

## Migration Plan

Add `preempt` as an optional field defaulting to `false`, so existing callers and stored messages keep their current behavior. Persist preemption request and outcome separately from delivery state in one JSON column on `delivery_intents`, leaving the accepted payload hash unchanged. Extend delivery status additively. Advertise runtime interruption only after conformance evidence passes; otherwise preemption requests noisily downgrade to ordinary delivery.
