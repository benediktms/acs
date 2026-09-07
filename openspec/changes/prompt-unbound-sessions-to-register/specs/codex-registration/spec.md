## ADDED Requirements

### Requirement: Attested self-registration

ACS SHALL allow a supported, host-attested, unbound Codex session to create a new logical agent and bind itself through one MCP operation without exposing or transferring a claim code. The operation SHALL derive the runtime session exclusively from Codex-owned metadata, commit agent and binding creation atomically, and SHALL NOT replace an existing agent binding.

#### Scenario: Unbound session registers

- **WHEN** a supported unbound Codex session calls self-registration with an available valid agent slug
- **THEN** ACS atomically creates the logical agent and an active binding for the attested calling session

#### Scenario: Registered session retries

- **WHEN** an already-bound session retries self-registration
- **THEN** ACS returns its existing agent and binding without creating another agent

#### Scenario: Chosen name is already active

- **WHEN** an unbound session requests a case-insensitive agent slug that belongs to another active logical agent
- **THEN** ACS rejects registration with `AGENT_ALREADY_EXISTS` and creates no partial agent or binding

#### Scenario: Caller cannot be attested

- **WHEN** self-registration receives missing, malformed, ambiguous, or unsupported host evidence
- **THEN** ACS rejects it with `UNATTESTED_CALLER` and creates no agent or binding
