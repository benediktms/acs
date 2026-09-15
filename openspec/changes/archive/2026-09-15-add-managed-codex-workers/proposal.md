## Why

ACS can communicate with independently launched Codex sessions, but it cannot yet create and durably retain ownership of a background worker that an operator can leave and later revisit. This first agent-mesh primitive adds that lifecycle without treating user-created sessions or local prompts as ACS-owned.

## What Changes

- Distinguish existing operator-attached bindings from ACS-created managed bindings with one immutable-per-binding control class; all existing, claimed, self-registered, and manually bound sessions remain attached.
- Add a local-user-only operation and `acs codex workers create <agent>` command that creates one persistent Codex thread for an existing unbound agent on a configured managed installation, then records the successful managed binding as the ownership receipt.
- After a successful create, atomically record the managed binding and one asynchronous readiness task using the exact instruction `Initialize for readiness: call acs_identity and follow the existing registration guidance if needed, then call acs_agents_list once to inspect the agents currently visible to you. Do not contact them or persist a peer snapshot. Complete this task normally.`; return submitted binding and task/delivery receipts without claiming readiness.
- Add `acs codex workers attach <agent>` to resolve that agent's one current active managed binding, verify its recorded account home and socket, and launch the native Codex TUI against the exact thread. Missing, attached, revoked, or ambiguous bindings fail before launch.
- Keep attach and detach native: Ctrl+D with an empty composer, `/exit`, or `/quit` detach; Ctrl+C interrupts active work. Child exit does not revoke ownership or create durable attachment state.
- Allow managed workers to remain observable and deliverable without an interactive subscriber, including one fenced same-installation resume of an unloaded thread at delivery time. Attached-session absence behavior remains unchanged.
- Preserve local prompt authority: ACS exposes approval, authentication, and user-input waits, but never answers, denies, bypasses, or synthesizes input for them.
- Fail closed when thread creation, ownership commit, installation identity, or prompt restoration is ambiguous, and distinguish contract/emulator, pinned-native, and operator-certified evidence.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-discovery`: Derive state and retention from managed ownership without treating interactive absence or unload as loss of ownership.
- `codex-registration`: Define attached versus ACS-created managed binding provenance and prohibit implicit ownership transfer.
- `runtime-delivery`: Permit only fenced managed bindings to resume and receive background delivery on their recorded installation while preserving local prompt authority.
- `local-service`: Add side-effect-safe managed-worker create and native attach CLI behavior addressed by logical agent.
- `codex-app-server-management`: Require worker creation, resume, and attachment to use the binding's recorded configured installation and exact derived socket.
- `a2a-messaging`: Preserve public rejection of `local-user` principals while permitting only the narrowly binding-scoped managed-readiness bootstrap authorized by local control.

## Impact

- Adds one checked binding column and migration, neutral runtime create/control-class contract fields, a local control method with one atomically submitted asynchronous readiness task, Codex adapter create/resume behavior, and two CLI commands.
- Updates shared state derivation, storage observation/reaping, scheduler delivery eligibility, control DTOs/audit, and focused documentation and tests.
- Reuses the pinned Codex 0.154.0 app-server protocol, existing runtime binding, managed account/socket routing, native child-process launch, delivery fences, and test harnesses. No dependency, generated-protocol, A2A wire-contract, service, or account-configuration change is introduced. The readiness bootstrap is limited to local identity/registration guidance and one visible-agent inspection; it does not create peer snapshots, contact or delegate to peers, alter membership or grants, wait synchronously, or grant general local-user authority.
