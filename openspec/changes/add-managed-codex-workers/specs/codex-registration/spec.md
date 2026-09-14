## ADDED Requirements

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

ACS SHALL create a managed binding only after a persistent runtime thread returns a valid opaque identifier and the ownership receipt commits successfully. Creation SHALL NOT start a model turn, inject a task or prompt, or override runtime approval or sandbox policy. A definite failure before the creation request is written SHALL create no binding. A written request without a definitive response, or a confirmed thread whose binding cannot be committed, SHALL be reported and durably audited as ambiguous with the strongest known installation and thread evidence; ACS SHALL NOT automatically retry, delete, adopt, or claim the possible thread.

#### Scenario: Creation is confirmed and committed

- **WHEN** the runtime returns a valid thread identifier and ACS commits the matching managed binding
- **THEN** ACS reports creation success without starting a turn or attaching an operator

#### Scenario: Creation fails before write

- **WHEN** the runtime creation request definitely fails before being written
- **THEN** ACS reports a definite failure and creates no managed binding

#### Scenario: Creation response is lost after write

- **WHEN** the runtime creation request is written but ACS receives no definitive response
- **THEN** ACS reports `RUNTIME_AMBIGUOUS`, creates no managed binding, audits the known evidence, and does not retry automatically

#### Scenario: Binding commit fails after thread creation

- **WHEN** a persistent thread is confirmed but ACS cannot commit its managed binding
- **THEN** ACS reports `RUNTIME_AMBIGUOUS`, records the known thread and installation in audit, and does not delete or adopt the thread automatically

## MODIFIED Requirements

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
