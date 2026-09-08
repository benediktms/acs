## Purpose

Define interoperable, privacy-safe operational metrics and traces for ACS without making communication or durable security auditing depend on telemetry infrastructure.

## ADDED Requirements

### Requirement: ACS exposes OpenTelemetry metrics and traces

ACS SHALL record its defined operational metrics and traces through OpenTelemetry-compatible providers. Existing control-plane metric and trace inspection SHALL remain available, and configuring no exporter SHALL require no external service or network connection.

#### Scenario: Default local operation

- **WHEN** ACS starts without an OpenTelemetry exporter configured
- **THEN** messaging operates normally without attempting remote telemetry export
- **AND** local control-plane telemetry inspection remains available

#### Scenario: OTLP export is configured

- **WHEN** an operator supplies valid standard OpenTelemetry OTLP configuration
- **THEN** ACS exports its metrics and traces to the configured endpoint

### Requirement: Distributed trace context crosses ACS boundaries

ACS SHALL accept valid W3C Trace Context at authenticated A2A ingress and preserve it across durable acceptance, scheduling, and runtime delivery. Invalid trace context SHALL be discarded without rejecting an otherwise valid message.

#### Scenario: Valid remote trace context

- **WHEN** an authenticated A2A request carries valid `traceparent` and optional valid `tracestate`
- **THEN** ACS telemetry for acceptance and subsequent delivery is correlated with that remote trace

#### Scenario: Invalid remote trace context

- **WHEN** an otherwise valid A2A request carries malformed trace context
- **THEN** ACS processes the request without adopting the malformed context

### Requirement: Telemetry failure is isolated from communication

Telemetry recording and export SHALL be best-effort. Exporter failure, backpressure, or absence SHALL NOT reject, delay, duplicate, or change the state of an A2A task or delivery.

#### Scenario: Exporter is unavailable

- **WHEN** the configured telemetry endpoint is unreachable during message processing
- **THEN** ACS continues message processing according to the task and delivery contracts
- **AND** reports the exporter problem through a bounded local diagnostic path

#### Scenario: Service shutdown

- **WHEN** ACS shuts down with telemetry pending
- **THEN** it attempts a bounded flush and completes shutdown when the deadline expires even if the exporter remains unavailable

### Requirement: Telemetry excludes sensitive and unbounded data

ACS SHALL NOT place message or artifact content, credentials, authentication tokens, filesystem paths, raw runtime payloads, or approval input in telemetry. Metric attributes SHALL use bounded dimensions; traces MAY include opaque ACS correlation identifiers but SHALL NOT include user-authored content.

#### Scenario: Peer content is processed

- **WHEN** ACS records telemetry for a peer message or runtime delivery
- **THEN** exported signal data contains operation and state metadata without the message body or attached data

#### Scenario: Metrics identify a task state

- **WHEN** ACS records a task or delivery metric
- **THEN** its attributes contain bounded state or outcome values rather than task, delivery, session, or agent identifiers

### Requirement: Durable audit remains independent

OpenTelemetry signals SHALL NOT be treated as authoritative audit records. Security-sensitive authorization, preemption, and administrative decisions SHALL retain their durable ACS audit events regardless of telemetry configuration or export success.

#### Scenario: Security decision is made while export is disabled

- **WHEN** ACS permits or rejects a security-sensitive operation with no telemetry exporter configured
- **THEN** the durable audit event is recorded according to the operation contract
