# Research Notes and Evidence Trail

**Captured:** 2026-09-04

This file records the source-level observations behind the design. It is not a substitute for phase-zero tests. Moving vendor branches must be pinned before implementation.

## A2A JavaScript SDK

### Framework-neutral JSON-RPC layer

The SDK exposes a `JsonRpcTransportHandler` that accepts a request-handler implementation rather than requiring Express. It dispatches the A2A v1 operations for sending messages, streaming, task retrieval/listing/cancellation, task subscription, push configuration, and extended Agent Cards.

**Design consequence:** ACS can use Bun's Web-standard HTTP server and avoid Express and gRPC.

### Request-handler seam

The SDK exposes an `A2ARequestHandler` interface. ACS can implement this directly instead of forcing its durable task/event system through the SDK's in-memory examples.

**Design consequence:** official wire encoding remains upstream; durable semantics remain owned by ACS.

### TaskStore and execution abstractions

The SDK's task-store interface is intentionally pluggable and notes that implementations must scope reads appropriately. The default in-memory implementation is unsuitable for ACS durability.

**Design consequence:** SQLite is the authoritative task store and authorization is checked before every read/list.

### Runtime declaration

The examined package metadata declares Node 20 or newer. The non-gRPC code is designed around portable Web APIs, but that does not constitute a release guarantee for Bun.

**Design consequence:** Bun compatibility and compiled-binary execution are mandatory go/no-go tests.

## OpenAI Codex app-server

### Protocol and transports

The app-server README describes a bidirectional JSON-RPC-like protocol that omits the `jsonrpc` wire member. The stable stdio transport is JSON Lines. A local daemon and Unix-socket/WebSocket transport are available but currently experimental.

**Design consequence:** Codex transport is a replaceable adapter sub-layer. ACS must not build its core around daemon-specific behavior.

### Initialization

A client must send `initialize`, receive a response, and then send `initialized`.

**Design consequence:** app-server connection state is explicit and no runtime operation is issued before initialization completes.

### Generated protocol definitions

Codex can generate TypeScript and JSON Schema definitions for the installed app-server protocol.

**Design consequence:** the Codex adapter vendors generated types for a pinned tested version and contains all schema translation.

### Named standalone tool output

`turn/start` accepts an optional `toolOutput` object with a name, namespace, and output body. Current app-server tests exercise a turn started with empty user input and standalone tool output.

**Design consequence:** peer messages are delivered with tool authority, not forged as local user messages.

### History-only injection

Current app-server tests exercise `thread/inject_items` and demonstrate that an injected function-call output is persisted and visible on the next model request without causing an immediate model request.

**Design consequence:** ACS has a non-waking context-only delivery mode.

### MCP caller thread metadata

Current Codex MCP code adds a host-owned `threadId` to `tools/call` metadata.

**Design consequence:** mutating ACS MCP tools can attest the calling Codex thread without trusting a model argument. Because this is not a standard MCP identity contract, it remains isolated in a versioned Codex caller-attestor.

### Backpressure

The app-server documents bounded queues and a retryable overload error.

**Design consequence:** overload maps to a deferred delivery with bounded exponential backoff and jitter.

## Items that remain empirical

The following must be tested against the pinned Codex build:

1. Whether an independent interactive Codex client and ACS can reliably share the same app-server daemon.
2. Whether the current per-thread queue can carry the required named tool-output payload and provides atomic deferred wake.
3. Which app-server client receives approval and user-input requests when multiple clients observe one thread.
4. How much thread history remains available after compaction for delivery-marker reconciliation.
5. Whether MCP item IDs are stable enough to be primary outbound idempotency keys.
6. Whether Bun's compiled binary supports the selected Unix-socket WebSocket transport on every release target.
