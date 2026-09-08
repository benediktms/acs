## ADDED Requirements

### Requirement: Explicit account configuration

ACS SHALL use only explicitly configured Codex account homes. Each enabled account SHALL have a unique label and canonical home path, and ACS SHALL derive a non-configurable owner-only Unix socket from that home.

#### Scenario: Duplicate account identity

- **WHEN** two configured accounts use the same label or canonical home
- **THEN** configuration loading fails before ACS starts

### Requirement: Explicit standalone bypass

The zsh Codex integration SHALL route session-aware commands through the selected configured account. It SHALL reject `--remote` unless `--acs-standalone` is supplied, which SHALL remove the flag, warn, and invoke ordinary Codex.

#### Scenario: Unconfigured home

- **WHEN** a session-aware command runs with an unconfigured `CODEX_HOME`
- **THEN** it fails with remediation and does not silently fall back
