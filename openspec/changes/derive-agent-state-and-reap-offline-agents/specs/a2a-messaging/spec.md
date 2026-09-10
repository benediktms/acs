## ADDED Requirements

### Requirement: Reaping terminates accepted work explicitly

When a target agent is logically reaped, ACS SHALL atomically transition each of its nonterminal accepted tasks to a terminal failure with stable reason `target-reaped`, append the corresponding task event, and remove any pending delivery intent. ACS MUST NOT silently delete, resend, or transfer that work to a later agent that reuses the same slug.

#### Scenario: Offline target is reaped with queued work

- **WHEN** ACS reaps an agent that owns accepted nonterminal tasks or pending deliveries
- **THEN** each task becomes terminally failed with reason `target-reaped` in the same transaction that removes its delivery intent

#### Scenario: Reaped slug is registered again

- **WHEN** a new logical agent registers a slug previously used by a reaped target
- **THEN** the new agent does not inherit, resume, or receive the reaped target's work

#### Scenario: Sender addresses a reaped target

- **WHEN** a sender addresses the identity of a reaped target
- **THEN** ACS rejects the request without accepting a task or delivery intent
