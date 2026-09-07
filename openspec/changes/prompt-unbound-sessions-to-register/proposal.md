## Why

Codex sessions opened in this repository can have the ACS MCP server available while remaining unbound, making peer messaging unavailable until an operator manually creates a logical agent and transfers a claim code. A repository-local trial should register an attested session automatically on its first model turn before ACS installs the behavior globally.

## What Changes

- Add a repository-local Codex `SessionStart` hook for startup and resume.
- Add an attested MCP operation that creates a uniquely named logical agent and binds the calling session without transferring a claim code.
- Add developer context directing the agent to check `acs_identity` on its first turn, choose a logical-agent name when unbound, and call the registration operation without prompting the operator.
- Preserve the existing one-time claim flow for operator-directed registration and explicit rebinds.
- Document that this is a local trial and that global MCP and hook installation remains future work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `codex-registration`: Allow an attested unbound Codex session to create and bind a new logical agent through one MCP operation.

## Impact

- Adds repository-local Codex hook configuration under `.codex/`.
- Extends the ACS MCP and control contracts with attested self-registration.
- Keeps claim-based operator registration and runtime delivery unchanged.
- Does not add dependencies or modify global Codex configuration.
