# ACS Codex Technical Specification Bundle

This bundle contains the proposed implementation specification and companion contracts for a Codex-only Agent Communications Service.

## Contents

- `SPEC.md` — full normative architecture and implementation specification.
- `A2A-PROFILE.md` — precise ACS profile of A2A v1 JSON-RPC behavior.
- `STATE-MACHINES.md` — normative task, binding, delivery and execution transitions.
- `contracts/runtime-adapter.ts` — harness-neutral runtime adapter API v1.
- `contracts/a2a-application-port.ts` — A2A-to-application anti-corruption contract.
- `contracts/codex-app-server-boundary.ts` — Codex transport/codec boundary.
- `contracts/control-protocol.ts` — typed local control JSON-RPC method map.
- `contracts/mcp-tools.ts` — model-visible Codex MCP tool schemas.
- `contracts/delivery-envelope.schema.json` — runtime delivery envelope schema.
- `contracts/delivery-extension.schema.json` — A2A delivery metadata extension.
- `storage/001_initial.sql` — proposed SQLite schema.
- `CONFORMANCE.md` — reusable runtime adapter conformance profile.
- `diagrams/architecture.mmd` — Mermaid component diagram.
- `diagrams/delegation-sequence.mmd` — Mermaid end-to-end sequence.
- `examples/` — illustrative wire examples.

## Status

This is a proposed specification, not an implementation.

The phase-zero gates in `SPEC.md` are mandatory. In particular, Bun compatibility with the pinned A2A SDK, compiled-binary packaging, Codex MCP caller metadata, shared app-server access, safe wake behavior, and approval routing must be proven before the architecture is considered locked.

## Normative precedence

1. `SPEC.md`;
2. files under `contracts/`;
3. `storage/001_initial.sql`;
4. `CONFORMANCE.md`;
5. examples and diagrams.

The official pinned A2A v1 schema remains normative for exact A2A wire types. ACS does not fork or restate the entire A2A protocol.
