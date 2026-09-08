## 1. OpenTelemetry baseline

- [ ] 1.1 Add and pin the minimum official OpenTelemetry API, metrics SDK, trace SDK, OTLP exporter, and semantic-convention packages; verify a focused source test and `bun run build` prove compatibility with the standalone Bun executable.
- [ ] 1.2 Add provider initialization using standard OTLP environment configuration with remote export disabled by default; verify valid, absent, and invalid configuration through targeted observability tests.

## 2. Metrics and traces

- [ ] 2.1 Adapt `packages/observability` to record the existing typed metric and span names through OpenTelemetry while preserving bounded control-plane snapshots; verify `tests/observability.test.ts` covers both views without changing callers.
- [ ] 2.2 Continue validated W3C trace context from A2A ingress through durable acceptance, scheduler work, and runtime delivery; verify targeted A2A and scheduler tests cover valid and invalid remote context.
- [ ] 2.3 Enforce the telemetry attribute allowlist and bounded metric dimensions; verify tests reject or omit message content, attached data, credentials, paths, raw runtime payloads, and identifier-valued metric attributes.

## 3. Failure and lifecycle behavior

- [ ] 3.1 Isolate exporter errors and backpressure from task and delivery state transitions, with rate-limited local diagnostics; verify a failing local test exporter cannot reject, delay, or duplicate a delivery.
- [ ] 3.2 Flush and shut down telemetry within the daemon's existing shutdown deadline; verify an unavailable exporter cannot prevent process shutdown.
- [ ] 3.3 Keep durable security audit writes independent from telemetry and add targeted coverage proving audit events persist when export is disabled or failing.

## 4. Operator evidence

- [ ] 4.1 Document opt-in OTLP configuration, default offline behavior, exported resource attributes, privacy limits, and the distinction between telemetry and audit records; verify examples contain no credential-bearing endpoint values.
- [ ] 4.2 Run `mise run specs:check`, `bun test tests/observability.test.ts tests/a2a.test.ts tests/scheduler.test.ts`, `bun run typecheck`, `bun run lint`, `bun run format:check`, `bun run boundaries`, and `bun run build`; leave the full suite to CI.
