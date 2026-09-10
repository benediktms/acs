## Why

Direct peer-message delivery can be accepted by a recipient runtime before the model observes it. Important messages need a best-effort way to interrupt long-running work, but failure to interrupt must not prevent eventual delivery or leave the sender believing preemption succeeded.

## What Changes

- Preserve the existing `low`, `normal`, and `high` delivery priority contract; priority continues to affect scheduling only.
- Add an optional preemption request separately from priority. Preemption attempts to interrupt an eligible execution before using the existing direct-delivery path.
- Treat preemption as best-effort acceleration: an unauthorized, unsupported, unnecessary, or rejected interruption falls back to ordinary direct delivery.
- Report every requested preemption outcome to the sender, distinguishing pending confirmation, confirmed interruption, unnecessary interruption, classified downgrade, and unresolved ambiguity from the independent delivery outcome. Never silently downgrade.
- If interruption acceptance is ambiguous, reconcile runtime state before delivery rather than risking duplicate or conflicting work; keep retrying toward delivery within the message's existing deadline.
- Keep interruption runtime-neutral outside adapters and preserve exact execution ownership, binding fences, local permission ownership, and auditability.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `runtime-delivery`: add best-effort preemption before direct delivery, explicit downgrade reporting, and bounded priority behavior.
- `a2a-messaging`: allow an authorized sender to request preemption separately from delivery priority and observe its outcome.

## Impact

- A2A delivery metadata, MCP send input, runtime-neutral delivery contracts, and delivery-status projection.
- Delivery scheduling fairness and preemption authorization policy.
- Runtime execution ownership checks and the Codex adapter's `turn/interrupt`, `turn/completed`, `thread/read`, and named-tool-output fallback mapping.
- Audit and telemetry for preemption requests, interruption outcomes, downgrade, and subsequent delivery.
- Targeted protocol, storage, scheduler, adapter, and real-Codex compatibility tests.

## Non-Goals

- Guaranteeing immediate model observation after runtime acceptance.
- Treating high priority as permission to interrupt.
- Letting preemption bypass ordinary send authorization, recipient policy, local approvals, or binding fences.
- Interrupting an execution ACS cannot identify and is not authorized to control.
- Inferring message acknowledgement from elapsed time, turn completion, or generic assistant output.
