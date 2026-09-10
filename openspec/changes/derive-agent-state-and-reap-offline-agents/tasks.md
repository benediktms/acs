## 1. Runtime Observation Contract

- [ ] 1.1 Land or select a Codex app-server revision that declares connection roles and reports per-thread interactive-subscriber presence on reads and change notifications; verify its protocol and lifecycle tests distinguish an observer-only thread from one with an interactive subscriber
- [ ] 1.2 Regenerate the pinned Codex protocol artifacts from that revision instead of editing generated files, and verify the generated-code check passes
- [ ] 1.3 Replace coarse runtime availability in the harness-neutral contract with normalized runtime state, blocking reason, interactive presence, and observation time; add one pure domain state derivation and verify focused contract/domain tests cover every mapping and precedence case

## 2. Persistence And Reaping

- [ ] 2.1 Add a SQLite migration and storage ports for normalized binding observations plus agent `offline_since_ms`, migrating existing observations to unknown; verify focused storage migration and round-trip tests pass
- [ ] 2.2 Persist fresh observations and maintain one continuous offline interval, clearing it for every non-offline state and never advancing it for unknown or error; verify focused scheduler/storage tests cover disconnect, reconnect, and unsupported presence
- [ ] 2.3 Reuse the logical deletion transaction for reaping, atomically fail nonterminal target tasks with `target-reaped`, append terminal events, remove pending delivery intents, and revoke bindings/principals; verify focused storage and A2A tests cover queued work, history preservation, rejection by old identity, and safe slug reuse
- [ ] 2.4 Add the configured offline retention with a 24-hour default and run the bounded reap pass at startup and on the existing scheduler cadence; verify focused fake-clock scheduler tests cover retention, reset, disabled reaping, and no reaping of unknown or error states

## 3. Adapter And Discovery Surfaces

- [ ] 3.1 Initialize the ACS Codex connection as an observer and translate app-server status, blocking flags, and interactive presence only inside the Codex adapter; verify focused adapter tests cover observer-only, interactive join/leave, reconnect refresh, and unsupported capability
- [ ] 3.2 Replace delivery eligibility checks with the shared derived agent state while preserving current deferral and binding-fence behavior; verify focused scheduler tests cover ready, working, blocked, offline, unknown, and error targets
- [ ] 3.3 Keep raw observations and binding diagnostics in the administrative control projection, but reduce MCP list/get to identity, expertise, derived state, and summary-only activity; remove MCP availability/status filtering and verify focused control/MCP tests cover default list omission, exact offline lookup, field privacy, and activity-state removal
- [ ] 3.4 Document the state meanings, observer-presence prerequisite, offline retention setting, rollout order, and `target-reaped` outcome; verify documentation examples use the new `state` field and contain no legacy peer `availability`

## 4. Conformance

- [ ] 4.1 Run strict OpenSpec validation, affected test files, type checking, boundary checks, and generated-code checks; record any real-Codex check separately and do not claim subscriber-presence compatibility without that evidence
