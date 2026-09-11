## Context

Codex loads trusted repository hooks from `.codex/hooks.json`. A `SessionStart` command can add developer context, but it may run before MCP servers are ready. ACS currently requires operator-created logical agents and attested one-time claims even when the MCP bridge can attest the calling session directly.

## Goals / Non-Goals

**Goals:**

- Make every newly started or resumed Codex session in this repository check its ACS binding on its first model turn.
- Let an attested unbound session register without operator interaction or claim-code transfer.
- Keep the hook trial removable and directly portable to a later global hook.

**Non-Goals:**

- Make standalone sessions reachable by the shared Codex app server.
- Install or modify global hooks or MCP configuration.

## Decisions

- Use one repository `.codex/hooks.json` entry matching `startup|resume`. This is the native repo-scoped mechanism and needs no new dependency.
- Use a command hook that prints static developer context requiring `acs_identity` on the first model turn before the user request is handled. The model calls it after MCP initialization instead of relying on a `SessionStart` MCP tool call that can race server startup.
- Add `acs_register` as a single MCP operation. It accepts an optional valid agent slug, derives the caller only from Codex-owned metadata, returns the existing binding when the session is already registered, and otherwise creates the agent and binding in one storage transaction.
- Keep the database's case-insensitive active-agent slug index as the uniqueness authority. A chosen-name collision returns `AGENT_ALREADY_EXISTS`; omitting the slug uses a deterministic session-derived fallback.
- Authorize self-registration only for the local MCP bridge's attestation scope. Runtime reachability governs delivery, not caller identity; no model-supplied session or binding identifier is accepted.
- Tell an unbound agent to choose a short logical-agent slug and call `acs_register` without asking the operator for a claim code.
- Keep the hook text independent of repository paths so the same entry can later move to the global Codex hook layer.

## Risks / Trade-offs

- Project hooks require explicit trust and are skipped until reviewed -> verify the source with `/hooks` in each test session.
- The instruction runs on resume as well as startup -> `acs_identity` is read-only and already-bound sessions continue without registration work.
- Self-registration removes the operator approval boundary for creation -> require host attestation, keep rebinds out of this operation, and retain claims for operator-selected identities.
- The hook detects missing registration but cannot fix runtime reachability -> keep shared-app-server launch behavior separate.
