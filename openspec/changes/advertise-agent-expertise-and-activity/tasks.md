## 1. Contracts and storage projection

- [ ] 1.1 Extend the control and MCP contracts with optional acknowledgement `activitySummary`, a task-scoped activity update operation, and optional `currentActivity` including `updatedAt` and `expiresAt`; verify type checking accepts publish, replace, refresh, clear, and omitted forms.
- [ ] 1.2 Persist binding-fenced activity markers in existing task metadata and implement acknowledgement plus publish, replace, refresh, and clear mutations, verified by targeted storage tests for assignment authorization, binding epochs, summary limits, and the fixed 30-minute expiry.
- [ ] 1.3 Add one deterministic read-time activity projection, verified by targeted storage tests for unacknowledged tasks, ordering, assigned-agent versus requester updates, expiry, terminal states, disconnect, dormant state, revocation, resume, and rebind.

## 2. Discovery surfaces

- [ ] 2.1 Add `currentActivity` to control-protocol agent list/get projections while preserving structured expertise and existing filters, verified by targeted control-protocol tests.
- [ ] 2.2 Accept the optional summary during MCP task acknowledgement, add `acs_task_activity_update`, and return the shared projection from MCP agent list/get; verify targeted MCP tests cover publish, replace, refresh, clear, validation, and privacy-safe responses.
- [ ] 2.3 Extend the direct-delivery prompt contract with initial-publication, material-change, refresh-before-expiry, and terminal-operation instructions, and verify the focused bridge tests assert those instructions without relying on them for stale-state cleanup.
- [ ] 2.4 Confirm public and authenticated extended A2A Agent Cards remain free of availability and activity fields, verified by targeted A2A protocol tests.

## 3. Documentation and validation

- [ ] 3.1 Document stable A2A expertise versus live authenticated ACS activity discovery, the peer-visible nature of `activitySummary`, the 30-minute refresh lifecycle, and the absence of general-session hook support; verify the rendered Markdown examples against the contracts.
- [ ] 3.2 Run the affected storage, control, MCP, and A2A test files plus strict OpenSpec validation, and record all commands and outcomes in the handoff.
