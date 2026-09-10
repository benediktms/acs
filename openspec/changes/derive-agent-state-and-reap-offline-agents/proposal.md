## Why

ACS currently exposes cached runtime availability as if it described whether an agent can participate, so a closed Codex session can remain discoverable as `idle` with an active binding. Over time those durable logical agents also accumulate indefinitely because runtime disconnection never retires them.

## What Changes

- Add a harness-neutral agent state machine driven by fresh runtime state, blocking reason, and authoritative interactive-subscriber presence reported by the runtime adapter.
- Extend the Codex integration to consume explicit interactive-subscriber presence from app-server instead of inferring presence from loaded state, process state, prompts, or transcripts.
- Keep explicit activity summaries separate from derived agent state and remove manually assigned state from the peer-facing activity projection.
- Omit offline and unknown agents from the default peer list while preserving exact lookup and durable routing during a grace period, then logically reap agents that remain continuously offline for a configurable retention period, defaulting to 24 hours.
- Resolve accepted queued work explicitly when its target is reaped rather than silently discarding it.
- **BREAKING** Replace the peer-facing `availability` projection and available/unavailable filter with the derived agent `state`, and remove binding/runtime implementation details from MCP discovery.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-discovery`: Derive peer-visible agent state from authoritative harness observations, limit discovery to useful live agents, preserve explicit activity separately, and reap continuously offline agents after retention.
- `runtime-delivery`: Require adapters to report normalized runtime state, blocking reason, and interactive presence without harness-specific inference in application code.
- `a2a-messaging`: Give pending accepted work an explicit terminal outcome when its target agent is permanently reaped.

## Impact

- Affects the runtime adapter contract, Codex app-server protocol integration and generated bindings, scheduler lifecycle handling, SQLite persistence/migration, control protocol, MCP discovery bridge, configuration, and targeted tests.
- Requires a Codex app-server capability that distinguishes interactive subscribers from observer/service subscribers and reports changes per thread.
- Existing MCP consumers of `availability`, its filter, or binding details must migrate to `state`; administrative control surfaces retain raw observations and binding diagnostics.
