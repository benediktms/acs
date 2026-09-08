## ADDED Requirements

### Requirement: Installation-scoped runtime routing

ACS SHALL route delivery, cancellation, reconciliation, and session inspection through the installation referenced by the binding. Failure of one installation SHALL not make another configured installation unavailable.

#### Scenario: One account is offline

- **WHEN** an account app-server is unavailable while another is ready
- **THEN** deliveries for the unavailable account defer according to normal policy
- **AND** deliveries for the ready account continue
