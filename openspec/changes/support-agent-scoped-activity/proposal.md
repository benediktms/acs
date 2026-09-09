## Why

`currentActivity` can currently be published only for an ACS inbox task, so agents working on locally assigned work such as “implement issue X” remain undiscoverable. Agents need a task-independent way to advertise their current focus while preserving binding ownership, expiry, and privacy boundaries.

## What Changes

- Add a bound-agent activity operation that publishes, refreshes, replaces, or clears the caller's own peer-visible activity without requiring a task or delivery identifier.
- Prompt bound agents through MCP initialization instructions to maintain activity for substantive local work as well as ACS-delivered work.
- Define how explicit agent-scoped publications and task-linked publications select one `currentActivity` without allowing an older task lifecycle event to erase newer activity.
- Include the publishing session's full absolute working directory and, when attached, current Git branch in authenticated activity discovery, resolved automatically from the attested Codex runtime thread.
- Preserve the 30-minute TTL, current-binding fence, restricted projection, and exclusion from A2A Agent Cards.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-discovery`: Extend current activity beyond ACS inbox tasks to explicit activity published by the currently bound agent.

## Impact

- Affects the control protocol, Codex MCP bridge and initialization instructions, activity persistence/projection, task lifecycle integration, tests, and operator documentation.
- Adds an authenticated self-scoped mutation and explicitly exposes local filesystem and Git context to authenticated ACS peers; it does not grant peers authority or expose task, session, runtime, or binding identifiers.
- Requires no A2A Agent Card change and no new dependency.
