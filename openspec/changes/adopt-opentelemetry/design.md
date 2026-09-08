## Context

See `proposal.md` for motivation. ACS currently centralizes ten metric names and eight span names in `packages/observability`, stores metric aggregates and the latest 256 spans in memory, exposes snapshots through the control plane, and manually validates W3C trace context at A2A ingress. No OpenTelemetry dependency or remote exporter exists.

The service is a Bun standalone executable and must remain useful without a collector. Telemetry cannot become part of task, delivery, authorization, or audit correctness.

## Goals / Non-Goals

**Goals:**

- Export existing explicit ACS instrumentation through standard OpenTelemetry metrics and traces.
- Preserve current signal names and local control-plane snapshots during adoption.
- Keep attributes bounded and content-free.
- Prove the selected packages work in the compiled Bun executable.

**Non-Goals:**

- Bundling or operating an OpenTelemetry Collector.
- Adding automatic runtime, HTTP, filesystem, or SQLite instrumentation.
- Replacing durable SQLite audit events with spans or logs.
- Defining urgency- or preemption-specific signal names in this change.

## Decisions

### Keep one application-owned observability boundary

Callers continue using the small typed API in `packages/observability`. Its implementation records the same operation once for local snapshots and OpenTelemetry providers, avoiding a repository-wide instrumentation rewrite and keeping exporter details out of domain and application code.

Direct OpenTelemetry calls outside this package are rejected because they would spread provider lifecycle, attribute policy, and test setup across the repository.

### Use explicit instrumentation without auto-instrumentation

Use the minimum official OpenTelemetry API, metrics SDK, trace SDK, OTLP exporters, and semantic-convention packages that pass Bun source and compiled-binary tests. Do not add the Node SDK bundle or automatic instrumentation unless a later measured need justifies them.

Explicit spans preserve the existing ACS operation boundaries and make the data policy reviewable. Resource attributes include the service name, ACS version, runtime name, and a non-secret instance identifier; they exclude account paths and credentials.

### Make remote export opt-in

Without standard OTLP environment configuration, ACS installs no network exporter and retains only its current bounded local views. With valid configuration, it starts periodic metric export and batched span export. Unsupported or invalid configuration fails locally with a clear diagnostic rather than changing message behavior.

No ACS-specific exporter configuration is added unless standard OpenTelemetry variables cannot express a required setting.

### Preserve W3C context through the existing durable path

Retain the current strict `traceparent` and `tracestate` validation at A2A ingress. The accepted context remains attached to the delivery intent and becomes the remote parent for acceptance and delivery spans after asynchronous scheduling. Invalid context is dropped before persistence.

### Treat telemetry as lossy and audit as durable

Instrumentation methods do not throw into business operations. Export failures produce rate-limited local diagnostics. Shutdown uses the daemon's existing deadline to bound provider flush and shutdown.

SQLite audit events remain the only authoritative security trail. Telemetry may describe an audit-relevant outcome but never substitutes for committing the corresponding audit record.

### Preserve names before considering semantic-convention migration

Keep the existing ACS metric and span names so adoption does not combine backend replacement with dashboard and operator-contract churn. Standard resource and transport attributes use applicable OpenTelemetry semantic conventions. A later change may rename ACS signals if real consumers justify the migration.

## Risks / Trade-offs

- **OpenTelemetry packages may not compile cleanly under Bun standalone builds** -> pin the smallest package set and make compiled-binary verification the first implementation gate.
- **Dual local and exported recording adds small overhead** -> retain the existing bounded local views and benchmark only if delivery latency regresses.
- **Exporter outages can create noisy diagnostics** -> rate-limit local warnings and keep export queues bounded.
- **High-cardinality identifiers can increase backend cost** -> forbid identifiers on metrics and allow only opaque correlation IDs on spans.
- **Standard environment variables may enable unintended export** -> document the opt-in variables and emit a startup diagnostic naming the active exporter without printing endpoints containing credentials.

## Migration Plan

1. Add and pin the minimum OpenTelemetry packages, proving source tests and the standalone binary before changing instrumentation.
2. Replace the observability package internals while preserving its typed call sites and control snapshots.
3. Add opt-in OTLP providers, context propagation, failure isolation, and bounded shutdown.
4. Document configuration and validate with in-memory exporters plus a local test receiver.

Rollback removes the provider initialization and dependencies; existing local snapshot behavior remains the compatibility baseline throughout.
