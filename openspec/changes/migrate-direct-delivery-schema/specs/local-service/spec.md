## ADDED Requirements

### Requirement: Compatible persisted-state upgrades

ACS SHALL upgrade a supported older database schema before accepting requests, preserve its durable agents, bindings, tasks, messages, events, and delivery records, and record each schema migration exactly once.

#### Scenario: Legacy delivery schema starts on a current binary

- **WHEN** ACS starts with a database whose delivery intents use the supported legacy delivery-mode constraint
- **THEN** ACS upgrades those intents to the direct-delivery schema without deleting durable state
- **AND** authenticated message submission succeeds after startup

#### Scenario: Migration is retried

- **WHEN** ACS starts again after a schema migration was recorded successfully
- **THEN** ACS does not apply that migration again

#### Scenario: Migration fails

- **WHEN** a required schema migration cannot complete atomically
- **THEN** ACS fails startup without accepting requests or leaving a partially migrated schema

### Requirement: Correlated internal failure logging

ACS SHALL keep unexpected A2A application failures sanitized in public responses while recording the underlying failure in the daemon log with the same correlation identifier.

#### Scenario: Unexpected message-acceptance failure

- **WHEN** message acceptance raises an unexpected internal error
- **THEN** the caller receives a retryable sanitized error with a correlation identifier
- **AND** the daemon log records that correlation identifier and the underlying error
