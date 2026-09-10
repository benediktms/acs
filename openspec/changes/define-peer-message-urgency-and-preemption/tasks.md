## 1. Public contract and policy

- [ ] 1.1 Preserve `low`, `normal`, and `high` priority and add optional `preempt` to the A2A, MCP, storage, and runtime-neutral delivery contracts with a default of `false`; verify removed or unknown values fail validation.
- [ ] 1.2 Extend the existing delivery-status projection so senders can distinguish preemption requested, attempted, pending confirmation, achieved, unnecessary, downgraded with a reason, or unresolved from the independent delivery state.
- [ ] 1.3 Require ordinary send authority before durable acceptance, then gate interruption separately on explicit sender preemption authority and recipient binding opt-in; verify either missing preemption gate noisily downgrades without blocking ordinary delivery.

## 2. Scheduling and runtime interruption

- [ ] 2.1 Add bounded anti-starvation to the existing priority scheduler; verify sustained high-priority traffic eventually permits eligible normal and low deliveries and never causes interruption by itself.
- [ ] 2.2 Add a harness-neutral interruption capability and operation over opaque execution references; keep harness-specific turn or process identifiers inside adapters.
- [ ] 2.3 Map eligible Codex preemption to exact `turn/interrupt`; treat RPC success as request acceptance and require `turn/completed(interrupted)` or equivalent authoritative evidence before reporting confirmed interruption.
- [ ] 2.4 Classify generic Codex interruption RPC failures as unsupported, not running, definitively rejected, or unresolved; combine these with ACS authorization and recipient-policy decisions, retain safe diagnostics for audit, and noisily downgrade definitive failures.
- [ ] 2.5 Handle ambiguous interruption acceptance by reconciling from turn notifications and `thread/read` without blind mutation retries, retaining the pending message, and attempting direct delivery as soon as runtime state is safe within the existing message deadline.
- [ ] 2.6 Keep fallback on the existing `turn/start` named-tool-output path, including when Codex queues it behind active work; do not use `turn/steer` for peer content.
- [ ] 2.7 Add isolated real-Codex coverage for active turn -> interrupt acceptance -> confirmed interrupted completion -> fallback delivery, idle or stale turn -> classified rejection -> fallback delivery, and post-write interrupt response loss -> reconciliation -> exactly-once fallback delivery before advertising interruption support.

## 3. Evidence and validation

- [ ] 3.1 Add audit and telemetry for preemption request, authorization and recipient-policy decisions, interruption outcome, downgrade, ambiguity, and subsequent delivery outcome without duplicating existing acceptance, acknowledgement, or reply milestones.
- [ ] 3.2 Run strict OpenSpec validation, targeted A2A, MCP, storage, scheduler, adapter, and conformance tests, plus type checking, linting, formatting checks, boundary checks, and build; leave the full suite to CI.
