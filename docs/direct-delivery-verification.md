# Direct-delivery verification

This is a supporting test/evidence record, not a second specification. The
behavioral contract is the `inject-peer-messages-into-active-turns` OpenSpec change.

## Checks that do not require user credentials

```sh
bun run typecheck
bun run lint
bun run format:check
bun run boundaries
bun run enums:check
bun run codex:check
mise run specs:check
bun test tests/config.test.ts tests/storage.test.ts tests/a2a.test.ts tests/control.test.ts tests/scheduler.test.ts tests/runtime-adapter-conformance.test.ts tests/app-server-client.test.ts tests/packaging.test.ts tests/mcp.test.ts tests/cli.test.ts
bun run test:codex-real
```

The full suite and A2A TCK run in CI. The native CI matrix selects Codex `0.153.2`,
`0.153.4`, and `0.154.0` independently of schema generation, which remains pinned
to `0.154.0`.

The native test uses an actual Codex executable, two independent app-server
clients on one Unix socket, a fresh isolated HOME/CODEX_HOME, and a local mocked
Responses API. It never loads user authentication. It verifies:

- Input starts a fresh idle thread, including one without a persisted rollout.
- Two additional messages join that same active turn while its model response
  is deliberately held. Acceptance precedes their inclusion in the next model
  HTTP request; there is no claim of instantaneous observation.
- Each message remains a named function output in the `acs` namespace, not a
  forged local-user/developer/system item.
- Context-only empty-input `turn/steer` is rejected without merging its content.
- Each delivery ID/payload hash can be reconciled to the correct persisted turn;
  conflicting evidence remains inconclusive.
- A test-only Unix WebSocket relay can drop the response after `turn/start` reaches
  real Codex; the adapter reports `acceptance-unknown`, reconnects, reconciles to
  accepted or inconclusive evidence, and never resubmits the delivery.
- The shared adapter refuses cancellation as evidence of exclusive execution
  ownership is absent.

Fake-adapter and transport tests additionally cover lease recovery, reconnect,
post-flush lost responses and aborts, malformed success responses, exact-marker
reconciliation, local approval/user-input deferral, capability reductions, exact
binding fences, foreign-thread notifications, shared task isolation, explicit
completion, and cancellation that does not starve unrelated work. They are not
evidence for human-interactive ownership. Compiled-binary tests run without a Bun
executable in PATH and exercise MCP, A2A, CLI, and persistence.

## Evidence still requiring a live interactive setup

The optional `bun run test:codex-model` uses configured Codex authentication and
real inference. It is an idle-message semantic smoke test, not a replacement for
this operator-driven matrix:

1. Attach ACS and an actual TUI/desktop client to the same live thread; do not
   resume a second copy elsewhere.
2. Deliver while idle, while tools are running, and at a turn boundary. Verify
   the recipient replies to the right task without manual relay.
3. Exercise local approvals and user-input requests. Verify ACS never answers or
   bypasses them and the interactive client remains the human owner.
4. Reconnect each client and drop the delivery connection after write. Verify
   exact-marker reconciliation or explicit uncertainty, never duplicate submission.
5. Observe the UI independently of model input: native function output does not
   promise a particular desktop message-card presentation.

No authenticated model or human-interactive matrix result is claimed by the
credential-free test run. Peer-preemption requests are independently recorded and downgrade
to ordinary delivery unless the current operator-granted sender binding and recipient opt-in
pass their final fences; the shared Codex adapter remains disabled until isolated real-Codex
evidence is obtained.
When that matrix is added, discovery must use only newest-first `thread/turns/list` with
omitted items; `thread/read` may reconcile an already-known exact turn but never select one.
certified by this branch.

## 2026-09-09–10 verification run

`bun run test:codex-real` passed against installed Codex `0.153.4` (two native
tests passed; the authenticated model smoke test was skipped). The response-loss
test used the actual app-server and proved exactly one model request after the
delivery response was suppressed and the adapter reconnected. `bun test
tests/runtime-adapter-conformance.test.ts` passed (16 tests), including simulated
reconnect, post-flush ambiguity, and both local-input states.

Two live Codex TUI runs exercised human-owned local input. While a
`request_user_input` dialog remained open, ACS deferred a peer delivery with reason
`local-input`; resolving the dialog locally allowed delivery without ACS changing
the selection. In a separate `workspace-write`, `on-request`, user-reviewed session,
ACS likewise deferred a peer delivery throughout an open shell-approval dialog.
After the human selected one-time approval, the original command completed and the
peer delivery was accepted and processed. ACS did not answer, approve, deny, or
bypass either prompt.
