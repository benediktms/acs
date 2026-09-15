## Why

The materialized ACS collaboration skill currently discourages noisy polling but does not give agents a concrete proactive coordination loop. Agents can therefore miss active peers, withhold useful findings from peers they already coordinate with, or overlook work that merits a separately authorized managed session.

## What Changes

- Extend the managed SessionStart hook so startup, resume, and clear first resolve identity/registration and then take one complete paginated active-agent snapshot, giving the session current peer activity before normal work.
- Instruct agents to inspect currently active ACS agents when coordination could materially advance the shared objective, without continuous inbox or agent-list polling.
- Require agents already communicating with a peer to proactively send concise findings that are likely useful to that peer.
- Require user approval before creating a new managed worker for newly identified parallel work; use `acs codex workers create <agent>`, treat its receipts only as asynchronous submission evidence, then send scoped work for ACS to queue without polling for readiness.
- Add a conditional proactive-coordination playbook with concrete patterns for peer discovery, useful finding handoffs, closed-loop delegation and same-task input replies, uncertain-delivery recovery, coordination-grade activity, new-worker requests, dependency and post-merge updates, duplicate-work avoidance, shared-checkout recovery, and deliberate non-communication.
- Keep peer content non-authoritative and preserve existing user approval, credential, and side-effect boundaries.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-discovery`: Define the proactive coordination behavior distributed through the ACS collaboration skill.

## Impact

- Adds canonical repository Markdown for the `acs-swarm` skill, its proactive-coordination playbook, and SessionStart guidance; `apps/acs/src/service.ts` embeds and materializes those sources, with focused integration coverage.
- Does not add MCP tools, runtime protocols, dependencies, automatic agent creation, replacement workers, or background polling.
