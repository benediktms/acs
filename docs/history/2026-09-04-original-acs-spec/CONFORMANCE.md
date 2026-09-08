# Runtime Adapter Conformance Profile v1

This document is normative for every `RuntimeAdapter` implementation.

## Test harness contract

An adapter test fixture supplies:

- one reachable runtime installation;
- one idle session;
- one busy session;
- one dormant/offline session;
- one stale binding epoch;
- a deterministic clock;
- a controllable transport failure injector;
- a way to inspect vendor-side mutations.

## Required tests

### Lifecycle

1. `start` is idempotent for one adapter instance.
2. `stop` terminates `observe` and releases transport resources.
3. Calls after `stop` reject with a local lifecycle error and perform no vendor mutation.
4. `probe` reports incompatible runtime separately from transient unavailability.

### Session normalization

5. `listSessions` returns opaque identifiers.
6. `inspectSession` maps idle, busy, dormant, offline, degraded and unknown conservatively.
7. New/unknown vendor statuses never map to idle.
8. Session metadata does not include secrets.

### Binding fences

9. A stale epoch returns `rejected/stale-binding`.
10. No vendor bytes are written after a failed fence.
11. Revocation racing delivery is caught by the final fence.
12. Accepted execution retains its original binding epoch.

### Context-only delivery

13. Supported content is appended once.
14. Context append does not start execution.
15. Positive vendor acknowledgement maps to `accepted` without an execution reference when appropriate.
16. Disconnect before write maps to deferred/offline.
17. Disconnect after write maps to acceptance-unknown.
18. Reconciliation finds the exact delivery marker.
19. Unsupported parts fail before vendor mutation.

### Wake delivery

20. Busy session returns deferred unless an advertised and selected atomic queue is used.
21. Active steering is never used when policy forbids it.
22. Wake acceptance returns a stable runtime execution reference.
23. One delivery produces at most one concurrently initiated runtime execution.
24. Vendor overload maps to deferred/backpressure.
25. Ambiguous response never causes an automatic second wake.
26. Runtime settings are inherited, not overridden.

### Events

27. Only correlated executions emit application execution events.
28. Final output excludes hidden reasoning.
29. Local approval/input emits `execution.awaiting-local-input`.
30. Local approval is not converted into peer-answerable A2A input.
31. Successful completion produces final parts.
32. Unknown vendor notifications are ignored or mapped to status diagnostics without crashing.

### Cancellation

33. Pending delivery can be canceled without vendor mutation.
34. Exact ACS-owned execution can be canceled when capability is advertised.
35. An unrelated or user-owned execution is never interrupted.
36. Ambiguous cancellation reports unknown, not canceled.

### Reconciliation

37. Exact marker found returns accepted.
38. Definitive absence may return not-accepted with `safeToRetry=true`.
39. Truncated/unavailable history returns inconclusive.
40. Repeating reconciliation is idempotent.

### Backpressure and shutdown

41. Adapter honors `AbortSignal`.
42. In-flight request limits are enforced.
43. Graceful shutdown marks flushed/unanswered writes as acceptance-unknown.
44. Observation reconnect triggers authoritative session reconciliation.

## Codex-specific required evidence

The Codex adapter adds tests proving:

- app-server initialize/initialized ordering;
- omission of `jsonrpc` on app-server wire;
- `thread/inject_items` named tool-output semantics;
- `turn/start` with empty input and named `toolOutput`;
- exact mapping of overload error;
- app-server daemon reconnect;
- `_meta.threadId` caller attestation;
- approval ownership with a simultaneous interactive client;
- active-turn race behavior;
- delivery marker visibility in history.

## Conformance report

Every release artifact includes a machine-readable report:

```json
{
  "adapterApiVersion": 1,
  "adapterId": "codex.app-server",
  "implementationVersion": "0.1.0",
  "runtimeVersion": "<tested Codex version>",
  "passed": 44,
  "failed": 0,
  "capabilities": {
    "appendContext": true,
    "wakeWhenIdle": true,
    "atomicDeferredWake": false,
    "steerActiveExecution": false,
    "cancelOwnedExecution": true,
    "reconcileDelivery": true
  }
}
```

The capability values above are illustrative. Release values come from the tested runtime.
