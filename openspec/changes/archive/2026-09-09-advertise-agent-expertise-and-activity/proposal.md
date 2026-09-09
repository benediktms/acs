## Why

ACS agents can discover peers and their coarse availability, but cannot reliably tell which peer has relevant expertise or what an available peer is currently handling. Discovery needs a safe ACS-native activity projection without turning the cacheable A2A Agent Card into a live-presence document.

## What Changes

- Return each agent's existing description and configured skills consistently through ACS agent list/get discovery.
- Add a current-activity projection derived from acknowledged assigned tasks and existing availability state.
- Let the assigned agent publish or replace a concise peer-visible summary and refresh or clear its task activity, and prompt it to maintain that activity during direct delivery.
- Expose only task state, the explicitly designated summary when present, update time, and expiry time; never expose prompts, conversation contents, credentials, artifacts, or runtime identifiers.
- Stop advertising activity after 30 minutes without an assigned-agent update, when its task becomes terminal, or when its publishing binding loses current ownership.
- Keep A2A Agent Cards limited to stable identity and expertise. Live activity remains an authenticated ACS control/MCP concern.
- Do not add standalone presence storage, a free-standing focus publication API, or an A2A extension in this change.

## Capabilities

### New Capabilities

- `agent-discovery`: Defines ACS-native agent expertise, live activity projection, visibility, freshness, and stale-state behavior.

### Modified Capabilities

None.

## Impact

- Control-protocol and MCP contracts gain the activity projection and task-scoped activity update inputs.
- Existing task metadata records the binding-fenced activity marker; no new table or cleanup job is introduced.
- Direct-delivery prompts explain when the assigned agent publishes, updates, and refreshes activity.
- Agent discovery tests cover expertise, publication, replacement, expiry, active-task selection, privacy, and clearing after terminal, rebind, or offline transitions.
- Operator documentation explains the stable A2A profile versus live ACS discovery boundary.
