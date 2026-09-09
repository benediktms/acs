## Context

See `proposal.md` for motivation. Today activity markers live in task metadata, `currentActivity(agentId)` selects among eligible task markers, and the MCP instructions mention activity only in the context of inbox acknowledgement. Runtime bindings already have JSON metadata and provide the ownership fence needed for task-independent activity.

## Goals / Non-Goals

**Goals:**

- Let a bound session publish its own current focus without creating a synthetic A2A task.
- Preserve the existing task activity API and combine both activity sources deterministically.
- Keep publication self-scoped, binding-fenced, expiring, and privacy-limited.
- Expose the publishing Codex session's absolute working directory and attached Git branch to authenticated ACS peers.

**Non-Goals:**

- Inferring activity from prompts, transcripts, filesystem changes, or runtime output inside ACS.
- Adding activity to A2A Agent Cards or changing agent profile revisions.
- Adding hooks, background workspace watchers, background cleanup, multiple simultaneous displayed activities, or a new dependency.

## Decisions

### Add one task-independent self-update operation

Add `executor.activity.update` to the control protocol and expose it as `acs_activity_update`. It accepts `action: "refresh" | "clear"` and an optional `activitySummary`; it does not accept an agent, binding, task, or delivery identifier. A first refresh requires a summary, later refreshes retain the current summary when omitted, and clear rejects a summary.

The bridge supplies its existing caller evidence. The control handler resolves the active binding and logical agent from that attested caller, so the operation cannot target another agent.

Alternatives considered:

- Making `taskId` optional on `acs_task_activity_update` blurs two authorization models and leaves a task-named tool responsible for non-task work.
- Creating synthetic A2A tasks for local prompts pollutes inboxes, task history, and task lifecycle semantics.

### Store local activity on the current binding

Store one versioned activity marker in the existing `runtime_bindings.metadata_json`, containing only summary, update time, and expiry. Binding identity and epoch are inherent in the owning row, so no schema migration or new table is required. Clearing removes only that marker; expiry remains a read-time eligibility check.

Task-linked markers remain in task metadata. This keeps their existing authorization and terminal-state behavior unchanged.

Alternatives considered:

- Storing local activity on the logical agent would allow it to survive a binding change and falsely attribute old work to a replacement session.
- Adding a dedicated activity table adds migration and cleanup machinery for one current binding-owned value.

### Select the newest eligible candidate across both sources

`currentActivity(agentId)` reads the current active binding marker alongside existing eligible task markers, discards expired or incorrectly owned candidates, and selects the newest update. Equal timestamps use a stable source key as a deterministic tie-breaker. A binding-scoped activity projects `state: "working"`; runtime availability continues to communicate whether the session is busy, idle, or awaiting local input.

Because task terminal transitions only make their own candidates ineligible, completing an older task cannot clear a newer binding-scoped activity. Rebinding, revocation, dormancy, or disconnect hides the binding marker through the existing live-ownership checks.

### Use MCP instructions instead of hooks

Extend the common MCP instructions and the new tool description to tell bound agents to publish when substantive local work begins, replace activity when focus changes, refresh before 30 minutes or after changing working directory or branch, and clear when work finishes. Existing direct-delivery instructions and task acknowledgement behavior remain in place for ACS-assigned work.

This is intentionally instruction-driven: ACS stores only an explicit agent publication and never scans or derives a summary from local conversation content. Add a harness hook only if conformance testing shows that MCP instructions are not reliably available to agents handling local work.

### Capture workspace context from attested runtime state

For `acs_activity_update`, `acs_task_acknowledge`, and `acs_task_activity_update`, the control handler uses the installation-routed `thread/read` snapshot already obtained during caller attestation as the authoritative absolute `cwd`, then resolves the attached branch with the local Git executable. It omits `gitBranch` only for a non-worktree directory or a successful detached-HEAD lookup; other Git failures reject the mutation. These values are derived after ownership checks rather than accepted as model or executor inputs.

Persist the captured values on the same binding- or task-scoped activity marker. Explicit publication, acknowledgement, and refresh fail with retryable `RUNTIME_UNAVAILABLE` when a fresh absolute runtime cwd is unavailable; clear remains permitted because it needs no workspace context. A successful refresh replaces both values, while task lifecycle updates without a fresh context retain the marker's existing values. The selected `currentActivity` projects optional `cwd` and `gitBranch` fields through authenticated control and MCP discovery only.

Alternatives considered:

- Resolving Git state during every discovery read adds subprocess work to a potentially paginated query and reports the daemon's context rather than the publishing session's context.
- A background watcher adds lifecycle and resource management for data that already refreshes with activity.
- Accepting workspace fields from model tool input makes accurate capture optional and unnecessarily allows fabricated paths.

## Risks / Trade-offs

- **Agent omits or forgets an update** → Activity expires after 30 minutes; focused MCP tests assert the maintenance instructions are present.
- **An agent publishes sensitive detail** → Keep the 240-character limit and explicitly instruct agents to publish concise, non-sensitive summaries; discovery continues to expose no identifiers or underlying content.
- **Absolute paths reveal local usernames or project names** → Expose them only to authenticated ACS peers, document that visibility explicitly, and keep them out of both Agent Card forms.
- **Workspace context becomes stale after a directory or branch change** → Instruct the agent to refresh activity after the change; the activity and context expire together after 30 minutes.
- **Task and local updates race at the same timestamp** → Use a stable source key tie-breaker and test the ordering.
- **A stale session tries to publish** → Resolve ownership from caller attestation and reject any non-current binding.

## Migration Plan

Deploy the additive control and MCP operation with the binding metadata reader/writer and optional workspace fields. Existing task activity remains valid and requires no data migration. Rollback ignores the unknown binding metadata key and extra activity fields while preserving task activity behavior.
