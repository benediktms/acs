## 1. Activity contract and persistence

- [x] 1.1 Add the task-independent activity operation to the control and MCP contracts, with refresh/clear validation and no caller-selectable agent, binding, task, or delivery identifier; verify type checking and focused schema tests cover initial publish, retained summary, replacement, clear, and invalid inputs.
- [x] 1.2 Store one versioned activity marker in current binding metadata and expose self-scoped publish, refresh, replace, and clear storage operations; verify targeted storage tests cover summary limits, missing initial summaries, stale callers, expiry, disconnect, dormancy, revocation, resume, and rebind.
- [x] 1.3 Combine eligible task-linked and binding-scoped candidates in `currentActivity` using update time and a stable source tie-breaker; verify targeted storage tests cover source ordering, timestamp ties, task terminal fallback, and protection of newer local activity from older task lifecycle events.
- [x] 1.4 Extend activity markers and authenticated discovery projections with optional absolute `cwd` and attached `gitBranch`, preserving prior workspace values across task lifecycle updates without fresh context; verify focused storage and control tests cover replacement, retention, expiry, and identifier-free projection.

## 2. Control and MCP integration

- [x] 2.1 Implement the authenticated control operation by resolving the logical agent and current binding exclusively from caller attestation; verify targeted control tests reject missing, foreign, and stale ownership and return the updated projection without identifiers.
- [x] 2.2 Expose `acs_activity_update` through the Codex MCP bridge and extend common initialization instructions for substantive local work; verify focused MCP tests assert the tool schema, privacy-safe response, and publish/change/refresh/clear guidance.
- [x] 2.3 Preserve existing task acknowledgement/activity behavior and A2A Agent Card exclusions; verify the affected control, MCP, scheduler, and A2A tests remain green.
- [x] 2.4 Capture `process.cwd()` and the current attached Git branch inside the MCP bridge for local activity refresh, task acknowledgement, and task activity refresh without adding model-controlled inputs; verify focused MCP tests cover attached branches, detached HEAD, non-worktree directories, and workspace-change guidance.
- [x] 2.5 Keep workspace context restricted to authenticated control/MCP discovery and absent from both A2A Agent Card forms; verify focused control, MCP, and A2A privacy assertions.

## 3. Documentation and validation

- [x] 3.1 Update operator documentation to distinguish task-independent local activity from task-linked ACS activity, including the peer-visible summary and 30-minute lifecycle; verify examples match the final MCP contract.
- [x] 3.2 Run `bun test tests/storage.test.ts tests/control.test.ts tests/mcp.test.ts tests/scheduler.test.ts tests/a2a.test.ts`, `bun run typecheck`, and `mise run specs:check`; record outcomes for handoff while leaving the full suite to CI.
- [x] 3.3 Document the peer visibility and refresh behavior of full absolute working directories and Git branches, then rerun the affected tests, type checking, and strict OpenSpec validation for the amended scope.
