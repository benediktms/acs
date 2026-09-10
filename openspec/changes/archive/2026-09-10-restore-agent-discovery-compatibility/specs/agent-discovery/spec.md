## MODIFIED Requirements

### Requirement: Peer discovery exposes a minimal useful agent projection

Authenticated MCP agent discovery SHALL expose stable identity, description, configured skills, derived `state`, and eligible `currentActivity`. It SHALL NOT expose bindings, installations, sessions, runtime identifiers, raw runtime observations, or adapter-specific status. Administrative control surfaces MAY expose those diagnostic fields. The default peer list SHALL omit agents whose state is `offline`, but SHALL retain enabled, non-reaped agents whose state is `unknown` so released runtimes without authoritative interactive-presence support remain discoverable without being represented as available. Exact lookup MAY return an enabled, non-reaped agent in either state during the grace period. The existing coarse `availability` field and available/unavailable list filter SHALL remain removed.

#### Scenario: Peer lists useful agents

- **WHEN** an authenticated peer lists agents and authoritative interactive presence is available
- **THEN** ACS returns enabled, non-reaped agents whose derived state is not `offline`

#### Scenario: Peer lists agents without authoritative presence

- **WHEN** an authenticated peer lists agents and a bound runtime reports interactive presence as `unknown`
- **THEN** ACS includes that agent with `state: unknown` rather than returning an empty result or representing the agent as available

#### Scenario: Peer gets a known offline agent

- **WHEN** an authenticated peer gets an enabled, non-reaped agent by exact stable identifier during its offline grace period
- **THEN** ACS may return the minimal peer projection with `state: offline`

#### Scenario: Peer inspects an agent

- **WHEN** an authenticated peer lists or gets an agent
- **THEN** the result contains no binding or runtime implementation details and no legacy `availability`
