# ACS A2A v1 JSON-RPC Profile

**Status:** Normative companion to `SPEC.md`  
**Profile version:** 1  
**Protocol:** A2A v1  
**Binding:** JSON-RPC over HTTP, with A2A-defined streaming/SSE behavior

## 1. Protocol ownership

The official A2A v1 schema and the exact pinned `@a2a-js/sdk` serialization are authoritative for:

- JSON-RPC method names;
- request/response field names;
- A2A enum serialization;
- Agent Card structure;
- Task, Message, Part, Artifact and status-event shapes;
- standard error codes.

ACS does not fork these types.

This profile defines ACS behavior around those types: routing, authentication, durable acceptance, idempotency, delivery preferences, authorization and task execution.

## 2. Endpoint model

One logical ACS agent is one A2A agent root:

```text
/agents/{slug}/
```

Endpoints:

```text
GET  /agents/{slug}/.well-known/agent-card.json
POST /agents/{slug}/a2a
```

The target agent is selected exclusively by the URL.

A request body or metadata field purporting to select a different target is ignored or rejected.

## 3. Authentication

- Basic Agent Card: unauthenticated on loopback.
- Extended Agent Card: bearer token required.
- JSON-RPC endpoint: bearer token required.
- Token principal is injected into the A2A SDK `ServerCallContext`.
- The A2A `Message.role` is not an authorization identity.

## 4. Advertised capabilities

v1:

```text
streaming             true
push notifications    false
extended Agent Card   supported when authenticated
```

Input/output modes:

```text
text
```

URI and structured data parts are accepted where the pinned A2A schema permits them, but they are not automatically dereferenced.

## 5. Method profile

### SendMessage

- Validates and durably commits before success.
- Always returns a Task, not a bare response Message.
- Is non-blocking with respect to Codex model execution.
- Creates a new task when no task ID is supplied.
- Continues an existing non-terminal task only when requester, target and context match.
- Uses `(principal, target, messageId)` for idempotency.

### SendStreamingMessage

- Performs the same acceptance transaction.
- First exposes the accepted Task state.
- Streams persisted and live task events.
- Client disconnect does not cancel the task.

### GetTask

- Requester principal may read its task.
- Recipient uses the private executor/control contract rather than public A2A authorization.
- History truncation follows the standard request field and configured limits.

### ListTasks

- Returns only tasks visible to the requester principal at the selected target endpoint.
- Uses opaque stable cursor pagination.
- Enforces a configured maximum page size.

### CancelTask

- Pending delivery can be canceled immediately.
- An exact ACS-owned runtime execution may be interrupted when the adapter supports it.
- Unrelated or user-owned runtime execution is never interrupted.
- Ambiguous cancellation leaves cancellation requested and non-terminal until resolved.

### SubscribeToTask

- Authorizes exactly as GetTask.
- Replays current/persisted state before live events as allowed by the SDK binding.
- Never assumes an in-memory event bus is the source of truth.

### Push-notification methods

Return the standard unsupported-operation error. The Agent Card does not advertise push notifications.

## 6. Delivery metadata extension

Key and extension URI:

```text
urn:agent-communications:delivery:v1
```

Value:

```json
{
  "mode": "wake_when_idle",
  "priority": "normal",
  "notifyOn": ["input-required", "terminal"],
  "replyExpected": true,
  "expiresAt": "2026-09-04T15:00:00Z"
}
```

Validation is defined by `contracts/delivery-extension.schema.json`.

Unknown extension members are rejected in profile v1 to surface typos. Unknown unrelated A2A metadata is preserved where safe.

A wake request is not silently converted to context-only or active-turn steering.

## 7. ACS output metadata

ACS MAY include:

```text
urn:agent-communications:delivery-status:v1
```

Example:

```json
{
  "state": "queued",
  "deliveryId": "int_...",
  "reason": "recipient-busy"
}
```

These fields are diagnostic. Standard A2A task state remains authoritative for task lifecycle.

## 8. Durable acceptance transaction

A successful send commits:

- idempotency record;
- context;
- task;
- inbound message;
- task event;
- delivery intent;
- local origin notification subscription, when requested;
- materialized A2A task snapshot.

No Codex/app-server call occurs inside this transaction.

## 9. Error profile

HTTP:

```text
401 missing/invalid bearer token
403 authenticated principal lacks target permission
404 unknown agent root
413 request body exceeds limit
415 unsupported media type
429 admission/backpressure limit reached
```

JSON-RPC/A2A errors cover malformed protocol requests and task operations.

ACS-specific `error.data.code` values:

```text
ACS_AGENT_DISABLED
ACS_IDEMPOTENCY_CONFLICT
ACS_TASK_STATE_CONFLICT
ACS_TASK_NOT_VISIBLE
ACS_UNSUPPORTED_DELIVERY_MODE
ACS_MESSAGE_TOO_LARGE
ACS_STORAGE_UNAVAILABLE
ACS_OVERLOADED
```

`error.data.retryable` and `error.data.correlationId` are always present.

## 10. Conformance

The release pins:

- A2A protocol revision;
- `@a2a-js/sdk` exact version;
- A2A TCK commit;
- ACS profile version.

The compiled Bun executable must pass the selected JSON-RPC TCK profile.
