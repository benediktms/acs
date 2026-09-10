## Context

See `proposal.md` for motivation and the delta specs for behavior. Runtime bindings currently persist one coarse `last_observed_availability`, discovery copies that value into both control and MCP responses, and `currentActivity` carries a second manually maintained state. Agent deletion already provides the required tombstone, binding revocation, principal disablement, and partial unique slug behavior.

Codex app-server exposes thread execution status but does not currently expose whether a subscriber is an interactive owner or an observer such as ACS. Because app-server automatically subscribes initialized connections to threads, loaded state and subscriber count alone cannot prove that a user-facing Codex session is still open.

## Goals / Non-Goals

**Goals:**

- Keep vendor status translation inside the runtime adapter and state derivation in one harness-neutral domain function.
- Make peer discovery small and useful while retaining richer operator diagnostics.
- Reuse the existing logical deletion path and durable task event model for reaping.

**Non-Goals:**

- Inferring user presence from process lifetime, transcripts, prompts, activity TTL, or terminal scraping.
- Physically deleting historical agent, task, event, or audit rows.
- Making `currentActivity` automatic; only its summary and workspace context remain explicitly published.
- Reaping `unknown`, errored, disabled, or merely inactive agents.

## Decisions

### Normalize observations before deriving state

Replace the adapter's coarse availability snapshot with these harness-neutral dimensions:

- runtime state: `unknown | offline | not-loaded | idle | active | system-error`
- blocking reason: `none | user-input | approval | unknown`
- interactive presence: `present | absent | unknown`
- `observedAt`, revision, and existing descriptive attributes

A pure domain function maps the dimensions to peer state using the precedence defined by the spec. Persist the dimensions and observation time on the binding, then derive state at read/reconciliation time. This keeps a single mapping for control, MCP, scheduling, and reaping while retaining enough raw data for operator diagnosis.

The alternative was to persist only the derived state. That is smaller initially but loses the evidence needed to distinguish a disconnected user from an unsupported adapter and makes future mapping changes destructive.

### Require explicit Codex connection roles and thread presence

Extend the Codex app-server protocol so initialized connections declare `interactive`, `observer`, or `unspecified` through the existing `capabilities.extensions` map under `openai/thread-subscription`, and thread snapshots/notifications report whether at least one interactive subscriber is attached. ACS initializes its managed connection as `observer`. The Codex adapter translates thread status and interactive presence into the neutral observation; application code never imports the generated types.

An app-server without this capability reports presence as `unknown`. There is no compatibility heuristic because ACS itself can keep a thread loaded and would produce the same false-ready state this change is intended to remove.

### Separate peer and administrative projections

Keep the private control protocol's raw observation and binding data for operators, but make the MCP bridge emit only identity, expertise, derived state, and eligible activity summary/workspace/timestamps. Remove `currentActivity.state`: task workflow state remains available through task APIs and must not compete with runtime-derived agent state.

The normal MCP list filters out `offline` and `unknown`. Exact get retains them until reaping so an agent addressed by known identity can be diagnosed and can still receive durable queued work during the grace period. No replacement state filter is added; expertise filtering and exact lookup cover current peer-selection needs.

### Track one continuous offline interval

Add `offline_since_ms` to the logical agent. Reconciliation sets it once when derived state becomes explicitly `offline`, clears it on every non-offline state, and leaves it unchanged only for subsequent explicit offline observations. `unknown` clears rather than advances the interval so missed or unsupported presence can never cause deletion.

The existing scheduler performs a bounded periodic reap and also checks overdue agents at startup. The configured retention defaults to 24 hours. A separate worker or timer service is unnecessary at this scale.

### Reap with the existing tombstone transaction

Factor the existing logical deletion operations into one storage transaction reusable by manual deletion and reaping. Reaping additionally transitions all nonterminal target tasks to failed with reason `target-reaped`, appends their terminal events, and removes pending delivery intents before tombstoning the agent, revoking its active binding, and disabling its principals. Existing foreign-key rows remain for audit. The partial unique slug index already permits later registration to create a distinct identity.

Queued work is failed instead of transferred because slug reuse must not transfer authority or confidential task content to a new identity. Silent deletion was rejected because senders need an observable terminal outcome.

## Risks / Trade-offs

- [Codex protocol support must land first] -> Deploy the connection-role and presence capability before enabling the ACS state projection; unsupported servers report `unknown` and are never reaped.
- [Missing disconnect notifications can delay offline state] -> Refresh bound thread observations after reconnect and before each reap pass; only fresh explicit offline observations advance reaping.
- [Default list hides unknown agents during a mixed-version rollout] -> Stage app-server deployment first and retain exact lookup plus administrative diagnostics.
- [A 24-hour default can remove intentionally dormant identities] -> Keep retention configurable and preserve history through logical deletion; operators can disable reaping with no finite retention until protocol support is deployed.
- [Large task sets increase reap transaction time] -> Process only agents whose retention has elapsed and use existing indexed target/delivery relationships; add batching only if measured transaction time requires it.

## Migration Plan

1. Add Codex connection-role and interactive-presence fields/events, regenerate the pinned protocol, and deploy compatible app-servers.
2. Add nullable normalized observation fields and `offline_since_ms`; migrate existing coarse observations to `unknown` rather than guessing presence.
3. Switch reconciliation, discovery, and delivery gates to the normalized observation and derived state; remove MCP `availability` and activity state.
4. Enable the reap pass after authoritative presence is observed, with the 24-hour default retention.

Rollback disables the reap pass first, then restores the old projection while leaving additive columns and tombstoned history intact. Already reaped identities are not resurrected automatically.
