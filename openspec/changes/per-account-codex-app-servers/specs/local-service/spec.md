## MODIFIED Requirements

### Requirement: Persistent macOS service

On macOS, `acs init` SHALL install the ACS login service and one `local.acs.codex-app-server.<label>` LaunchAgent for every configured Codex account. Each app-server service SHALL run with `CODEX_HOME` set to its configured canonical home, `Umask` 077, `KeepAlive`, `RunAtLoad`, and a 4096 soft file-descriptor limit. Initialization SHALL not restart a healthy unchanged app-server.

#### Scenario: Account service installation

- **WHEN** an operator initializes ACS with two configured accounts
- **THEN** exactly two account-scoped app-server service definitions are installed
- **AND** each service listens only on its derived account socket

#### Scenario: Rename an existing service

- **WHEN** `acs init` finds the legacy `local.asc.daemon` service
- **THEN** it unloads that service and removes its legacy plist before starting the ACS service
- **AND** it aborts if unloading fails

#### Scenario: Reinstall after rebuilding or moving the checkout

- **WHEN** the operator reruns `acs init` from the rebuilt executable
- **THEN** registration uses that executable and the ACS service is restarted even if its plist contents match

#### Scenario: Existing foreground daemon

- **WHEN** initialization needs to replace an unmanaged ACS daemon
- **THEN** it requests shutdown before bootstrapping the service
