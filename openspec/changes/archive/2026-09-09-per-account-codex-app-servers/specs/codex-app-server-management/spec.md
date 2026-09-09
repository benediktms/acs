## ADDED Requirements

### Requirement: Explicit account configuration

ACS SHALL use only explicitly configured Codex account homes. Each enabled account SHALL have a unique label and canonical home path, and ACS SHALL derive a non-configurable owner-only Unix socket from that home.

#### Scenario: Duplicate account identity

- **WHEN** two configured accounts use the same label or canonical home
- **THEN** configuration loading fails before ACS starts
