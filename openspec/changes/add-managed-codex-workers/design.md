## Context

See `proposal.md` for motivation and the five delta specs for normative behavior. At the verified base, a runtime binding already durably records agent, installation, opaque session, epoch, policy, status, timestamps, and observations; it lacks only ownership provenance. The shared state function currently treats `not-loaded` or absent interactive presence as offline for every binding, storage reaps continuously offline agents, and scheduler delivery stops before the Codex adapter can recover an unloaded session.

The existing Codex adapter already speaks to one installation-specific app-server, exposes `thread/start` and `thread/resume` through its client, identifies its subscription as an observer, fences runtime mutations by binding ID and epoch, and observes prompt waits without answering them. `acs codex run --` already launches the pinned native client against an exact managed socket with inherited terminal I/O. Codex 0.154.0 distinguishes `thread/unsubscribe` from `turn/interrupt`; operator evidence shows shutdown-first detach and terminal transport close can leave work running, while Ctrl+C interrupts active work.

The remaining evidence boundaries are lost `thread/start` responses, approval-modal restoration, multiple interactive clients, idle unload/resume timing, and app-server restart. The design fails closed or limits claims where those behaviors are not yet proven.

## Goals / Non-Goals

**Goals:**

- Make the existing binding the complete durable receipt for an ACS-created worker with one additional checked control class.
- Reuse the current control socket, adapter, managed app-server, native TUI launch, observation, audit, and delivery-fence paths.
- Keep attached-session behavior unchanged while making managed ownership independent of transient interactive subscription.
- Make every external runtime mutation installation-scoped, fence-checked, and explicit about ambiguous acceptance.
- Leave one focused automated check for each policy boundary and separate native/operator evidence from emulator claims.

**Non-Goals:**

- No lifecycle-operation table, worker registry, detached-state record, ownership transfer, replacement, stop/delete/cleanup, or orphan reconciliation.
- No PTY or app-server proxy, custom terminal UI/client, keystroke automation, or upstream/generated-protocol change.
- No agent creation, prompt packet, initial model turn, workspace/worktree provider, swarm membership, profiles, quotas, usage, waits, or general workflow engine.
- No broader priority, preemption, cancellation, A2A, or unknown-presence redesign.
- No prompt-response API or policy/sandbox override.

## Decisions

### 1. Add one immutable binding control class

Migration `007` adds `runtime_bindings.control_class TEXT NOT NULL DEFAULT 'attached' CHECK (control_class IN ('attached','managed'))`. The default upgrades all existing rows safely and keeps every existing bind, claim, and self-registration call site attached. The internal managed-create path is the only caller allowed to request `managed`; binding DTOs and handles expose the class for control and scheduling decisions.

The successful binding row is the ownership receipt. Its existing binding ID, agent ID, installation ID, opaque session ID, epoch, and creation timestamp plus the new class are sufficient. There is no durable attached/detached flag because app-server subscriptions are transient and native-client exit is not an ownership transition.

Alternatives considered: a worker registry duplicates binding identity and fencing; a lifecycle-operation table has no sound native reconciliation key yet; deriving ownership from thread source, socket, process, or presence would claim user-created sessions.

### 2. Add the smallest neutral creation surface

Extend the runtime descriptor with a managed-session creation capability and the adapter with one optional `createManagedSession` operation. Its request carries installation-scoped creation data, including validated absolute `cwd`; its result distinguishes confirmed creation, definite rejection/deferral, and `creation-unknown`. Direct-delivery targets separately gain `controlClass` so application code need not branch on Codex.

The Codex implementation calls persistent `thread/start` with `cwd` and `ephemeral: false`, omitting approval and sandbox fields so account configuration remains authoritative. The app-server client decodes and returns a valid thread ID and uses the same write-flush marker pattern already used for ambiguous delivery/interruption. A pre-write failure is definite; timeout or disconnect after the request is flushed is ambiguous.

Alternatives considered: a Codex-specific control method leaks harness semantics into application code; a generalized lifecycle API adds unused stop/delete/transfer operations; editing generated protocol is unnecessary because the pinned request/response DTOs already exist.

### 3. Create through one local-user-only control transaction boundary

Add `runtimes.sessions.createManaged` to the authenticated local control protocol. It accepts the logical agent, optional configured account label, and absolute working directory. The handler requires `local-user`, then validates the agent exists, is enabled, has no active binding, the directory is absolute and exists, and exactly one enabled compatible installation/adapter is selected before calling the runtime.

After confirmed thread creation, the handler binds the returned opaque ID with `controlClass: managed`, observes the thread, emits the existing durable audit event shape with receipt evidence, and returns the managed binding. Creation starts neither a task nor a turn and does not attach a client.

The runtime mutation and SQLite commit cannot be atomic. A flushed request without a response, or a confirmed thread followed by bind failure, returns `RUNTIME_AMBIGUOUS`, creates no ownership receipt, audits the strongest known installation/thread evidence, and instructs the operator not to retry blindly. It never deletes, retries, or adopts the possible orphan.

Alternatives considered: automatic retry can create duplicate workers; compensating deletion could destroy a thread after an uncertain response; a durable operation record adds storage without enabling reliable lookup.

### 4. Resolve native attachment by logical agent

`acs codex workers attach <agent>` uses existing authenticated control reads to resolve the agent's one current active binding and then load its diagnostic binding record. It accepts only `controlClass: managed`; missing agents, attached bindings, inactive/revoked receipts, or multiple current candidates fail closed. Binding ID remains output and audit evidence, not user-facing addressing.

Before spawn, the CLI matches the binding installation to the daemon's recorded runtime and the current configured account, requires the canonical account home and derived socket to agree and the socket to be listening, then launches:

`codex --dangerously-bypass-hook-trust --remote unix://<recorded-socket> resume <opaque-thread-id>`

The child receives the recorded `CODEX_HOME` and inherited stdin/stdout/stderr. ACS prints that Ctrl+D with an empty composer, `/exit`, and `/quit` detach, while Ctrl+C interrupts active work. It sends no initial prompt or policy flags, and child exit causes no durable or runtime mutation.

Alternatives considered: accepting binding IDs exposes an implementation receipt as primary UX; a terminal proxy duplicates native behavior; treating process exit as detach state confuses subscription with ownership.

### 5. Make state derivation control-class aware once

Add `controlClass` to the shared observation input and update every caller to pass the stored value. Attached precedence remains unchanged. For managed bindings, explicit runtime `offline` is offline, `not-loaded` is unknown until recovered, interactive presence is informational, and blocking/error/active/idle state determines `auth-required`, `input-required`, `error`, `working`, or `ready`.

Storage uses the same derivation for observation, discovery, activity eligibility, scheduler wake-up, and retention. Interactive detachment does not clear a managed binding or its unexpired activity. Offline tracking and automatic reaping remain effective for attached bindings but never revoke a managed ownership receipt; explicit retirement is deferred.

Alternatives considered: guards at individual scheduler/control/storage call sites would drift; treating managed detach as offline defeats background operation; treating unloaded as ready claims deliverability before resume is proven.

### 6. Recover unloaded managed threads only inside delivery

Add the binding class to the neutral delivery target. The scheduler permits a pending managed delivery to reach its owning adapter when the thread is absent or unloaded instead of filtering it as ordinary attached-offline state. The adapter first verifies installation identity. If inspection reports not loaded and the target is managed, it checks the current binding ID/epoch fence, calls `thread/resume` once on that same installation, re-inspects, and only then applies the existing version, blocking, direct-input, and final mutation fences before `turn/start`.

Attached targets never gain resume behavior. Stale/revoked fences, foreign adapters, definitive missing-thread responses, incompatible runtimes, approval/user input, unsafe direct-input state, or system errors produce no delivery mutation beyond the one explicitly allowed managed resume. Daemon or app-server reconnect refreshes observations but does not wake every worker proactively.

Alternatives considered: proactive resume increases load and mutates idle workers without demand; cross-installation recovery breaks ownership identity; weakening existing offline gates for every binding would silently change user-created sessions.

### 7. Preserve native prompt and interrupt ownership

No response wrapper is added to the app-server client. Existing server-request observation continues to project approval/authentication/user-input blocks. ACS never answers, denies, bypasses, or fabricates user input. An operator may attach to the recorded managed worker and respond through native Codex; delivery proceeds only after a fresh observation clears the block.

Likewise, attach/detach code never calls `turn/interrupt` or `thread/unsubscribe`. The native TUI owns its subscription and shutdown gesture. Existing peer-preemption remains the only narrowly authorized user-turn interrupt path and is not broadened here.

Alternatives considered: an ACS prompt API would transfer local authority; synthetic input would misrepresent provenance; ACS-driven unsubscribe would make client-subscription ownership ambiguous.

### 8. Prove each layer at its actual boundary

Contract, domain, storage, control, scheduler, adapter-conformance, app-server-client, and packaging tests cover the new class, migration, validation, ambiguity classification, exact routing, resume selection, prompt non-response, child arguments, and no-op exit. Existing fake adapters and app-server fixtures are extended; no second harness is introduced.

An opt-in isolated Codex 0.154.0 suite uses a temporary real `CODEX_HOME`, temporary Unix socket, and local mock model without credentials or live LaunchAgents. It proves persistent creation without policy overrides, completion after creator disconnect, same-installation unload/resume, reconnect, fencing, and single authenticated completion.

Operator certification alone records Ctrl+D, `/exit`, `/quit`, Ctrl+C, terminal-close, approval restoration, and multiple-client behavior, including version, topology, installation, observed RPCs, terminal status, and completion count. Documentation claims only the tested boundary.

## Risks / Trade-offs

- [Lost or ambiguous `thread/start` response can leave an unowned runtime thread] → Return `RUNTIME_AMBIGUOUS`, persist audit evidence, forbid blind retry/adoption/deletion, and defer a reconciliation record until native lookup evidence exists.
- [Approval modal may not restore or may route to another client] → Keep the worker visibly blocked, never answer on its behalf, and advertise support only after operator certification.
- [Configuration or socket identity drifts after creation] → Match the binding's installation, canonical home, and exact derived socket before resume or attach; fail closed without fallback.
- [Managed receipts can outlive dead runtimes because automatic reaping is disabled] → Prefer retaining ownership evidence; add explicit stop/retire and resource policy only in a later proven slice.
- [Released Codex may report interactive presence as unknown] → Preserve attached behavior and make only explicit managed ownership presence-independent.
- [App-server restart or multiple clients behave differently from one disconnect] → Keep claims topology-specific and record them as evidence boundaries until native/operator tests pass.
- [External thread creation and local binding commit are not atomic] → Keep the post-create window explicit and audited; do not pretend SQLite can roll back the native mutation.

## Migration Plan

1. Apply additive migration `007`; its default classifies all existing bindings as attached and its check rejects any third state. Record the migration once through the existing migration runner.
2. Deploy the contract/storage/state changes before exposing the control and CLI paths so legacy creation paths continue to write attached bindings.
3. Enable managed creation and attach only when the configured Codex adapter reports the new capability and supported version.
4. Run strict OpenSpec validation, focused automated suites, the isolated pinned-native suite, build, and repository check. Record operator certification separately before documenting native TUI behavior as supported.

Rollback removes the new binary behavior but cannot safely drop the SQLite column with a simple reverse migration. Because the change is preview and additive, rollback uses the prior binary only if it tolerates the added column; managed rows remain durable evidence and MUST NOT be rewritten as user-attached ownership. If that compatibility is not verified, restore the pre-change database backup rather than mutating ownership history.

## Open Questions

No question changes the selected implementation route. Lost-create reconciliation, approval restoration, multiple-client prompt routing, idle unload timing, and app-server restart remain explicit evidence boundaries whose observed results constrain support claims; they do not expand this slice.
