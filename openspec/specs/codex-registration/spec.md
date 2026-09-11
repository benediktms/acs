# Codex registration

## Purpose

Define logical-agent claims, caller identity, and safe polling for Codex sessions.
See `docs/registration.md` and `contracts/mcp-tools.ts` for the detailed API.

## Requirements

### Requirement: Host-attested caller identity

The MCP bridge SHALL select the Codex installation from the host process
`CODEX_HOME` and then derive the caller session exclusively from supported
Codex-owned metadata. It SHALL reject an unconfigured home and SHALL never
accept model-supplied account routing.

#### Scenario: Unconfigured caller home

- **WHEN** the MCP bridge is invoked with a `CODEX_HOME` that is not configured
- **THEN** identity-dependent operations fail without attaching the caller to another account

#### Scenario: Missing or ambiguous metadata

- **WHEN** caller evidence is missing, malformed, ambiguous, or unsupported
- **THEN** identity-dependent operations fail with `UNATTESTED_CALLER`

### Requirement: One-time claims and explicit rebinds

ACS SHALL store claim codes only as keyed hashes and consume them atomically
with binding creation. Replacing an active binding SHALL require explicit
consent, advance its epoch, and revoke the previous binding principal.

#### Scenario: Same-session claim retry

- **WHEN** the owning session retries a consumed claim whose binding is still active
- **THEN** the existing binding is returned

#### Scenario: Another session consumes a used claim

- **WHEN** a different session submits an already-consumed claim
- **THEN** ACS rejects it with `CLAIM_CONSUMED`

### Requirement: Polling does not lose concurrent messages

ACS SHALL allow an attested recipient to list its inbox, read a task, and
acknowledge the task together with the delivery ID returned by that read.
Acknowledgment SHALL accept only deliveries observed through that read.

#### Scenario: Follow-up arrives between read and acknowledgment

- **WHEN** a new delivery arrives after the recipient reads a task
- **THEN** acknowledgment of the previously read delivery leaves the follow-up pending

### Requirement: Registration and runtime hosting are distinct

A successful MCP identity check SHALL NOT imply that the connected app-server
hosts the caller thread. ACS SHALL defer context delivery for unloaded threads
without resuming another copy of the session.

#### Scenario: Independently launched recipient

- **WHEN** the recipient is authenticated but is not loaded on the connected app-server
- **THEN** polling remains available and automatic context delivery stays deferred

#### Scenario: Independently launched unbound recipient

- **WHEN** a supported standalone Codex session supplies host-owned MCP metadata but is not loaded on the connected app-server
- **THEN** self-registration succeeds without requiring runtime reachability

### Requirement: Attested self-registration

ACS SHALL allow a supported, host-attested, unbound Codex session to create a new logical agent and bind itself through one MCP operation without exposing or transferring a claim code. The operation SHALL derive the runtime session exclusively from Codex-owned metadata, commit agent and binding creation atomically, and SHALL NOT replace an existing agent binding.

#### Scenario: Unbound session registers

- **WHEN** a supported unbound Codex session calls self-registration with an available valid agent slug
- **THEN** ACS atomically creates the logical agent and an active binding for the attested calling session

#### Scenario: Registered session retries

- **WHEN** an already-bound session retries self-registration
- **THEN** ACS returns its existing agent and binding without creating another agent

#### Scenario: Standalone session registers while runtime delivery is unavailable

- **WHEN** a supported standalone Codex session calls self-registration with host-owned MCP metadata while its thread is not loaded on the connected app-server
- **THEN** ACS creates its identity and binding while evaluating runtime reachability separately for delivery

#### Scenario: Chosen name is already active

- **WHEN** an unbound session requests a case-insensitive agent slug that belongs to another active logical agent
- **THEN** ACS rejects registration with `AGENT_ALREADY_EXISTS` and creates no partial agent or binding

#### Scenario: Caller cannot be attested

- **WHEN** self-registration receives missing, malformed, ambiguous, or unsupported host evidence
- **THEN** ACS rejects it with `UNATTESTED_CALLER` and creates no agent or binding
