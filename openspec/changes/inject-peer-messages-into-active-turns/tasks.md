## 1. Direct Delivery Contract

- [x] 1.1 Replace `wake_when_idle`, `append_context`, and `join_active` with `direct` across the runtime, A2A, MCP, control, and JSON Schema contracts; verify typecheck and schema validation reject removed modes.
- [x] 1.2 Remove per-binding wake strategy and active-steering flags from configuration and diagnostics; verify the targeted config and control tests pass.
- [x] 1.3 Update the initial storage/schema representation directly to the direct-delivery model; do not add unused legacy-row migration or rollback compatibility machinery.

## 2. Codex Native Direct Injection

- [x] 2.1 Extend the Codex protocol codec and app-server client with typed named-tool-output `turn/start` submission using empty `input`, `namespace: "acs"`, `name: "receive_agent_message"`, and the canonical delivery envelope; verify generated-protocol checks and targeted client tests pass.
- [x] 2.2 Implement direct delivery so a reachable recipient session receives the named tool output whether Codex starts a new turn or accepts the input into a supported existing turn; record the accepting turn ID and do not infer ownership from the method name.
- [x] 2.3 Add runtime evidence for `started | joined | unknown` execution relationship when Codex can establish it; verify the adapter never reports `started` merely because `turn/start` was called.
- [x] 2.4 Map dormant, unloaded, offline, locally-blocked, stale-binding, unsupported-active-state, and route-unavailable outcomes to deferred delivery without `thread/inject_items`; verify targeted adapter mutation assertions observe no history append.
- [x] 2.5 Add exact delivery-marker reconciliation for direct requests and retain `acceptance-unknown` when runtime evidence is inconclusive; verify ambiguous-write adapter tests do not blindly resend.
- [x] 2.6 Add an upstream-evidence regression test/documentation note that empty-input `turn/steer` with only `additionalContext` is rejected by the pinned Codex profile; do not fabricate user input as a workaround.
- [x] 2.7 Atomically mark an app-server's runtime installation record and active bindings offline when it disconnects, preserve logical agents, and refresh availability from bound sessions after reconnect; verify with a targeted scheduler regression test.

## 3. Shared Turn Correlation and Task Semantics

- [x] 3.1 Change runtime execution persistence and in-memory correlation so several delivery IDs can reference one runtime turn; verify storage and scheduler tests cover multiple deliveries sharing a turn.
- [x] 3.2 Require explicit task completion, failure, or input request for **all** delegated tasks, including tasks whose first delivery started a new Codex turn; verify `turn/completed` records runtime execution state but does not terminally transition the A2A task.
- [x] 3.3 Keep message/task reply correlation explicit and task-specific; verify a shared final assistant response is not automatically attributed to every delivery in the turn.
- [x] 3.4 Harden cancellation so canceling one peer task does not interrupt a shared or user-owned turn unless ACS can prove isolated execution ownership and policy permits interruption; verify targeted scheduler/runtime tests.

## 4. External Behavior and Evidence

- [x] 4.1 Remove caller-selected delivery policy from A2A and MCP send surfaces, default accepted messages to direct delivery, and return invalid parameters for removed modes; verify targeted A2A and MCP tests pass.
- [x] 4.2 Enable direct delivery for the pinned Codex profiles after real-Codex tests prove idle and active-session delivery, peer/tool provenance, returned/observed turn correlation, and no history-append fallback; retain per-attempt binding, route, local-input, approval, and direct-input safety gates.
- [x] 4.3 Add a real-Codex test for several peer messages delivered to one active turn and verify their task/reply correlations remain independent.
- [ ] 4.4 Complete the real-Codex reconnect and ambiguous-write matrix where feasible; verify a lost response after write leads to authoritative reconciliation or `acceptance-unknown`, never blind retry.
- [x] 4.5 Update OpenSpec, threat model, README, conformance report, and two-agent workflow to describe direct session delivery, explicit task completion, and route requirements; verify stale history-append/polling-as-delivery claims are absent with a targeted text search.
- [x] 4.8 Prove a subscribed reply is automatically delivered to the requester's pinned bound session without polling, and make the named tool-output envelope visibly identify agent messages and replies.
- [ ] 4.9 Complete the live interactive matrix for locally-owned approval and user-input states; verify ACS defers without answering, denying, or bypassing the local request.
- [ ] 4.6 Reconcile the implementation with https://github.com/benediktms/acs/pull/14, https://github.com/benediktms/acs/pull/15, https://github.com/benediktms/acs/pull/16, https://github.com/benediktms/acs/pull/19, and https://github.com/benediktms/acs/pull/35; verify each remaining PR either targets the direct-delivery contract or is explicitly superseded.
- [ ] 4.7 Run strict OpenSpec validation plus affected test files, typecheck, lint, formatting, import-boundary, enum, and generated-protocol checks; leave the full suite to CI.

## 5. Autonomous Bound-Agent Delegation

- [x] 5.1 Specify principal creation and resolution, A2A rejection of `local-user`, role/identity separation, assigned-executor authorization, principal-derived work authority, and the permission-escalation boundary.
- [ ] 5.2 Add principal-derived `delegated | untrusted` work authority and the complete task reply contract to runtime envelopes; fail closed for unsupported requester principal kinds.
- [ ] 5.3 Publish trusted MCP initialization instructions that permit delegated work and ACS lifecycle/coordination calls under existing local policy while forbidding permission escalation and approval replies.
- [ ] 5.4 Update security/operator documentation and add the smallest targeted storage, A2A, scheduler, MCP, contract, and adapter regression coverage.

## Verification record

See `docs/direct-delivery-verification.md`. Static checks and affected tests run
without user credentials. `test:codex-real` uses the actual Codex executable and
a local mock model endpoint; it does not certify human TUI/desktop approval
ownership or real-model semantics. Direct delivery is enabled as the core path
with per-attempt safety gates; the remaining interactive evidence stays explicit
above. The native CI matrix validates both configured Codex versions; full-suite/TCK
results are reported by CI rather than inferred from compilation. Older open PR
reconciliation and the real interactive matrix remain separate outstanding checks.
