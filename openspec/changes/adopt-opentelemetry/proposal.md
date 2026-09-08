## Why

ACS records useful metrics and bounded traces through a custom in-memory implementation, but cannot export them through standard observability tooling. Adopting OpenTelemetry provides interoperable metrics and traces while preserving ACS's local-first defaults and keeping durable security audit records separate.

## What Changes

- Replace direct use of the custom telemetry recorder with OpenTelemetry metrics and tracing APIs behind one application-owned initialization boundary.
- Preserve the existing ACS signal names and control-plane snapshots while adding opt-in OTLP export configured through standard OpenTelemetry environment variables.
- Continue valid W3C trace context across A2A acceptance, scheduling, and runtime delivery.
- Default to no remote exporter and never make messaging availability depend on telemetry collection or export.
- Define bounded shutdown flushing, safe exporter failure behavior, attribute cardinality limits, and redaction rules that exclude message content, credentials, tokens, filesystem paths, and raw runtime payloads.
- Keep durable authorization and preemption audit events in SQLite; OpenTelemetry signals are operational evidence, not an audit authority.

## Capabilities

### New Capabilities

- `observability`: Define ACS metrics and traces, OpenTelemetry configuration and export, context propagation, privacy limits, failure isolation, and lifecycle behavior.

### Modified Capabilities

None.

## Impact

- `packages/observability`, daemon startup/shutdown, A2A ingress, delivery scheduling, runtime adapters, and the control-plane metrics/trace snapshots.
- OpenTelemetry API, SDK, OTLP exporter, and semantic-convention dependencies pinned in `package.json` and `bun.lock`.
- Targeted observability, propagation, configuration, compiled-binary, and exporter-failure tests.
- Operator documentation for opt-in export and data-handling guarantees.
