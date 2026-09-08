# Agent Communications Service (ACS)
## Codex-Only Technical Implementation Specification

**Document status:** Proposed implementation specification  
**Specification version:** 0.1.0  
**Date:** 2026-09-04  
**Initial harness:** OpenAI Codex only  
**Inter-agent protocol:** A2A v1, JSON-RPC binding  
**Implementation target:** TypeScript on Bun, compiled as a standalone executable  
**Persistence:** SQLite  
**Working project name:** Agent Communications Service (ACS)

---

## 1. Executive decision

ACS is a local-first service that makes independent Codex threads addressable as A2A agents.

The first implementation will consist of one compiled `acs` executable with three process modes:

```text
acs daemon run       Long-lived daemon and A2A server
acs mcp codex        Codex-facing MCP bridge over stdio
acs <command>        Short-lived control-plane CLI client
```

The daemon will:

1. maintain logical agent identities;
2. bind each logical agent to a Codex thread through a harness-neutral runtime binding;
3. expose each logical agent through an A2A v1 JSON-RPC endpoint and Agent Card;
4. durably accept A2A messages and tasks into SQLite;
5. schedule delivery through a generic runtime adapter;
6. translate accepted work into Codex app-server operations through the Codex adapter;
7. observe the resulting Codex turn and project its result back into the A2A task;
8. notify the originating Codex agent of important task events.

The architecture has four deliberately separate contracts:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. A2A data-plane contract                                  │
│    Standard inter-agent messages, tasks, status and streams │
├─────────────────────────────────────────────────────────────┤
│ 2. ACS application contract                                 │
│    Identity, routing, durability, policy and task ownership │
├─────────────────────────────────────────────────────────────┤
│ 3. Runtime adapter contract                                 │
│    Harness-neutral session observation and delivery         │
├─────────────────────────────────────────────────────────────┤
│ 4. Codex anti-corruption layer                              │
│    Codex app-server and Codex MCP metadata translation      │
└─────────────────────────────────────────────────────────────┘
```

The Codex app-server protocol is **not** the ACS protocol. It is one adapter implementation detail. No core package may import Codex app-server types, use the term `threadId` as a domain identifier, or branch on a Codex thread status.

A2A is the only public inter-agent data plane. ACS will not create a competing proprietary message protocol.

---

## 2. Normative language

The words **MUST**, **MUST NOT**, **REQUIRED**, **SHOULD**, **SHOULD NOT**, **MAY**, and **OPTIONAL** are normative.

A requirement marked **v1** is required for the first usable release. A requirement marked **future** defines an architectural seam but is not part of the first implementation.

---

## 3. Scope

### 3.1 In scope for v1

- Local machine operation on macOS and Linux.
- Multiple independent Codex threads.
- Stable logical agent names independent of Codex thread IDs.
- Explicit binding of logical agents to Codex threads.
- Agent discovery through the ACS MCP bridge and A2A Agent Cards.
- A2A v1 JSON-RPC message and task operations.
- Text messages and safe URI/data references.
- Durable task, message, event and delivery state in SQLite.
- Asynchronous delivery to Codex via app-server.
- Safe context-only delivery using `thread/inject_items`.
- Wake delivery using a capability-selected Codex mechanism.
- Automatic correlation of ACS-started Codex turns.
- Automatic task completion from the recipient's final Codex answer.
- Explicit task completion, failure and input-required updates through MCP tools.
- Idempotent request acceptance.
- Crash recovery and ambiguous-delivery reconciliation.
- One standalone Bun executable.
- A generic runtime adapter contract and conformance suite.
- A Codex-specific implementation of that contract.

### 3.2 Explicitly out of scope

- Claude Code or any non-Codex harness implementation.
- Symphony or workflow/orchestration integration.
- Agent planning, decomposition, scheduling by skill, or supervisor logic.
- Automatic creation of teams or parent/child agent hierarchies.
- Shared model context or shared memory.
- Remote multi-host operation.
- Internet-exposed operation.
- Multi-user tenancy.
- gRPC.
- A2A push notifications.
- Binary payload transport.
- Repository indexing, embeddings, search, or artifact storage.
- Permission approval on behalf of a receiving Codex session.
- Silent inheritance or escalation of sandbox, filesystem, network, or approval permissions.
- Exactly-once model execution.
- Transparent interruption of user-owned Codex turns.
- A graphical user interface.

### 3.3 Future compatibility objective

A future harness MUST be addable by implementing the runtime adapter and caller-attestation contracts without changing:

- A2A request handling;
- task state transitions;
- persistence schema semantics;
- delivery scheduling;
- authorization rules;
- MCP tool semantics;
- logical agent identity.

Adding a harness MAY require a harness-specific bridge process or SDK dependency, but it MUST NOT require a new inter-agent protocol.

---

## 4. Research baseline and relevant Codex behavior

This specification is based on the following behavior observed in the current Codex and A2A implementations.

### 4.1 Codex app-server

Codex app-server exposes a bidirectional JSON-RPC-like protocol. The wire format omits the normal JSON-RPC `jsonrpc` member. Its stable stdio transport uses JSON Lines; its local daemon exposes a Unix-socket control endpoint using a WebSocket upgrade. A connection must perform `initialize` followed by an `initialized` notification before other calls. Codex can generate TypeScript and JSON Schema bindings that match the installed binary.

Relevant app-server operations include:

- `thread/list`;
- `thread/read`;
- `thread/loaded/list`;
- `thread/resume`;
- `thread/inject_items`;
- `turn/start`;
- `turn/interrupt`;
- thread, turn and item notifications.

Current app-server behavior permits a named standalone tool output in `turn/start`. It can start a turn with empty user input, preserving the event as tool-authority context rather than pretending that another agent's content is a user message.

Current tests also show that `thread/inject_items` can append a named function-call output to model-visible history without immediately running the model. The item becomes part of the next model request.

App-server uses bounded ingress queues. The documented overload response is retryable and MUST be handled with bounded exponential backoff and jitter.

### 4.2 Codex MCP caller metadata

Current Codex code attaches a host-owned `threadId` to MCP `tools/call` metadata. ACS can therefore identify the runtime thread that invoked an ACS tool without asking the model to provide its own identity.

This is a Codex-specific capability, not a standard MCP identity guarantee. ACS MUST:

- feature-detect it;
- fail closed when mutating tools lack trusted caller evidence;
- keep the key name and parsing logic inside the Codex caller-attestor;
- offer a diagnostic command;
- avoid embedding this assumption into generic MCP or core packages.

### 4.3 A2A JavaScript SDK

The examined A2A SDK exposes a framework-neutral JSON-RPC transport handler and a request-handler interface covering message submission, streaming, task reads, task listing, cancellation, resubscription, Agent Cards, and push-notification configuration.

The SDK's non-Express JSON-RPC layer accepts a request body and returns either one JSON-RPC response or an asynchronous stream of responses. ACS will mount that layer directly on a Web-standard HTTP server rather than using Express.

The examined package formally declares Node 20 or newer even though its core/non-gRPC bundle is designed to be runtime-neutral. Bun compatibility and standalone compilation are therefore mandatory phase-zero gates, not assumptions.

### 4.4 Known active-turn race

A status check followed by `turn/start` is not atomic. A thread can become active after ACS observes it as idle. Current `turn/start` behavior may steer a compatible active turn rather than rejecting the request.

ACS MUST NOT hide this race.

The safe capability order is:

1. an atomic runtime queue/deferred-delivery primitive, when tested and supported;
2. an explicitly requested context-only injection;
3. non-atomic idle-check wake only after explicit binding-level opt-in;
4. active-turn steering only as a separately explicit experimental policy.

A wake request is never silently downgraded to context-only delivery.

---

## 5. Architectural principles

### 5.1 Durable acceptance is not execution

A successful A2A `SendMessage` response means:

- the request was authenticated and validated;
- its idempotency record was committed;
- its task/message state was committed;
- its target logical agent was resolved;
- its delivery intent was committed.

It does **not** mean:

- Codex accepted the delivery;
- a Codex turn started;
- the recipient saw the message;
- the task completed.

These milestones MUST remain separately observable.

### 5.2 Identity is attested, never model-asserted

Mutating MCP tools MUST derive the caller from host evidence. They MUST NOT accept a `from`, `sender`, `agentId`, or `threadId` argument supplied by the model.

### 5.3 Receiving permissions remain local

An incoming agent message is information, not authority.

The Codex adapter MUST preserve the target thread's existing:

- working directory;
- permission profile;
- sandbox;
- approval policy;
- model;
- service tier;
- environment selection.

It MUST omit those overrides from delivery calls.

A remote or peer agent MUST NOT answer local permission prompts or grant tool approval.

### 5.4 Vendor protocols terminate at adapters

Codex-specific types and error codes terminate in `runtime-codex`.

The application layer only receives normalized adapter results and events.

### 5.5 Large content is referenced

Text is inline. Files, commits, pull requests, logs, and other large objects SHOULD be represented by URIs and metadata. ACS MUST NOT automatically dereference a received URI.

### 5.6 Fail closed on ambiguous authority; fail durable on availability

- Missing or ambiguous caller identity: reject.
- Missing recipient runtime: accept durably and queue, if the logical agent exists and policy allows queueing.
- Ambiguous runtime acceptance: do not blindly retry an execution-starting operation.

---

## 6. System context

```text
┌──────────────────────┐            ┌──────────────────────┐
│ Codex thread A       │            │ Codex thread B       │
│ logical: architect   │            │ logical: backend     │
│                      │            │                      │
│ ACS MCP tools        │            │ ACS MCP tools        │
└──────────┬───────────┘            └──────────┬───────────┘
           │ MCP stdio                         │ MCP stdio
           ▼                                   ▼
┌──────────────────────┐            ┌──────────────────────┐
│ acs mcp codex        │            │ acs mcp codex        │
│ short-lived bridge   │            │ short-lived bridge   │
└──────────┬───────────┘            └──────────┬───────────┘
           │ local control + A2A HTTP          │
           └──────────────────┬────────────────┘
                              ▼
                    ┌─────────────────────┐
                    │ acs daemon          │
                    │                     │
                    │ A2A JSON-RPC        │
                    │ identity/catalogue  │
                    │ task engine         │
                    │ delivery scheduler  │
                    │ SQLite              │
                    │ runtime adapters    │
                    └──────────┬──────────┘
                               │ RuntimeAdapter v1
                               ▼
                    ┌─────────────────────┐
                    │ Codex adapter       │
                    │ app-server client   │
                    └──────────┬──────────┘
                               │ Codex app-server protocol
                               ▼
                    ┌─────────────────────┐
                    │ codex app-server    │
                    │ shared local daemon │
                    └─────────────────────┘
```

### 6.1 Process responsibilities

#### `acs daemon run`

Owns:

- SQLite connection and migrations;
- A2A HTTP listener;
- local control socket;
- principal and token validation;
- agent catalogue;
- runtime bindings;
- task event log and materialized task snapshots;
- delivery scheduler;
- runtime adapters;
- task-event notification projection;
- observability.

#### `acs mcp codex`

Owns:

- MCP stdio lifecycle;
- MCP tool schemas;
- extraction and forwarding of host invocation evidence;
- binding-scoped caller authentication;
- A2A client calls to the daemon;
- private executor callbacks to the control plane;
- concise tool results.

It MUST NOT own:

- durable task state;
- a second SQLite connection;
- app-server connections;
- delivery retries;
- agent registration state.

#### CLI mode

Owns:

- human-readable commands;
- local control-protocol calls;
- formatting and exit codes.

It MUST NOT bypass application authorization by accessing SQLite directly.

---

## 7. Package and dependency architecture

```text
apps/
  acs/                         composition root and CLI

packages/
  domain/                      pure domain types and state machines
  application/                 use cases and orchestration
  ports/                       storage, clock, IDs, runtime, auth
  protocol-a2a/                A2A SDK integration and HTTP binding
  protocol-control/            local control JSON-RPC server/client
  bridge-mcp/                  generic MCP bridge
  bridge-mcp-codex/            Codex host metadata adapter
  runtime-contract/            public RuntimeAdapter v1 types
  runtime-codex/               Codex adapter and app-server translation
  codex-protocol-generated/    pinned generated app-server types
  storage-sqlite/              Bun SQLite implementation
  observability/               logs, metrics, tracing
  testkit/                     fakes, model tests, conformance suite

contracts/
  runtime-adapter.ts
  a2a-application-port.ts
  codex-app-server-boundary.ts
  control-protocol.ts
  mcp-tools.ts
  delivery-envelope.schema.json
  delivery-extension.schema.json

storage/
  001_initial.sql
```

### 7.1 Import rules

The following are hard architectural constraints:

| Package | May import Codex types | May import A2A SDK | May import Bun APIs |
|---|---:|---:|---:|
| `domain` | No | No | No |
| `ports` | No | No | No |
| `application` | No | No | No |
| `runtime-contract` | No | No | No |
| `protocol-a2a` | No | Yes | HTTP composition only |
| `bridge-mcp` | No | No | No |
| `bridge-mcp-codex` | Caller metadata only | No | No |
| `runtime-codex` | Yes | No | Transport implementation only |
| `storage-sqlite` | No | No | Yes |
| `apps/acs` | Composition only | Composition only | Yes |

These rules MUST be enforced in CI with import-boundary checks.

### 7.2 Domain purity

`domain` MUST have no dependency on:

- `@a2a-js/sdk`;
- an MCP SDK;
- Codex generated code;
- `bun:*`;
- `node:*`;
- HTTP;
- JSON-RPC.

Domain serialization is performed in protocol or storage packages.

---

## 8. Domain model

### 8.1 Identifier format

Internal IDs use lowercase prefixes followed by UUIDv7 text:

| Prefix | Entity |
|---|---|
| `agt_` | logical agent |
| `prn_` | authenticated principal |
| `ins_` | runtime installation |
| `bnd_` | runtime binding |
| `ctx_` | conversation context |
| `tsk_` | A2A task |
| `msg_` | internally stored message |
| `evt_` | task or audit event |
| `int_` | delivery intent |
| `atm_` | delivery attempt |
| `exe_` | normalized runtime execution |
| `sub_` | task event subscription |
| `tok_` | token record |
| `clm_` | one-time binding claim |

The runtime's own session and execution IDs remain opaque strings and MUST NOT be re-prefixed or parsed.

### 8.2 Logical agent

```ts
interface Agent {
  id: AgentId;
  slug: string;
  displayName: string;
  description: string;
  skills: AgentSkill[];
  enabled: boolean;
  profileRevision: number;
  createdAt: string;
  updatedAt: string;
}
```

Invariants:

- `slug` is unique case-insensitively.
- `slug` matches `[a-z][a-z0-9-]{0,62}`.
- Rename changes the alias but not `id`.
- Deleting an agent is soft deletion while tasks or bindings reference it.
- Runtime presence is not stored on the Agent Card.

Canonical local display address:

```text
agent://local/agt_...
```

Convenience aliases use:

```text
@backend
```

### 8.3 Principal

A principal is the authenticated actor, not merely an A2A role.

```ts
type PrincipalKind =
  | "local-user"
  | "bound-agent"
  | "service"
  | "external-a2a-client";

interface Principal {
  id: PrincipalId;
  kind: PrincipalKind;
  agentId?: AgentId;
  bindingId?: BindingId;
  scopes: string[];
  disabledAt?: string;
}
```

A2A `role` MUST NOT be used as the authorization identity.

### 8.4 Runtime installation

A runtime installation is one reachable harness control plane.

For Codex v1 it normally represents one local Codex home/app-server daemon.

```ts
interface RuntimeInstallation {
  id: RuntimeInstallationId;
  harness: "codex";
  adapterId: "codex.app-server";
  label: string;
  endpoint: RuntimeEndpoint;
  capabilitySnapshot: RuntimeCapabilities;
  protocolFingerprint?: string;
  state: "unknown" | "online" | "degraded" | "offline";
}
```

### 8.5 Runtime binding

```ts
interface RuntimeBinding {
  id: BindingId;
  agentId: AgentId;
  installationId: RuntimeInstallationId;
  session: RuntimeSessionRef;
  epoch: number;
  status: "pending" | "active" | "stale" | "revoked";
  continuityPolicy: "follow-pending" | "strict";
  deliveryPolicy: BindingDeliveryPolicy;
  createdAt: string;
  activatedAt?: string;
  revokedAt?: string;
}
```

Database constraints MUST ensure:

- at most one active binding per logical agent;
- at most one active binding for an installation/session pair;
- each successful rebind increments the agent's binding epoch;
- accepted runtime executions remain associated with their original binding epoch.

### 8.6 Context, task and message

ACS uses the standard A2A concepts as its public representation.

Internally:

```ts
interface ConversationContext {
  id: ContextId;
  targetAgentId: AgentId;
  requesterPrincipalId: PrincipalId;
  requesterAgentId?: AgentId;
  createdAt: string;
}

interface StoredTask {
  id: TaskId;
  contextId: ContextId;
  targetAgentId: AgentId;
  requesterPrincipalId: PrincipalId;
  requesterAgentId?: AgentId;
  state: NormalizedTaskState;
  stateVersion: number;
  a2aSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
}

interface StoredMessage {
  id: MessageRowId;
  externalMessageId: string;
  taskId: TaskId;
  contextId: ContextId;
  senderPrincipalId: PrincipalId;
  senderAgentId?: AgentId;
  targetAgentId: AgentId;
  role: "user" | "agent";
  parts: NeutralPart[];
  metadata: JsonObject;
  createdAt: string;
}
```

### 8.7 Normalized task state

The domain state names are independent of SDK enum spelling:

```ts
type NormalizedTaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "auth-required"
  | "completed"
  | "failed"
  | "canceled"
  | "rejected";
```

Allowed transitions:

```text
submitted ──► working ──► completed
    │            │  ├──► input-required ──► working
    │            │  ├──► failed
    │            │  └──► canceled
    ├────────────┼─────► rejected
    ├────────────┼─────► failed
    └────────────┴─────► canceled
```

Terminal states are immutable. Repeating the same terminal transition with the same payload is idempotent. Conflicting terminal transitions are rejected.

### 8.8 Delivery intent

A delivery intent is a durable promise to attempt presentation to a runtime.

```ts
type DeliveryIntentState =
  | "pending"
  | "leased"
  | "attempting"
  | "deferred"
  | "accepted"
  | "acceptance-unknown"
  | "failed-terminal"
  | "canceled"
  | "superseded";

interface DeliveryIntent {
  id: DeliveryIntentId;
  kind: "a2a-message" | "task-event-notification";
  taskId?: TaskId;
  messageId?: MessageRowId;
  targetAgentId: AgentId;
  pinnedBindingId?: BindingId;
  pinnedBindingEpoch?: number;
  mode: DeliveryMode;
  priority: number;
  state: DeliveryIntentState;
  reason?: DeliveryReason;
  notBefore: string;
  deadline?: string;
  attemptCount: number;
  payloadHash: string;
}
```

`accepted` means the runtime protocol acknowledged the delivery operation. It does not mean model completion.

### 8.9 Runtime execution

```ts
interface RuntimeExecution {
  id: RuntimeExecutionId;
  intentId: DeliveryIntentId;
  bindingId: BindingId;
  bindingEpoch: number;
  runtimeExecutionRef: string;
  state:
    | "accepted"
    | "started"
    | "awaiting-local-input"
    | "completed"
    | "failed"
    | "interrupted"
    | "unknown";
}
```

ACS MUST process only executions that it can correlate to an ACS delivery.

---

## 9. Public A2A data-plane contract

### 9.1 Binding and transport

v1 exposes A2A v1 over JSON-RPC via HTTP.

- Bind address defaults to loopback only.
- gRPC is not built or advertised.
- Streaming uses the A2A JSON-RPC/SSE behavior implemented by the pinned SDK.
- Push notifications are not advertised.
- Express is not used.
- The framework-neutral A2A `JsonRpcTransportHandler` is mounted behind a Web-standard `Request`/`Response` adapter.
- A custom `AcsA2ARequestHandler` implements the A2A request-handler interface directly.

### 9.2 Multi-agent endpoint layout

Every logical agent is projected as a distinct A2A agent root. Target routing is resolved from the URL, not from a proprietary recipient field.

```text
Agent root:
  http://127.0.0.1:7432/agents/{agent-slug}/

Agent Card:
  http://127.0.0.1:7432/agents/{agent-slug}/.well-known/agent-card.json

JSON-RPC endpoint:
  http://127.0.0.1:7432/agents/{agent-slug}/a2a
```

The Agent Card's supported JSON-RPC interface points at that agent's `/a2a` endpoint.

A renamed slug MAY leave a temporary redirect for human discovery, but A2A clients SHOULD refresh the Agent Card. Tasks are keyed by immutable agent ID internally.

### 9.3 Agent Card

A projected Agent Card includes:

- logical agent display name and description;
- profile version;
- A2A protocol version;
- one JSON-RPC interface;
- streaming capability;
- no push-notification capability;
- bearer-token security scheme;
- configured skills;
- text input/output modes;
- the ACS delivery extension URI.

The card MUST NOT expose:

- Codex thread ID;
- Codex home path;
- runtime socket path;
- current working directory;
- sandbox or approval details;
- online/busy presence;
- binding ID.

Presence is a control-plane concern.

### 9.4 Supported methods

v1 MUST implement:

| Method | v1 semantics |
|---|---|
| `SendMessage` | Durably accepts a new or continuing task and returns a Task snapshot |
| `SendStreamingMessage` | Accepts as above, yields initial Task, then streams task events |
| `GetTask` | Returns a visible task snapshot |
| `ListTasks` | Lists visible tasks with SDK-compatible filters/pagination |
| `CancelTask` | Requests cancellation according to the cancellation contract |
| `SubscribeToTask` | Resubscribes to persisted plus live task events |
| `GetExtendedAgentCard` | Returns the same or auth-enriched card |

Push-notification configuration methods return the A2A unsupported-operation error because the Agent Card does not advertise the capability.

### 9.5 SendMessage acceptance algorithm

For a valid request, the server executes one short SQLite transaction:

1. authenticate the transport principal;
2. resolve target agent from the URL;
3. validate A2A version and request;
4. normalize parts;
5. validate ACS extension metadata;
6. derive the idempotency scope;
7. look up an existing idempotency record;
8. create or validate context;
9. create or validate task;
10. append the inbound message;
11. append a task event;
12. create the delivery intent;
13. create event-notification subscriptions requested by the local caller;
14. materialize the new A2A Task snapshot;
15. persist the idempotent response;
16. commit.

Only after commit may the A2A request return success.

The delivery scheduler is signaled after commit. Runtime delivery MUST NOT occur inside the acceptance transaction.

### 9.6 Idempotency

The canonical idempotency tuple is:

```text
(requester principal ID, target agent ID, A2A message ID)
```

The stored request hash covers all semantically relevant request fields after canonical normalization.

- Same tuple and same hash: return the original/current task.
- Same tuple and different hash: reject with `ACS_IDEMPOTENCY_CONFLICT`.
- No tuple: create records normally.

For MCP-originated calls, the bridge SHOULD derive the A2A message ID from host-owned MCP item evidence when available. A model-supplied retry key is supplementary, not authoritative.

### 9.7 New task versus continuation

A message without a task ID creates a new task.

A message with a task ID is a continuation only when:

- the task exists;
- requester principal matches;
- target agent matches;
- context ID matches when supplied;
- task is in a state that accepts input.

A message continuing an `input-required` task transitions it to `working` within the same transaction that appends the new message and delivery intent.

A follow-up to a terminal task is rejected.

### 9.8 Response style

`SendMessage` is non-blocking from the model-execution perspective. It returns a `submitted` or `working` Task after durable acceptance.

The returned task MAY contain ACS delivery metadata, but callers MUST use task state/events rather than infer model execution from HTTP latency.

`replyExpected` controls result expectations, not durable-delivery semantics:

- `true`: a successful correlated Codex turn captures the final agent message as the task result unless the assignee reports a result explicitly;
- `false`: a successful correlated Codex turn completes the task without requiring a result body;
- context-only delivery cannot prove processing, so it requires `executor.task.acknowledge`, completion/failure, or a future positively correlated runtime event even when `replyExpected=false`.

### 9.9 Streaming and replay

Every persisted task event receives a monotonically increasing `sequence` per task.

The streaming implementation MUST avoid a database-to-live-subscription gap:

1. begin a read transaction and determine the current maximum sequence;
2. register an in-memory subscription starting after that sequence;
3. read and emit persisted events through the maximum;
4. consume live events;
5. on reconnect, repeat from the last acknowledged/known sequence where supported.

If the A2A wire operation does not expose a client cursor, ACS MUST at least emit a current Task snapshot before live updates and rely on `GetTask` for reconciliation.

Disconnecting a stream does not cancel the task.

### 9.10 Delivery extension

ACS defines one optional A2A metadata extension:

```text
urn:agent-communications:delivery:v1
```

It is placed under the request metadata key of the same value:

```json
{
  "metadata": {
    "urn:agent-communications:delivery:v1": {
      "mode": "wake_when_idle",
      "priority": "normal",
      "notifyOn": ["input-required", "terminal"],
      "replyExpected": true,
      "expiresAt": "2026-09-04T15:00:00Z"
    }
  }
}
```

Schema:

```ts
interface AcsDeliveryExtensionV1 {
  mode?: "wake_when_idle" | "append_context";
  priority?: "low" | "normal" | "high";
  notifyOn?: Array<
    "working" | "input-required" | "completed" |
    "failed" | "canceled" | "rejected" | "terminal"
  >;
  replyExpected?: boolean;
  expiresAt?: string;
}
```

Defaults:

```text
mode          wake_when_idle
priority      normal
notifyOn      input-required, terminal
replyExpected true
expiresAt     absent
```

A requested wake mode can remain queued when the binding cannot safely wake. It MUST NOT be silently downgraded to active-turn steering.

### 9.11 A2A authorization

The basic Agent Card endpoint is readable without authentication on loopback so clients can discover the required security scheme. The JSON-RPC endpoint and extended Agent Card require authentication.

A2A bearer tokens identify principals.

A principal may:

- send messages to enabled agents allowed by ACL;
- read/list/cancel tasks it requested;
- subscribe to tasks it requested.

The recipient runtime does not use the public A2A token to mutate its task. It reports execution results through the authenticated private executor control contract.

### 9.12 A2A errors

Authentication failures occur at HTTP level before JSON-RPC dispatch.

Protocol and application errors use SDK-compatible A2A/JSON-RPC errors. Error `data` includes:

```ts
interface AcsErrorData {
  code: string;
  retryable: boolean;
  correlationId: string;
  details?: JsonObject;
}
```

Required machine codes include:

- `ACS_AGENT_DISABLED`;
- `ACS_IDEMPOTENCY_CONFLICT`;
- `ACS_TASK_STATE_CONFLICT`;
- `ACS_TASK_NOT_VISIBLE`;
- `ACS_UNSUPPORTED_DELIVERY_MODE`;
- `ACS_MESSAGE_TOO_LARGE`;
- `ACS_STORAGE_UNAVAILABLE`;
- `ACS_OVERLOADED`.

A missing/offline Codex binding is not an A2A acceptance error. It is a delivery condition.

---

## 10. Local control-plane protocol

### 10.1 Purpose

The control plane exists for operations A2A intentionally does not model:

- logical agent administration;
- runtime installations and bindings;
- one-time identity claims;
- caller attestation;
- executor callbacks;
- diagnostics;
- delivery inspection and recovery;
- local operator actions.

It MUST NOT grow a second general-purpose `sendMessage` operation.

### 10.2 Transport

v1 uses JSON-RPC 2.0 over HTTP on a Unix domain socket.

Runtime socket location:

```text
Linux: $XDG_RUNTIME_DIR/acs/control.sock
macOS: $TMPDIR/acs-{uid}/control.sock
```

The containing directory is mode `0700`; the socket is owner-only. A fallback loopback TCP listener is permitted only when explicitly configured and MUST require the same token authentication.

Every request includes:

```text
Authorization: Bearer <control-token>
ACS-Control-Version: 1
Content-Type: application/json
```

The bootstrap local-user control token is 256 random bits and is stored only as a mode-`0600` local file. `acs codex install-mcp` creates a separate mode-`0600` bridge token with only caller-attestation, token-exchange, inbox, and executor-callback scopes. The MCP bridge MUST NOT use the local-user token. SQLite stores only token hashes for scoped tokens.

### 10.3 Version negotiation

The first semantic call by a client is:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "system.initialize",
  "params": {
    "protocolVersion": "1.0",
    "client": {
      "name": "acs-mcp-codex",
      "version": "0.1.0",
      "instanceId": "..."
    },
    "capabilities": {}
  }
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": {
    "protocolVersion": "1.0",
    "server": {
      "name": "acs",
      "version": "0.1.0",
      "instanceId": "..."
    },
    "capabilities": {
      "codex": true,
      "a2aJsonRpc": true,
      "taskEventNotifications": true
    }
  }
}
```

Major-version mismatch is terminal. Minor versions are backward-compatible within the same major.

### 10.4 Required control methods

#### System

```text
system.initialize
system.health
system.capabilities
system.shutdown
```

`system.shutdown` requires the local-user principal.

#### Agent catalogue

```text
agents.create
agents.get
agents.list
agents.update
agents.delete
agents.createClaim
```

#### Binding administration

```text
bindings.bind
bindings.claim
bindings.get
bindings.list
bindings.revoke
bindings.retargetPending
```

#### Runtime diagnostics

```text
runtimes.list
runtimes.probe
runtimes.sessions.list
runtimes.sessions.inspect
```

#### Bridge/caller identity

```text
bridge.attestCaller
bridge.issueA2AToken
bridge.identity
```

#### Executor callbacks

```text
executor.task.publishMessage
executor.task.publishArtifact
executor.task.requestInput
executor.task.complete
executor.task.fail
executor.task.acknowledge
```

#### Assigned work

```text
inbox.list
inbox.get
```

#### Delivery operations

```text
deliveries.list
deliveries.get
deliveries.retry
deliveries.cancel
deliveries.resolveUnknown
```

### 10.5 Control authorization

| Method group | local user | bound agent | service |
|---|---:|---:|---:|
| Agent administration | Yes | No | Optional |
| Binding administration | Yes | Claim only | Optional |
| Runtime diagnostics | Yes | Limited | Yes |
| A2A caller token | No | Self only | Yes |
| Executor callbacks | No | Assigned task only | Yes |
| Inbox | Optional all | Self only | Yes |
| Delivery recovery | Yes | No | Yes |

`executor.*` authorization requires all of:

- attested runtime session;
- active or historically pinned binding;
- matching binding epoch;
- task target agent matches;
- task is non-terminal;
- operation is legal in current state.

---

## 11. Codex-facing MCP bridge contract

### 11.1 Bootstrap

Codex is configured with one MCP stdio server command:

```text
/path/to/acs mcp codex
```

The exact Codex config edit is performed by:

```text
acs codex install-mcp
```

The MCP process connects to the ACS control socket but does not connect to Codex app-server.

### 11.2 Caller evidence

For every mutating tool call, the bridge passes the original host `_meta` to:

```text
bridge.attestCaller
```

The Codex caller-attestor recognizes the current Codex-owned thread identifier and returns:

```ts
type CallerAttestation =
  | {
      kind: "attested";
      scheme: "codex-mcp-thread-meta-v1";
      session: RuntimeSessionRef;
      bindingId: BindingId;
      bindingEpoch: number;
      agentId: AgentId;
      principalId: PrincipalId;
      evidenceFingerprint: string;
    }
  | {
      kind: "unattested";
      reason:
        | "missing-host-metadata"
        | "missing-session-id"
        | "invalid-session-id"
        | "unbound-session"
        | "stale-binding"
        | "runtime-unreachable";
    };
```

Raw host metadata MUST NOT be logged. Logs retain only a redacted fingerprint and selected non-sensitive version fields.

### 11.3 MCP tools

The v1 tool set is:

#### `acs_identity`

Read-only.

```json
{}
```

Returns the attested thread identity and current logical-agent binding. It may return an unbound state.

#### `acs_agents_list`

Read-only.

```json
{
  "status": "any",
  "skill": null,
  "limit": 50,
  "cursor": null
}
```

Returns logical agents, configured skills, and coarse availability. It does not reveal runtime IDs.

#### `acs_agent_get`

Read-only.

```json
{
  "agent": "@backend"
}
```

#### `acs_send`

Mutating.

```json
{
  "to": "@backend",
  "text": "Implement token rotation and report the commit.",
  "taskId": null,
  "contextId": null,
  "delivery": "wake_when_idle",
  "priority": "normal",
  "replyExpected": true,
  "notifyOn": ["input-required", "terminal"],
  "attachments": [
    {
      "kind": "uri",
      "uri": "git:commit:abc123",
      "name": "design baseline",
      "mediaType": "text/x-git-commit"
    }
  ],
  "clientRequestId": null
}
```

The bridge:

1. attests the caller;
2. resolves the target agent;
3. obtains a short-lived binding-scoped A2A bearer token;
4. creates a standard A2A message;
5. invokes the target's A2A JSON-RPC endpoint;
6. returns the accepted task ID and current status.

It MUST NOT submit a sender identity supplied in arguments.

#### `acs_task_get`

Read-only for requester or assignee.

```json
{ "taskId": "tsk_..." }
```

#### `acs_task_reply`

Mutating requester continuation.

```json
{
  "taskId": "tsk_...",
  "text": "Use tenant ID as part of the rotation key.",
  "attachments": []
}
```

This becomes a standard A2A continuation message.

#### `acs_task_cancel`

Mutating requester operation.

```json
{
  "taskId": "tsk_...",
  "reason": "No longer required"
}
```

#### `acs_task_complete`

Mutating assignee operation.

```json
{
  "taskId": "tsk_...",
  "summary": "Implemented rotation in commit abc123.",
  "artifacts": [
    {
      "kind": "uri",
      "uri": "git:commit:abc123",
      "name": "implementation"
    }
  ]
}
```

#### `acs_task_fail`

Mutating assignee operation.

```json
{
  "taskId": "tsk_...",
  "summary": "Blocked by a failing migration.",
  "retryable": true
}
```

#### `acs_task_request_input`

Mutating assignee operation.

```json
{
  "taskId": "tsk_...",
  "question": "Should old refresh tokens be invalidated immediately?",
  "choices": ["yes", "no", "grace period"],
  "blocking": true
}
```

#### `acs_inbox_list`

Read-only for the attested assignee.

```json
{
  "states": ["submitted", "working", "input-required"],
  "limit": 20,
  "cursor": null
}
```

### 11.4 Tool-call idempotency

The bridge derives a stable message ID from:

1. Codex host-owned MCP item/call ID when available;
2. otherwise caller thread + turn evidence + explicit `clientRequestId`;
3. otherwise a fresh UUIDv7.

When only a fresh UUID is possible, the tool result MUST warn that a host-level retry could duplicate the request.

### 11.5 Tool results

Every result contains structured content:

```ts
interface McpAcsResult<T> {
  schemaVersion: 1;
  ok: boolean;
  correlationId: string;
  data?: T;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
```

The human-readable text SHOULD be brief because the structured result is authoritative.

---

## 12. Runtime adapter contract

The companion `contracts/runtime-adapter.ts` is normative. The key contract follows.

```ts
export interface RuntimeAdapter {
  readonly descriptor: RuntimeAdapterDescriptor;

  start(context: RuntimeAdapterContext): Promise<void>;
  stop(context: RuntimeAdapterStopContext): Promise<void>;

  probe(signal?: AbortSignal): Promise<RuntimeProbeResult>;

  listSessions(
    query: RuntimeSessionQuery,
    signal?: AbortSignal,
  ): Promise<RuntimeSessionPage>;

  inspectSession(
    session: RuntimeSessionRef,
    signal?: AbortSignal,
  ): Promise<RuntimeSessionSnapshot>;

  observe(signal: AbortSignal): AsyncIterable<RuntimeEvent>;

  deliver(
    request: RuntimeDeliveryRequest,
    signal?: AbortSignal,
  ): Promise<RuntimeDeliveryResult>;

  reconcile(
    request: RuntimeReconcileRequest,
    signal?: AbortSignal,
  ): Promise<RuntimeReconcileResult>;

  cancel(
    request: RuntimeCancelRequest,
    signal?: AbortSignal,
  ): Promise<RuntimeCancelResult>;
}
```

### 12.1 Descriptor and capabilities

```ts
interface RuntimeAdapterDescriptor {
  adapterApiVersion: 1;
  adapterId: string;
  harnessId: string;
  implementationVersion: string;
  capabilities: {
    listSessions: boolean;
    observeSessionState: boolean;
    observeExecutions: boolean;
    appendContext: boolean;
    wakeWhenIdle: boolean;
    atomicDeferredWake: boolean;
    steerActiveExecution: boolean;
    cancelOwnedExecution: boolean;
    reconcileDelivery: boolean;
    callerAttestationSchemes: string[];
    supportedPartKinds: Array<"text" | "uri" | "data">;
  };
}
```

Capabilities MUST be runtime-probed and may be lower than compile-time capability.

### 12.2 Opaque session reference

```ts
interface RuntimeSessionRef {
  installationId: string;
  opaqueId: string;
}
```

Core treats `opaqueId` as an uninterpreted identifier.

### 12.3 Normalized availability

```ts
type RuntimeAvailability =
  | "unknown"
  | "offline"
  | "dormant"
  | "idle"
  | "busy"
  | "awaiting-local-input"
  | "degraded";
```

Unknown vendor statuses map to `unknown`, never optimistically to `idle`.

### 12.4 Delivery request

```ts
interface RuntimeDeliveryRequest {
  deliveryId: string;
  target: {
    session: RuntimeSessionRef;
    bindingId: string;
    bindingEpoch: number;
  };
  mode: "wake_when_idle" | "append_context" | "join_active";
  envelope: RuntimeDeliveryEnvelopeV1;
  payloadHash: string;
  deadline?: string;
  traceContext?: {
    traceparent?: string;
    tracestate?: string;
  };
}
```

The adapter MUST validate binding epoch immediately before side effects through the supplied application callback/fence.

### 12.5 Delivery result

```ts
type RuntimeDeliveryResult =
  | {
      outcome: "accepted";
      acceptedAt: string;
      execution?: {
        opaqueId: string;
        alreadyRunning: boolean;
      };
      evidence: {
        scheme: string;
        value: string;
      };
    }
  | {
      outcome: "deferred";
      reason:
        | "offline"
        | "dormant"
        | "busy"
        | "manual-wake-required"
        | "backpressure"
        | "policy";
      retryAfterMs?: number;
    }
  | {
      outcome: "rejected";
      reason:
        | "stale-binding"
        | "session-not-found"
        | "unsupported-mode"
        | "unsupported-content"
        | "permission-denied"
        | "runtime-protocol-error";
      retryable: boolean;
      details?: JsonObject;
    }
  | {
      outcome: "acceptance-unknown";
      ambiguity:
        | "request-flushed-no-response"
        | "response-lost-before-persist"
        | "connection-reset"
        | "runtime-state-ambiguous";
      reconciliationToken: string;
    };
```

Expected runtime conditions MUST be represented by this union, not thrown exceptions. Exceptions are reserved for local programming errors or process-level failures.

### 12.6 Reconciliation

```ts
type RuntimeReconcileResult =
  | {
      outcome: "accepted";
      execution?: { opaqueId: string };
      evidence: JsonObject;
    }
  | {
      outcome: "not-accepted";
      evidence: JsonObject;
      safeToRetry: boolean;
    }
  | {
      outcome: "inconclusive";
      reason: string;
      operatorActionRequired: boolean;
    };
```

An adapter MUST NOT claim `not-accepted` solely because it failed to find a marker in a truncated or compacted history.

### 12.7 Runtime events

```ts
type RuntimeEvent =
  | {
      type: "session.observed";
      session: RuntimeSessionRef;
      snapshot: RuntimeSessionSnapshot;
    }
  | {
      type: "execution.started";
      session: RuntimeSessionRef;
      execution: RuntimeExecutionRef;
      correlation?: RuntimeCorrelation;
    }
  | {
      type: "execution.output";
      execution: RuntimeExecutionRef;
      channel: "final-message" | "status";
      parts: NeutralPart[];
    }
  | {
      type: "execution.awaiting-local-input";
      execution: RuntimeExecutionRef;
      request: LocalInputRequest;
    }
  | {
      type: "execution.completed";
      execution: RuntimeExecutionRef;
      outcome: "completed" | "interrupted" | "failed";
      finalParts: NeutralPart[];
      error?: RuntimeError;
    }
  | {
      type: "adapter.connection";
      state: "online" | "degraded" | "offline";
      reason?: string;
    };
```

The adapter MUST NOT expose chain-of-thought or reasoning streams to the application layer.

### 12.8 Adapter conformance invariants

Every adapter implementation MUST pass tests proving:

- no side effect when binding epoch is stale;
- no side effect when returning `deferred`;
- accepted delivery has stable evidence;
- an execution event is emitted only for correlated executions;
- cancellation cannot target an unowned execution;
- unknown runtime status maps conservatively;
- duplicate reconciliation does not create a second execution;
- unsupported content is rejected before runtime mutation;
- adapter shutdown cancels observation without corrupting delivery state.

---

## 13. Codex adapter implementation

### 13.1 Internal layering

```text
CodexRuntimeAdapter
    │
    ├── CodexSessionMapper
    ├── CodexDeliveryRenderer
    ├── CodexEventNormalizer
    ├── CodexCallerAttestor
    └── CodexAppServerClient
            │
            ├── CodexProtocolCodec
            └── CodexAppServerTransport
                    ├── UnixSocketWebSocketTransport
                    └── StdioChildTransport
```

Only `CodexRuntimeAdapter` and `CodexCallerAttestor` implement public ACS contracts.

### 13.2 App-server transport

Preferred mode:

```text
codex app-server daemon
        │
        └── protected Unix socket, WebSocket framing
```

Fallback mode:

```text
ACS-managed codex app-server --stdio
```

The stdio fallback is suitable for tests and ACS-managed threads. It cannot be assumed to observe threads owned by a different app-server process.

The Unix-socket transport is a phase-zero gate. The implementation MAY use Bun's Node-compatible socket APIs, but the transport MUST remain behind `CodexAppServerTransport`.

### 13.3 App-server client protocol

The client MUST:

1. establish transport;
2. send one `initialize` request;
3. receive success;
4. send `initialized`;
5. begin request/notification processing;
6. maintain a bounded map of in-flight request IDs;
7. route server notifications separately from responses;
8. handle server-to-client requests explicitly;
9. reconnect with capped exponential backoff;
10. perform authoritative reconciliation after reconnect.

Wire request example:

```json
{
  "id": 1,
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "agent_communications_service",
      "title": "Agent Communications Service",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

The adapter MUST omit the `jsonrpc` member on app-server wire messages.

### 13.4 Protocol generation and compatibility

The repository pins a tested Codex version in one file:

```text
packages/codex-protocol-generated/CODEX_VERSION
```

A maintenance script runs:

```text
codex app-server generate-ts --out <temporary-directory>
codex app-server generate-json-schema --out <temporary-directory>
```

It normalizes and vendors only the protocol files used by the adapter.

Rules:

- generated files are never hand-edited;
- generated code is imported only by `runtime-codex`;
- CI fails when regeneration differs from committed output;
- a runtime Codex version outside the tested compatibility range is reported by `acs codex doctor`;
- unknown fields are tolerated;
- unknown enum variants map conservatively;
- mutating capabilities are proven by version/capability checks before use.

The minimum supported Codex version is set only after phase-zero testing. This document intentionally does not invent one.

### 13.5 Session discovery

The adapter uses:

- `thread/loaded/list` for loaded IDs;
- `thread/list` for stored thread discovery;
- `thread/read` for an authoritative snapshot;
- thread status notifications for low-latency updates.

`listSessions` returns opaque sessions with safe metadata:

```ts
interface RuntimeSessionSnapshot {
  session: RuntimeSessionRef;
  availability: RuntimeAvailability;
  observedAt: string;
  revision?: string;
  attributes: {
    displayTitle?: string;
    cwdHint?: string;
    sourceKind?: string;
  };
}
```

The control CLI MAY display a cwd hint to the local user. It MUST NOT expose it through Agent Cards or A2A.

ACS does not automatically turn every discovered thread into an agent.

### 13.6 Binding flows

#### Manual binding

```text
acs agents create backend
acs codex sessions list
acs bindings bind @backend --session <opaque-thread-id>
```

The daemon:

1. checks local-user authorization;
2. asks the adapter to inspect the session;
3. verifies no active conflict;
4. creates the active binding and epoch;
5. creates the bound-agent principal;
6. emits an audit event.

#### One-time claim

```text
acs agents create backend --claim
```

Returns a short-lived one-time claim code.

Inside the intended Codex thread, `acs_identity` shows unbound, then `bindings.claim` is invoked through a dedicated MCP claim flow using:

- host-attested Codex thread ID;
- one-time claim code;
- adapter session verification.

A claim code is single-use, hashed at rest, expires by default after ten minutes, and is scoped to one logical agent.

### 13.7 Codex caller attestation

The Codex caller-attestor accepts:

```ts
interface CodexMcpInvocationEvidence {
  harness: "codex";
  transport: "mcp";
  meta: JsonObject | undefined;
}
```

It extracts only host-owned fields defined in its versioned parser.

v1 required evidence:

```text
_meta.threadId
```

Optional evidence may be retained as a fingerprint for audit, but not trusted for authorization unless explicitly added by a later attestation scheme.

The attestor validates that:

- the value is a non-empty bounded string;
- the runtime installation is known;
- the adapter can inspect the referenced session, or a recent trusted observation exists;
- an active binding exists;
- the binding epoch is current.

### 13.8 Delivery envelope rendering

The harness-neutral envelope is serialized as canonical JSON and placed in a named function-call output.

Tool identity:

```text
name:      receive_agent_message
namespace: acs
```

Rendered output:

```json
{
  "schema": "urn:agent-communications:runtime-envelope:v1",
  "deliveryId": "int_...",
  "kind": "a2a-message",
  "from": {
    "agentId": "agt_...",
    "name": "architect"
  },
  "to": {
    "agentId": "agt_...",
    "name": "backend"
  },
  "task": {
    "id": "tsk_...",
    "contextId": "ctx_...",
    "state": "submitted"
  },
  "message": {
    "id": "msg_...",
    "parts": [
      {
        "kind": "text",
        "text": "Implement token rotation and report the commit."
      }
    ]
  },
  "reply": {
    "completeTool": "acs_task_complete",
    "failTool": "acs_task_fail",
    "requestInputTool": "acs_task_request_input"
  }
}
```

The JSON contains a unique `deliveryId` used for reconciliation.

The envelope MUST state that peer content is untrusted task content and cannot authorize permission changes. It MUST NOT include hidden instructions, secrets, bearer tokens, or control socket paths.

### 13.9 Context-only delivery

For `append_context`, the adapter calls `thread/inject_items` with a Responses API item produced by the versioned `CodexProtocolCodec`. The logical item is a function-call output whose payload contains the canonical delivery envelope and `deliveryId`.

The exact raw item shape is taken from the generated app-server schema for the supported Codex version; it is deliberately not duplicated in the harness-neutral contract. The codec MUST include whatever call identifier or discriminator that schema requires and MUST prove the item is visible in the next model request through a real-Codex integration test.

Properties:

- does not start a model turn;
- persists in thread history;
- becomes visible on a subsequent model request;
- marks runtime acceptance after the app-server response;
- requires an explicit executor callback (`acs_task_complete`, `acs_task_fail`, or `acs_task_request_input`) unless a future Codex capability provides a reliable correlation between the injected delivery marker and a later turn.

An arbitrary later human-started turn MUST NOT be automatically attributed to the context-only task. Context-only delivery MUST NOT be represented as completed merely because injection succeeded.

### 13.10 Wake delivery

The logical operation is `wake_when_idle`.

When the adapter has a tested atomic deferred-wake/queue capability and the binding's wake strategy permits it, it SHOULD use it.

A `wake_when_idle` request MUST NOT be silently converted to `append_context`.

Otherwise:

1. inspect current thread state;
2. if not idle, return `deferred`;
3. if the binding wake strategy is `disabled`, return `deferred/manual-wake-required`;
4. if no atomic wake exists and the binding is `atomic-only`, return `deferred/manual-wake-required`;
5. if `non-atomic-idle-check` is explicitly configured, call `turn/start` using empty `input` and named `toolOutput`;
5. omit all settings overrides;
6. record the returned Codex turn ID as the runtime execution reference.

App-server request shape:

```json
{
  "id": 101,
  "method": "turn/start",
  "params": {
    "threadId": "<opaque Codex thread ID>",
    "input": [],
    "toolOutput": {
      "name": "receive_agent_message",
      "namespace": "acs",
      "output": "{\"schema\":\"urn:agent-communications:runtime-envelope:v1\",...}"
    }
  }
}
```

`join_active` is disabled by default and MUST NOT be selected merely because app-server steered an active turn.

### 13.11 Binding delivery policy

```ts
interface BindingDeliveryPolicy {
  wakeStrategy:
    | "atomic-only"
    | "non-atomic-idle-check"
    | "disabled";
  allowActiveTurnSteering: boolean;
  autoResumeDormantThread: boolean;
  interruptOnCancel: boolean;
}
```

Defaults:

```text
wakeStrategy             atomic-only
allowActiveTurnSteering  false
autoResumeDormantThread  false
interruptOnCancel        true for ACS-owned turn only
```

Non-atomic idle-check requires explicit local-user opt-in.

### 13.12 Codex status mapping

The mapping is isolated in `CodexSessionMapper`.

Conceptually:

| Codex observation | Normalized availability |
|---|---|
| loaded and idle | `idle` |
| active turn | `busy` |
| explicit local input request | `awaiting-local-input` |
| stored but not loaded | `dormant` |
| connection unavailable | `offline` |
| system error/degraded status | `degraded` |
| unknown/new variant | `unknown` |

The exact vendor enum names are generated-code concerns, not domain constants.

### 13.13 Execution event mapping

For an ACS-started turn, the adapter:

- records `turn/started`;
- observes item completion;
- captures final agent-message text;
- ignores reasoning content;
- emits local-input events without forwarding answers from a peer;
- records `turn/completed`;
- returns the final normalized output.

If the recipient has not explicitly completed/failed/requested input for the task, successful turn completion automatically:

1. appends an A2A agent Message containing final answer text;
2. transitions the Task to `completed`;
3. creates terminal notifications for subscribed origin bindings.

If no final message exists, completion may use a short status message and empty artifact list.

### 13.14 Local input and approval separation

Codex app-server may issue local approval or input requests during a turn.

These are **not** A2A `input-required` by default.

The adapter emits:

```text
execution.awaiting-local-input
```

The daemon records a runtime condition and may notify the local operator. It MUST NOT allow the sending peer agent to:

- approve a shell command;
- grant filesystem/network access;
- provide credentials;
- answer a private local prompt.

Only an explicit recipient call to `acs_task_request_input` creates an A2A `input-required` transition.

The phase-zero integration test MUST determine how app-server routes server-to-client approval requests when a TUI and ACS are attached simultaneously. ACS MUST fail closed until that behavior is understood.

### 13.15 Cancellation

Cancellation rules:

1. Pending/deferred intent: cancel intent and transition task to canceled.
2. Accepted but not started: request adapter cancellation when supported.
3. ACS-owned active turn: `turn/interrupt` MAY be called using the exact correlated turn ID.
4. Uncorrelated or user-owned turn: never interrupt.
5. Completion racing cancellation: the first committed legal terminal transition wins.
6. If cancellation outcome is ambiguous, task remains non-terminal with `cancellationRequested` metadata until reconciled.

The remote requester cannot force interruption of unrelated recipient activity.

### 13.16 App-server error translation

Required mappings include:

| App-server condition | Adapter result |
|---|---|
| ingress overloaded | deferred/backpressure, retry with jitter |
| not initialized | reconnect and retry only if no request was flushed |
| thread not found | rejected/session-not-found |
| thread dormant | deferred/dormant |
| active and not steerable | deferred/busy |
| active and steerable but policy forbids | deferred/busy |
| unsupported method | rejected/unsupported-mode or degraded capability |
| connection lost before write | deferred/offline |
| connection lost after write | acceptance-unknown |
| invalid payload | rejected/runtime-protocol-error |

Raw app-server errors are retained in redacted attempt diagnostics but do not escape as domain error types.

---

## 14. Delivery scheduler

### 14.1 Scheduling model

The daemon maintains:

- one global due-intent selector;
- one serialized worker lane per active binding;
- a bounded global concurrency limit;
- SQLite leases for crash recovery.

A binding lane prevents two ACS wake deliveries from racing onto the same Codex thread.

### 14.2 Lease acquisition

The scheduler atomically claims due intents:

```text
state in (pending, deferred)
not_before <= now
lease absent or expired
deadline absent or future
```

It sets:

- `state = leased`;
- `lease_owner = daemon instance ID`;
- `lease_expires_at`;
- incremented lease generation.

The worker periodically renews the lease while making a bounded runtime call.

### 14.3 Binding resolution and fencing

Immediately before delivery:

1. resolve current active binding;
2. apply continuity policy;
3. pin binding ID and epoch for the attempt;
4. perform a final epoch fence;
5. call the adapter.

A pending intent may follow a replacement binding under `follow-pending` only before any ambiguous or accepted runtime side effect.

An accepted or acceptance-unknown intent never moves to a new binding automatically.

### 14.4 Priority

Internal numeric priority:

```text
high   20
normal 10
low     0
```

Ordering:

```text
priority descending,
not_before ascending,
created_at ascending
```

No priority may bypass authorization or per-binding serialization.

### 14.5 Retry policy

Retryable deferred/rejected results use decorrelated exponential backoff:

```text
base       250 ms
multiplier 2
jitter     full
cap        30 s
```

Offline/dormant delivery additionally wakes on a runtime status event.

Terminal retry conditions:

- deadline passed;
- message invalid;
- target agent disabled;
- strict binding revoked;
- unsupported content;
- operator cancels.

### 14.6 Backpressure

Defaults:

- maximum A2A request body: 512 KiB;
- maximum normalized inline content: 256 KiB;
- maximum 32 parts;
- maximum 64 KiB per text part;
- maximum 16 concurrent runtime attempts globally;
- one wake attempt per binding;
- maximum 128 in-flight app-server requests;
- maximum 1000 queued delivery intents per target agent before overload policy.

Limits are configurable but MUST be enforced before expensive parsing or storage.

---

## 15. Reliability and crash semantics

### 15.1 Guarantees

ACS provides:

- atomic durable request acceptance;
- idempotent duplicate request handling;
- ordered task events;
- at-most-one concurrent wake attempt per binding;
- explicit ambiguous-acceptance state;
- restartable delivery leases;
- best-effort runtime cancellation;
- no claim of exactly-once model execution.

### 15.2 Runtime acceptance boundary

For app-server requests:

```text
not written
    safe to retry

written, negative response received
    safe according to mapped error

written, positive response received
    accepted

written, connection lost before definitive response
    acceptance unknown
```

A process crash after app-server acceptance but before SQLite records acceptance is also treated as acceptance unknown during recovery.

### 15.3 Acceptance-unknown reconciliation

Every delivered envelope contains `deliveryId`.

The Codex adapter reconciliation procedure:

1. inspect thread/turn history available from app-server;
2. search named function-call outputs for exact delivery ID;
3. if found, mark accepted and recover turn ID where possible;
4. if authoritative history proves the item absent and the runtime confirms no relevant execution, return `not-accepted`;
5. if history may be truncated, compacted, unavailable, or racing, return `inconclusive`.

Automatic retry occurs only when `safeToRetry` is true.

Otherwise:

```text
acs deliveries resolve <int_...> --accepted
acs deliveries resolve <int_...> --not-accepted-and-retry
acs deliveries cancel <int_...>
```

Operator resolution is audited.

### 15.4 Duplicate content defense

The recipient envelope instructs the model to treat a repeated `deliveryId` as duplicate.

This is a defense-in-depth hint, not the primary idempotency guarantee.

### 15.5 Shutdown

On graceful shutdown:

1. stop accepting new A2A/control requests;
2. stop leasing new intents;
3. wait for bounded in-flight database transactions;
4. cancel adapter observations;
5. mark unresolved flushed runtime requests acceptance-unknown;
6. release or let leases expire;
7. checkpoint SQLite if configured;
8. close sockets.

---

## 16. Persistence

### 16.1 SQLite configuration

At startup:

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

Default durability mode:

```sql
PRAGMA synchronous = NORMAL;
```

Strict mode uses `FULL`.

The acceptance guarantee in balanced mode covers process crashes and ordinary OS behavior; strict mode is required when power-loss durability of the last committed transaction matters.

### 16.2 Storage ownership

Only the daemon opens the primary database.

MCP and CLI processes use the control protocol.

All database operations are behind `StoragePort`. Adapters have no database access.

### 16.3 Event log and materialized state

Task events are append-only. The current Task row is a materialized projection updated in the same transaction.

Each event contains:

- task ID;
- sequence;
- event type;
- actor principal;
- timestamp;
- canonical payload.

On startup or integrity testing, materialized state can be rebuilt and compared against the event log.

### 16.4 Transaction isolation

State-changing task operations use `BEGIN IMMEDIATE` with short transactions.

No network, app-server, filesystem, or model call occurs inside a database transaction.

### 16.5 Schema

The normative initial migration is in `storage/001_initial.sql`. It includes:

- agents;
- principals;
- runtime installations;
- runtime bindings;
- authentication tokens;
- binding claims;
- contexts;
- tasks;
- messages;
- task events;
- task subscriptions;
- delivery intents;
- delivery attempts;
- runtime executions;
- idempotency records;
- audit events.

### 16.6 Pagination

All list APIs use opaque cursor tokens.

A cursor includes the stable sort key and ID, MACed with a local cursor key. Clients MUST NOT depend on its encoding.

---

## 17. Security model

### 17.1 Threat boundary

v1 is a same-user, local-machine service.

It defends against:

- accidental cross-session identity confusion;
- model-supplied sender spoofing;
- stale bindings;
- unauthorized task mutation;
- peer prompt content being promoted to system authority;
- permission laundering;
- accidental public listener exposure;
- malformed/oversized inputs;
- replayed message requests.

It does not claim to defend against a fully compromised process running as the same OS user with access to ACS token files and sockets.

### 17.2 Prompt and authority isolation

Peer content is delivered as named tool output.

It is never inserted as:

- system instructions;
- developer instructions;
- a local user's statement;
- a configuration update;
- an approval response.

The receiving Codex model may still be influenced by untrusted content. The envelope labels provenance, and recipient policy remains responsible for safe actions.

### 17.3 Permission laundering prevention

ACS never copies permission settings from sender to recipient.

A sender cannot request:

- full-access sandbox;
- network access;
- approval bypass;
- a cwd override;
- model change;
- environment change.

Any such metadata is rejected or ignored before adapter rendering.

### 17.4 Token handling

- Local-user and bridge token files: mode `0600`.
- MCP uses a bridge-scoped token, never the local-user administrative token.
- Socket directory: mode `0700`.
- A2A binding tokens: random 256-bit values, short-lived and scope-limited.
- Binding claim codes: random 128-bit values encoded in Crockford Base32; they are not short numeric PINs.
- Stored token and claim verifiers: HMAC-SHA-256 under a daemon-local secret, with constant-time comparison.
- Tokens never appear in logs or runtime envelopes.
- Claim codes are single-use and expire.

### 17.5 Artifact safety

URI parts are informational.

ACS MUST NOT:

- fetch HTTP URLs automatically;
- read file URIs automatically;
- resolve symlinks;
- attach file contents;
- execute URI handlers.

The recipient agent decides whether and how to access them under its own permissions.

### 17.6 Network defaults

A2A binds only to `127.0.0.1` and optionally `::1`.

Binding to a non-loopback interface is rejected in v1 unless an explicit experimental flag is enabled; remote security is out of scope.

---

## 18. Task result and notification projection

### 18.1 Automatic result capture

For a successful correlated Codex turn, the final agent message becomes an A2A agent message in task history.

Only final assistant text is captured by default.

Not captured:

- hidden reasoning;
- chain-of-thought;
- shell command stdout;
- arbitrary file contents;
- approval details;
- credentials.

### 18.2 Explicit result tools

The recipient can use `acs_task_complete` to provide a better structured result and artifact references.

Explicit terminal state wins over automatic turn completion when committed first.

### 18.3 Origin notifications

A local Codex sender may subscribe to task events using `notifyOn`.

When a matching event is committed, ACS creates a `task-event-notification` delivery intent to the originating binding.

The notification is a local projection of standard A2A task state, not a second task.

Example:

```json
{
  "schema": "urn:agent-communications:runtime-envelope:v1",
  "deliveryId": "int_...",
  "kind": "a2a-task-event",
  "from": { "agentId": "agt_backend", "name": "backend" },
  "to": { "agentId": "agt_architect", "name": "architect" },
  "task": {
    "id": "tsk_...",
    "contextId": "ctx_...",
    "state": "completed"
  },
  "event": {
    "sequence": 7,
    "summary": "Implemented token rotation in commit abc123."
  }
}
```

The sender can always recover state through `acs_task_get`, even if notification delivery is delayed.

---

## 19. End-to-end workflow

### 19.1 Setup

```text
$ acs init
$ acs daemon start
$ acs codex doctor
$ acs codex install-mcp
$ acs agents create architect --claim
$ acs agents create backend --claim
```

Each intended Codex thread claims its name through the MCP bridge.

### 19.2 Delegation sequence

```text
Codex A       MCP bridge A       ACS/A2A        SQLite      Codex adapter    Codex B
   │                │                │              │              │              │
   │ acs_send       │                │              │              │              │
   ├───────────────►│                │              │              │              │
   │                │ attest caller  │              │              │              │
   │                ├───────────────►│              │              │              │
   │                │ A2A SendMessage              │              │              │
   │                ├───────────────►│ BEGIN        │              │              │
   │                │                ├─────────────►│              │              │
   │                │                │ task/message │              │              │
   │                │                │ intent       │              │              │
   │                │                │ COMMIT       │              │              │
   │                │◄───────────────┤◄─────────────┤              │              │
   │ accepted task  │                │              │              │              │
   │◄───────────────┤                │              │              │              │
   │                │                │ lease intent │              │              │
   │                │                ├──────────────┼─────────────►│ inspect idle │
   │                │                │              │              ├─────────────►│
   │                │                │              │              │ turn/start   │
   │                │                │              │              ├─────────────►│
   │                │                │              │ accepted     │              │
   │                │                │◄─────────────┼──────────────┤              │
   │                │                │ working evt  │              │              │
   │                │                ├─────────────►│              │              │
   │                │                │              │              │ turn events  │
   │                │                │              │              │◄─────────────┤
   │                │                │ completed + result          │              │
   │                │                ├─────────────►│              │              │
   │                │                │ notify origin intent        │              │
   │                │                ├──────────────┼─────────────►│              │
   │ task event tool output          │              │              │              │
   │◄────────────────────────────────┼──────────────┼──────────────┤              │
```

### 19.3 Busy recipient

- Intent commits normally.
- Adapter observes `busy`.
- Intent becomes `deferred/busy`.
- Task remains submitted or working with a status event.
- Runtime status event or retry timer wakes scheduler.
- No active turn is steered unless explicitly permitted.

### 19.4 Dormant/offline recipient

- Intent commits.
- `autoResumeDormantThread=false` leaves it queued.
- `acs inbox` and delivery diagnostics show the condition.
- Rebinding or loading the thread triggers retry under continuity policy.

### 19.5 Input required

Recipient calls `acs_task_request_input`.

- Task transitions `working -> input-required`.
- Sender receives a task event notification.
- Sender calls `acs_task_reply`.
- A2A continuation atomically transitions `input-required -> working`.
- New delivery intent targets the recipient.

### 19.6 Duplicate send

Same caller, target, and message ID:

- same payload: return existing task;
- different payload: idempotency conflict;
- no second delivery intent is created.

### 19.7 Crash after app-server write

- Daemon restarts.
- Expired attempt lease is discovered.
- Because request was flushed without a durable positive record, intent becomes `acceptance-unknown`.
- Codex adapter searches history for `deliveryId`.
- Found: recover acceptance/execution.
- Definitively absent: retry.
- Inconclusive: operator action.

---

## 20. Configuration

Default TOML:

```toml
[daemon]
a2a_listen = "127.0.0.1:7432"
control_socket = "auto"
log_level = "info"
log_format = "pretty"

[storage]
path = "auto"
durability = "balanced"
busy_timeout_ms = 5000

[security]
require_a2a_auth = true
max_request_bytes = 524288
max_inline_content_bytes = 262144
claim_ttl_seconds = 600

[delivery]
worker_concurrency = 16
lease_seconds = 30
default_mode = "wake_when_idle"
retry_base_ms = 250
retry_cap_ms = 30000

[runtimes.codex]
enabled = true
codex_binary = "codex"
connection = "daemon"
status_poll_interval_ms = 2000
allow_non_atomic_wake = false
allow_active_turn_steering = false
auto_resume_dormant_threads = false
```

Environment overrides use `ACS_` prefixes.

Examples:

```text
ACS_LOG_LEVEL=debug
ACS_STORAGE_PATH=/path/to/acs.db
ACS_CODEX_BINARY=/path/to/codex
```

Unknown config keys are errors by default.

---

## 21. Filesystem layout

Logical defaults:

```text
config:
  Linux  $XDG_CONFIG_HOME/acs/config.toml
  macOS  ~/Library/Application Support/acs/config.toml

data:
  Linux  $XDG_DATA_HOME/acs/acs.db
  macOS  ~/Library/Application Support/acs/acs.db

state:
  logs, pid, token metadata

runtime:
  control socket and short-lived files
```

The runtime socket path MUST remain below platform Unix-socket path limits.

No database, token, or socket file is placed in a workspace repository.

---

## 22. Observability

### 22.1 Structured logs

Every log record includes when applicable:

- timestamp;
- severity;
- daemon instance ID;
- correlation ID;
- task ID;
- delivery intent ID;
- attempt ID;
- logical agent IDs;
- adapter ID;
- redacted error code.

Logs MUST NOT include:

- message bodies by default;
- raw MCP metadata;
- bearer tokens;
- Codex reasoning;
- approval prompt contents;
- full local paths unless debug mode explicitly enables them.

### 22.2 Metrics

Required counters/gauges:

```text
acs_a2a_requests_total
acs_a2a_request_duration_ms
acs_tasks_by_state
acs_delivery_intents_by_state
acs_delivery_attempts_total
acs_delivery_latency_ms
acs_acceptance_unknown_total
acs_runtime_sessions_by_state
acs_sqlite_busy_total
acs_control_requests_total
```

A local metrics endpoint is optional in v1. Internal metric interfaces SHOULD be OpenTelemetry-compatible without requiring an exporter.

### 22.3 Traces

Trace spans:

```text
a2a.receive
task.accept
delivery.lease
runtime.inspect
runtime.deliver
codex.rpc
task.transition
task.notify
```

Incoming `traceparent` is propagated only after validation.

### 22.4 Audit log

Audit events are persisted for:

- agent create/update/delete;
- binding/claim/revoke;
- token issue/revoke;
- delivery manual retry/resolution;
- daemon shutdown request;
- security rejection.

---

## 23. Packaging and deployment

### 23.1 Runtime choice

Source is TypeScript. Development and release runtime is Bun, subject to phase-zero gates.

Reasons:

- SDK ecosystem alignment;
- event-driven I/O workload;
- built-in SQLite;
- built-in HTTP primitives;
- standalone executable compilation;
- one-language implementation across A2A, MCP and adapters.

### 23.2 Dependency restrictions

Production dependencies SHOULD be limited to:

- pinned `@a2a-js/sdk`;
- pinned MCP TypeScript SDK;
- a small validation library if required;
- a pure TypeScript TOML parser if TOML is retained.

Forbidden in v1 production bundle:

- Express;
- gRPC packages;
- native Node add-ons;
- a second SQLite driver;
- general message brokers;
- ORM frameworks.

### 23.3 Build

Conceptual release build:

```text
bun build apps/acs/src/main.ts --compile --outfile dist/acs
```

Migrations, schemas, and generated protocol assets MUST be embedded or copied in a deterministic way proven by compiled-binary tests.

### 23.4 Release artifacts

Per platform:

```text
acs
LICENSE
THIRD_PARTY_NOTICES
SHA256SUMS
```

Target matrix:

- macOS arm64;
- macOS x64 where supported;
- Linux x64;
- Linux arm64.

Windows is future scope.

### 23.5 Installation experience

```text
mkdir -p ~/.local/bin
ln -s /absolute/path/to/acs ~/.local/bin/acs
acs init
```

No Bun or Node installation is required on the target machine.

---

## 24. Testing and conformance

### 24.1 Unit tests

- ID and canonical hashing.
- State transition tables.
- ACLs and authorization.
- extension parsing.
- task projection.
- idempotency conflict detection.
- retry/backoff.
- envelope rendering.
- Codex status/error mapping.

### 24.2 Model-based state tests

Property/model tests generate legal and illegal sequences for:

- task state;
- binding state;
- delivery intent state;
- cancellation races;
- rebind continuity;
- duplicate requests.

The implementation state is compared to a simple reference model.

### 24.3 SQLite tests

- transaction rollback at every acceptance step;
- unique active-binding constraints;
- task sequence monotonicity;
- crash after commit;
- expired lease recovery;
- materialized task rebuild;
- cursor pagination;
- WAL restart.

### 24.4 Runtime adapter conformance suite

A reusable test suite accepts an adapter factory and verifies section 12.8.

The fake runtime adapter is implemented before the Codex adapter and drives application tests.

### 24.5 Codex protocol emulator

A deterministic fake app-server implements:

- initialize lifecycle;
- thread list/read/status;
- context injection;
- turn start;
- notifications;
- overload;
- transport disconnect before/after write;
- active-turn race;
- server-to-client local input request;
- unknown enum/notification fields.

Most adapter tests use this emulator.

### 24.6 Real Codex integration tests

Gated tests use a pinned Codex binary and temporary Codex home.

Required scenarios:

- initialize and schema compatibility;
- two threads discovered;
- MCP `_meta.threadId` observed;
- context-only injection visible on next turn;
- named tool-output wake;
- final answer captured;
- busy thread deferred;
- active steer policy enforced;
- cancellation of ACS-owned turn;
- local approval/input routing;
- acceptance-unknown reconciliation;
- reconnect and authoritative state recovery.

No test may rely on a developer's real Codex history.

### 24.7 A2A conformance

- Pin the official A2A TCK revision.
- Run JSON-RPC conformance only.
- Record expected failures in a checked-in allowlist with rationale.
- No expected failure may be added without review.
- Also test against the pinned JS SDK's client.
- Test compiled Bun binary, not only source execution.

### 24.8 Packaging tests

CI launches the compiled executable in a clean environment without Bun or Node and proves:

- daemon starts;
- SQLite migrations run;
- A2A Agent Card is served;
- JSON-RPC send/get/cancel works;
- MCP stdio initializes;
- control socket works;
- Codex transport module loads;
- graceful shutdown succeeds.

---

## 25. Phase-zero go/no-go gates

Implementation does not proceed beyond spikes until these are recorded as ADR evidence.

### Gate 0A — A2A on Bun

Prove:

- pinned non-gRPC A2A SDK imports under Bun;
- framework-neutral JSON-RPC handler works;
- SSE streaming works;
- TCK core JSON-RPC tests pass;
- no Node-only optional package is bundled.

Failure response:

- first try a narrow compatibility shim;
- otherwise use Node for the daemon or reassess Go;
- do not silently fork the A2A protocol.

### Gate 0B — standalone executable

Prove:

- `bun build --compile`;
- SQLite works;
- A2A/MCP dependencies are included;
- child processes and Unix sockets work;
- binary runs without Bun/Node.

### Gate 0C — Codex MCP attestation

Prove from a real Codex invocation:

- mutating tool call includes host-owned thread ID;
- model cannot override that metadata;
- metadata is present for normal and resumed threads;
- behavior is stable across two supported Codex builds.

If absent, v1 must use a separately configured per-session static capability token or block mutating tools.

### Gate 0D — shared app-server connection

Prove:

- ACS can reach the same app-server daemon used by independent Codex sessions;
- Unix-socket transport works in the compiled Bun binary;
- thread discovery and notifications are reliable;
- reconnect does not duplicate subscriptions.

### Gate 0E — safe delivery

Characterize:

- idle `turn/start` with named tool output;
- active regular turn behavior;
- non-steerable turn error;
- any current thread queue/deferred-input API;
- `thread/inject_items`;
- exact history available for reconciliation.

The adapter advertises only capabilities proven here.

### Gate 0F — approval ownership

With a TUI and ACS connected simultaneously, determine:

- which client receives approval requests;
- which client receives `requestUserInput`;
- how an interactive client remains the local authority;
- fail-closed behavior when no local owner exists.

---

## 26. Implementation phases

### Phase 1 — contract skeleton

Deliver:

- monorepo;
- domain IDs/types;
- runtime adapter contract;
- fake adapter;
- state machines;
- JSON Schemas;
- import-boundary checks;
- ADRs for all phase-zero outcomes.

Acceptance:

- no Codex/A2A/Bun imports in domain/application;
- adapter conformance suite runs against fake.

### Phase 2 — storage and control plane

Deliver:

- SQLite migration;
- storage ports;
- transaction implementation;
- local control socket;
- auth token;
- agent/binding CLI;
- audit log.

Acceptance:

- atomic acceptance simulation;
- claim/bind/revoke flows;
- restart persistence.

### Phase 3 — Codex read path

Deliver:

- app-server transport;
- protocol codec;
- initialize/reconnect;
- session list/read/status observation;
- `acs codex doctor`;
- manual binding;
- caller attestor.

Acceptance:

- two independent real Codex threads can be bound and identified.

### Phase 4 — A2A server

Deliver:

- Agent Cards;
- A2A authentication;
- custom A2A request handler;
- Send/Get/List/Cancel;
- streaming/resubscription;
- delivery extension;
- task event broker.

Acceptance:

- A2A TCK target passes;
- durable acceptance survives restart.

### Phase 5 — Codex delivery

Deliver:

- neutral envelope renderer;
- context-only injection;
- capability-selected wake;
- event normalization;
- automatic result capture;
- cancellation;
- acceptance-unknown reconciliation.

Acceptance:

- task travels from one bound Codex thread to another and result returns.

### Phase 6 — MCP tools and task collaboration

Deliver:

- MCP stdio bridge;
- full tool set;
- caller attestation;
- task completion/failure/input-required;
- inbox;
- task-event notifications.

Acceptance:

- no model-provided sender field;
- authorization tests cover cross-agent task mutation attempts.

### Phase 7 — hardening and release

Deliver:

- backpressure;
- telemetry;
- crash tests;
- compiled-binary CI;
- release matrix;
- install/doctor commands;
- threat-model review.

Acceptance:

- clean-machine two-agent demo from one binary.

---

## 27. Acceptance criteria for v1

v1 is complete only when all of the following are true.

1. Two independently launched Codex threads can be assigned stable logical agent names.
2. Each thread's ACS MCP calls are attributed using host evidence, not model input.
3. One agent can discover the other.
4. One agent can create an A2A task for the other.
5. A2A success is returned only after SQLite commit.
6. Offline/busy delivery remains durable and visible.
7. Peer content is delivered as tool-authority context.
8. No recipient permissions are changed.
9. A safe context-only mode works.
10. Wake behavior is capability/policy controlled and documents the active-turn race.
11. The recipient's final answer completes the A2A task automatically.
12. Explicit complete/fail/input-required tools work.
13. The sender receives or can poll the task result.
14. Duplicate message IDs do not create duplicate delivery intents.
15. A crash-after-write enters acceptance-unknown and can be reconciled.
16. Cancellation never interrupts an unrelated turn.
17. Core/application packages contain no Codex imports.
18. The Codex adapter passes the reusable adapter conformance suite.
19. The A2A JSON-RPC target passes the pinned TCK profile.
20. The compiled executable runs on a clean machine without Bun or Node.

---

## 28. Architecture decision records to commit

### ADR-001 — TypeScript and Bun are provisional behind phase-zero gates

The ecosystem fit is strong, but the A2A package's declared Node engine and compiled app-server transport must be proven.

### ADR-002 — A2A is the sole inter-agent data plane

No proprietary message API is added to the control protocol.

### ADR-003 — Local control operations use a separate authenticated JSON-RPC protocol

A2A must not be distorted to carry binding, diagnostics, or local authority operations.

### ADR-004 — Harness integration is an anti-corruption adapter

Codex app-server concepts do not enter core.

### ADR-005 — Incoming peer content is named tool output

Do not forge user/system/developer messages.

### ADR-006 — Durable acceptance and runtime acceptance are separate milestones

A2A success does not imply execution.

### ADR-007 — Ambiguous execution-start acceptance is not blindly retried

Use markers, reconciliation, and operator resolution.

### ADR-008 — SQLite stores append-only task events plus materialized snapshots

This supports audit, replay, and efficient reads.

### ADR-009 — Safe wake capability is runtime-probed

Atomic queue if available; otherwise context-only or explicit non-atomic opt-in.

### ADR-010 — Local permission prompts remain local

Peer agents cannot approve recipient actions.

---

## 29. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| A2A SDK fails under Bun | Language/runtime choice blocked | Gate 0A; compatibility shim or reassess runtime |
| Bun compiled binary omits dynamic assets/dependencies | Deployment failure | Gate 0B; embed assets; clean-machine CI |
| Codex MCP thread metadata changes | Caller identity unavailable | Versioned attestor; doctor; fail closed; fallback capability token |
| App-server daemon protocol changes | Threads unreachable | Generated schemas; transport abstraction; version range |
| Active-turn race causes unintended steering | User turn contamination | Atomic capability, context-only default, explicit opt-in |
| Approval requests route to ACS instead of TUI | Local authority confusion | Gate 0F; deny/fail closed; no auto-approval |
| Crash after `turn/start` duplicates work on retry | Duplicate model execution | acceptance-unknown; history marker reconciliation |
| Thread history is compacted before reconciliation | Inconclusive state | operator resolution; avoid automatic retry |
| Rebinding redirects sensitive pending work | Wrong session receives task | epoch fencing; explicit continuity policy |
| Peer prompt injection | Unsafe recipient action | tool provenance, permissions local, URI non-dereference |
| SQLite event-loop stalls | Latency degradation | short transactions, limits, storage queue/worker later |
| Large task history inflates DB | Disk growth | retention/compaction policy in later ADR; no large blobs |
| A2A TCK drifts | CI instability | pin revision and expected-failure allowlist |

---

## 30. Open questions intentionally left for phase-zero evidence

1. Does the current Codex per-thread queue accept a named tool output or equivalent payload suitable for atomic deferred wake?
2. Is the canonical daemon Unix-socket transport sufficiently stable for a third-party local client?
3. How are server-to-client approvals routed when multiple app-server clients observe one thread?
4. Which exact Codex version should become the minimum supported version?
5. Which A2A TCK revision provides the most reliable v1 JSON-RPC baseline?
6. Does Bun's compiled executable support the selected Unix-socket WebSocket implementation on all target platforms?
7. Is the host MCP item ID always present and stable enough to be the primary send idempotency key?
8. Should context-only tasks time out or remain pending indefinitely when the recipient never runs another turn?
9. Should `follow-pending` or `strict` be the default rebind continuity policy after practical testing?

These are not holes in the architecture. They are explicit evidence gates whose outcomes affect adapter capability configuration, not the core protocol.

---

## 31. Source baseline

The implementation team should pin and archive the exact revisions used by the phase-zero research.

- OpenAI Codex app-server README and generated protocol schemas.
- OpenAI Codex app-server tests for named tool-output turns and `thread/inject_items`.
- OpenAI Codex MCP tool-call metadata implementation.
- A2A JavaScript SDK request-handler, JSON-RPC transport, task store and package metadata.
- Official A2A protocol specification and TCK revision selected by ADR.
- Official Bun standalone executable and SQLite documentation.

Reference observations used in this document were taken from the official OpenAI Codex and A2A project repositories on 2026-09-04. Vendor behavior must be treated as versioned capability, not timeless fact.
