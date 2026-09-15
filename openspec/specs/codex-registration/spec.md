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

A successful MCP identity check SHALL NOT imply that the connected app-server hosts the caller thread or grant ACS managed ownership. ACS SHALL defer context delivery for an unloaded independently launched attached thread without resuming another copy of that session. Any managed-thread resume SHALL instead require the explicit managed binding receipt, its current epoch fence, and its recorded installation under runtime-delivery policy.

#### Scenario: Independently launched recipient

- **WHEN** an attached recipient is authenticated but is not loaded on the connected app-server
- **THEN** polling remains available and automatic context delivery stays deferred without resuming the thread

#### Scenario: Independently launched unbound recipient

- **WHEN** a supported standalone Codex session supplies host-owned MCP metadata but is not loaded on the connected app-server
- **THEN** self-registration succeeds as attached without requiring runtime reachability or creating managed ownership

#### Scenario: Managed worker is unloaded

- **WHEN** a managed worker is not loaded on its recorded app-server
- **THEN** identity or registration activity alone does not resume it, transfer it, or infer another runtime route

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

### Requirement: Binding control class records ownership provenance

Every runtime binding SHALL durably record exactly one control class, `attached` or `managed`, for the lifetime of its binding epoch. Existing bindings and every binding created by claim consumption, attested self-registration, or manual binding SHALL be `attached`. Only a confirmed ACS managed-worker creation for an existing logical agent SHALL create a `managed` binding. ACS MUST NOT infer or transfer managed ownership from process ancestry, registration, runtime presence, subscription, socket identity, or thread discovery.

#### Scenario: Existing state is upgraded

- **WHEN** ACS upgrades durable bindings created before control classes existed
- **THEN** every existing binding is preserved as `attached`

#### Scenario: Independently created session binds

- **WHEN** a session is claimed, self-registers, or is manually bound
- **THEN** ACS records an `attached` binding regardless of its runtime route or subscriber state

#### Scenario: Managed creation succeeds

- **WHEN** ACS confirms creation of a persistent worker thread and commits its binding
- **THEN** the active binding is recorded as `managed` with its binding ID, agent ID, installation ID, opaque thread ID, epoch, control class, and creation time serving as the ownership receipt

#### Scenario: Ownership classification would change

- **WHEN** an operation would change the control class of an existing binding epoch
- **THEN** ACS rejects or omits that operation rather than transferring ownership implicitly

#### Scenario: Operator detaches from a managed worker

- **WHEN** the last interactive client leaves a managed worker
- **THEN** ACS retains the `managed` binding without persisting an attached or detached lifecycle state

### Requirement: Managed creation fails closed under ambiguity

ACS SHALL create a managed binding only after a persistent runtime thread returns a valid opaque identifier. In one control transaction, creation SHALL atomically commit the ownership receipt, exactly one bounded readiness task with the exact prompt `Initialize for readiness: call acs_identity and follow the existing registration guidance if needed, then call acs_agents_list once to inspect the agents currently visible to you. Do not contact them or persist a peer snapshot. Complete this task normally.`, its delivery receipt in `submitted` state, and success audit evidence. The task SHALL call `acs_identity` first, then call `acs_agents_list` once, with no peer contact, snapshot, membership, or grant operation; it SHALL use ordinary completion, block, and failure semantics. Creation SHALL not wait for task execution or claim readiness, and SHALL preserve runtime approval and sandbox policy. A definite failure before the creation request is written SHALL create no binding. A written request without a definitive response, or a confirmed thread whose local binding transaction cannot be committed, SHALL be reported and durably audited as ambiguous with the strongest known installation and thread evidence; ACS SHALL NOT automatically retry, delete, adopt, or claim the possible thread.

#### Scenario: Creation is confirmed and committed

- **WHEN** the runtime returns a valid thread identifier and ACS commits the matching managed binding
- **THEN** ACS reports creation success with exactly one submitted readiness task/delivery receipt, without waiting for readiness or attaching an operator

#### Scenario: Creation fails before write

- **WHEN** the runtime creation request definitely fails before being written
- **THEN** ACS reports a definite failure and creates no managed binding

#### Scenario: Creation response is lost after write

- **WHEN** the runtime creation request is written but ACS receives no definitive response
- **THEN** ACS reports `RUNTIME_AMBIGUOUS`, creates no managed binding, audits the known evidence, and does not retry automatically

#### Scenario: Binding commit fails after thread creation

- **WHEN** a persistent thread is confirmed but ACS cannot commit its managed binding
- **THEN** ACS rolls back all local rows, reports `RUNTIME_AMBIGUOUS`, records the known thread and installation in audit, and does not delete, adopt, or retry the thread automatically
