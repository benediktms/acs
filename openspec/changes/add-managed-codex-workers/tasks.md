## 1. Durable Ownership and State

- [ ] 1.1 Add `storage/007_runtime_binding_control_class.sql` with the checked `attached|managed` column and register it idempotently in the SQLite migration list; verify `tests/storage.test.ts` proves legacy rows become attached, invalid values fail, and reopening records the migration once.
- [ ] 1.2 Extend binding rows, options, handles, and control DTO projections with `controlClass`, keeping bind, claim, and self-registration attached by default and permitting managed only from the internal managed-create path; verify focused storage and control tests prove provenance and epoch immutability.
- [ ] 1.3 Make the shared agent-state derivation accept the binding control class and update storage, control, scheduler, discovery/activity, and observation callers; verify `tests/domain.test.ts` and `tests/storage.test.ts` cover unchanged attached behavior, managed absent idle/active and prompt states, managed unloaded unknown, and managed receipt retention without automatic reaping.

## 2. Runtime Contract and Codex Adapter

- [ ] 2.1 Add the minimal neutral managed-session creation capability, request/result union, optional adapter method, and delivery-target control class in `contracts/runtime-adapter.ts`; update the existing fake adapter only as required and verify `tests/runtime-adapter-conformance.test.ts` covers capability reporting without adding lifecycle stop/delete/transfer APIs.
- [ ] 2.2 Update `CodexAppServerClient.startThread` to return a validated thread ID and accept the existing request-flush signal, keeping the signature private unless the app-server boundary contract must expose it; verify `tests/app-server-client.test.ts` distinguishes definite pre-write failure from flushed/no-response ambiguity.
- [ ] 2.3 Implement `CodexRuntimeAdapter.createManagedSession` with persistent `thread/start`, validated `cwd`, and no approval/sandbox fields; verify adapter conformance tests cover confirmed creation, rejection/deferral, `creation-unknown`, route/version checks, and absence of an initial turn.
- [ ] 2.4 Update Codex delivery so only a current fenced managed target may resume one unloaded thread on the adapter's own recorded installation, followed by fresh inspection and existing delivery gates; verify focused adapter/scheduler tests cover loaded absent delivery, attached deferral, one managed resume, stale fence, foreign route, missing thread, unsafe direct input, and no proactive wake-up.
- [ ] 2.5 Preserve server-request observation as read-only and add no prompt-response, unsubscribe, or attach-driven interrupt wrapper; verify tests expose managed approval/user-input blocks and observe no response or `turn/interrupt` mutation from create, attach, or detach paths.

## 3. Local Control Creation

- [ ] 3.1 Add `runtimes.sessions.createManaged` and `controlClass` to the local control contract and protocol mappings; verify type checking and `tests/control.test.ts` cover the request/response DTO and stable error mapping including `RUNTIME_AMBIGUOUS`.
- [ ] 3.2 Implement local-user authorization and preflight validation for agent existence/enabled/unbound state, configured account selection, adapter capability/version, and absolute existing `cwd` before runtime I/O; verify control tests prove every invalid or non-local request performs no thread creation or binding mutation.
- [ ] 3.3 On confirmed creation, commit the managed binding receipt, observe it, and emit durable success audit evidence; on lost response or post-create bind failure, emit the strongest known ambiguity evidence and never retry/delete/adopt; verify `tests/control.test.ts` covers success, pre-write failure, flushed response loss, bind failure, and zero false-success receipts.

## 4. Scheduling and Background Delivery

- [ ] 4.1 Pass stored control class through scheduler target assembly, eligibility, observation wake-up, and fence checks so managed absent/not-loaded work can reach its owning adapter while attached absence remains deferred; verify `tests/scheduler.test.ts` covers both classes, blocked prompts, stale/revoked ownership, and completion deduplication.
- [ ] 4.2 Ensure runtime/app-server disconnect marks current observations without allowing offline reaping to erase managed receipts, and reconnect refreshes before delivery without waking all workers; verify focused storage and scheduler reconnect tests preserve one binding epoch and one accepted delivery/completion.

## 5. Operator CLI

- [ ] 5.1 Add `acs codex workers create <agent> [--account <label>] [--cwd <absolute-dir>]`, defaulting `cwd` to the CLI working directory and calling the local control method without attaching or starting work; verify `tests/packaging.test.ts` covers argument parsing, account/cwd forwarding, success output, ambiguity guidance, and no side effects for invalid input.
- [ ] 5.2 Add `acs codex workers attach <agent>` using existing control reads to resolve exactly one current active managed binding, then verify its recorded installation, canonical account home, exact derived listening socket, and opaque thread before spawn; verify packaging tests reject missing, attached, revoked, ambiguous, drifted, and unavailable targets.
- [ ] 5.3 Reuse the native child launch pattern with recorded `CODEX_HOME`, `--dangerously-bypass-hook-trust`, exact `--remote unix://...`, `resume <thread-id>`, and inherited terminal I/O; print detach-versus-interrupt guidance and make child exit a no-op, with packaging tests asserting exact arguments, environment, I/O, and absence of prompt/policy/ownership mutations.
- [ ] 5.4 Extend root/group/leaf help for `codex workers`, `create`, and `attach` through the existing Commander tree; verify packaging tests show help and syntax errors complete before configuration, storage, socket, runtime, or service mutation.

## 6. Pinned Native Evidence

- [ ] 6.1 Extend `tests/real-codex.test.ts` using a temporary real `CODEX_HOME`, temporary Unix socket, local mock model, and no credentials or live LaunchAgent to prove Codex 0.154.0 persistent creation returns the receipt thread without policy overrides and an active turn completes after the creator transport closes with one authenticated completion; verify with `ACS_REAL_CODEX=1 mise exec -- bun test tests/real-codex.test.ts`.
- [ ] 6.2 In the same isolated native suite, prove an idle unloaded managed thread resumes only on its recorded installation, an attached control does not resume, and adapter reconnect neither changes the receipt nor duplicates delivery/completion; verify the opt-in native command passes and leaves no real user service/session changes.

## 7. Documentation and Operator Certification

- [ ] 7.1 Add `docs/codex-managed-workers.md` documenting create/attach commands, agent-based resolution with diagnostic binding IDs, prompt ownership, clean detach versus Ctrl+C interruption, installation fencing, retained managed receipts, unsupported lost-create reconciliation, current unknown-presence behavior, and restart/multi-client evidence boundaries; verify every support claim maps to a contract, emulator, pinned-native, or operator evidence row.
- [ ] 7.2 Run the isolated operator matrix for Ctrl+D, `/exit`, `/quit`, Ctrl+C, terminal close, approval/user-input reattachment, two native clients plus the ACS observer, and restart/reconnect without using an existing ACS service or user session; record Codex version, topology, installation, exact action, observed RPCs, terminal status, and completion count, and mark any unproven prompt or multi-client behavior fail-closed rather than supported.

## 8. Focused Validation and Handoff

- [ ] 8.1 Run `mise run specs:check` and the focused suite `mise exec -- bun test tests/domain.test.ts tests/storage.test.ts tests/app-server-client.test.ts tests/runtime-adapter-conformance.test.ts tests/control.test.ts tests/scheduler.test.ts tests/packaging.test.ts`; verify all changed behavioral contracts pass without touching generated protocol, A2A contracts, dependencies, account configuration, or LaunchAgents.
- [ ] 8.2 Run `mise exec -- bun run build` plus the repository type, lint, format, boundary, enum, and generated-code checks; verify the standalone binary builds, and leave the full all-tests repository check to CI in accordance with the local focused-test policy.
