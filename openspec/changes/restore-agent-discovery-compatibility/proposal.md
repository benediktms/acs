## Why

ACS currently hides every live Codex agent from peer discovery because released Codex app-servers do not report interactive-subscriber presence, so all bound sessions derive `state: unknown`. The authoritative presence design remains correct, but its rollout prerequisite is not available in Codex 0.154.0 or current upstream main.

## What Changes

- Include enabled `unknown` agents in authenticated peer lists while keeping explicitly `offline` agents hidden.
- Preserve `state: unknown` in the peer projection so callers do not mistake unsupported presence for confirmed availability.
- Keep delivery eligibility fail-closed and keep offline reaping limited to authoritative `offline` observations.
- Add a bridge regression test using `state: unknown` so unsupported presence cannot silently empty peer discovery again.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-discovery`: Keep agents discoverable when the connected runtime cannot report authoritative interactive presence, without treating them as confirmed available.

## Impact

The Codex MCP agent-list filter, agent-discovery requirements, focused MCP tests, and operator documentation change. Runtime state derivation, delivery gates, generated protocol, storage, and reaping semantics remain unchanged.
