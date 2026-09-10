## Context

Released Codex 0.154.0 and current upstream main do not expose `interactiveSubscriberPresence` or `thread/presence/changed`. ACS therefore correctly derives live sessions as `unknown`, but its MCP list currently removes that state and makes every peer undiscoverable. See `proposal.md` for motivation and `specs/agent-discovery/spec.md` for the compatibility contract.

## Goals / Non-Goals

**Goals:**

- Restore peer discovery for released Codex versions while preserving explicit uncertainty.
- Keep authoritative `offline` filtering and reaping unchanged.
- Leave a focused regression at the MCP boundary where the empty result was introduced.

**Non-Goals:**

- Infer interactive presence from loaded state, activity, process lifetime, or direct-input capability.
- Implement or vendor unreleased Codex protocol extensions.
- Change delivery eligibility or offline reaping.

## Decisions

### Include `unknown` in the existing MCP state whitelist

Add `unknown` to the bridge's existing `agents.list` state filter. This is the smallest change that restores stable peer identity while preserving the uncertainty already carried by the response. Removing the filter entirely was rejected because explicitly offline agents must remain hidden. Mapping unknown observations to `ready` or `working` was rejected because the ACS observer can keep a closed thread loaded.

### Test the bridge request rather than state derivation

Exercise `acs_agents_list` with an `unknown` agent and assert that it remains in the response. State derivation already has focused coverage; the regression was the bridge's whitelist.

## Risks / Trade-offs

- [Stale agents without authoritative presence remain visible] -> Their state remains `unknown`, delivery stays fail-closed, and exact offline observations remain filtered.
- [A later presence-capable Codex release makes the fallback unnecessary] -> Keep the explicit state until real protocol conformance exists, then revise discovery policy in a separate change.

## Migration Plan

Ship the bridge filter and documentation together. Rollback is the single whitelist entry plus its regression and documentation/spec delta; no data migration or service lifecycle change is required.
