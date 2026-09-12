## MODIFIED Requirements

### Requirement: Authenticated principals define requester identity

ACS SHALL derive requester identity from the bearer token's persisted principal. Binding SHALL create a `bound-agent` principal, token creation SHALL create only `external-a2a-client` or `service` principals, and the A2A data plane SHALL reject `local-user` principals. A2A message role SHALL describe protocol content and SHALL NOT select requester identity or work authority. The authenticated local managed-create control operation MAY durably accept exactly one readiness task from the local-user principal when it is bound to the newly created managed binding ID and epoch and carries the managed-worker-readiness purpose; this exception SHALL grant no general local-user A2A or delivery authority.

#### Scenario: Bound Codex agent sends through MCP

- **WHEN** `acs_send` receives host-attested thread metadata for an active binding
- **THEN** ACS issues a short-lived A2A token for that binding's `bound-agent` principal
- **AND** the accepted task persists that principal and its agent as the requester

#### Scenario: Administrative token reaches A2A

- **WHEN** a `local-user` principal presents its token to the A2A data plane
- **THEN** ACS rejects it regardless of the message role

#### Scenario: Managed creation accepts one local readiness task

- **WHEN** the authenticated local managed-create control operation accepts a readiness task from the local-user principal for the newly created managed binding
- **THEN** ACS durably accepts exactly one task bound to that binding's ID and epoch and carrying the managed-worker-readiness purpose
- **AND** the acceptance grants no general local-user A2A or delivery authority
