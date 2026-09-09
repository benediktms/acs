## MODIFIED Requirements

### Requirement: Persistent macOS service

On macOS, `acs init` SHALL install a login service named `local.acs.daemon`, log
to `~/Library/Logs/acs.log`, register the Codex MCP bridge using the same runtime
paths, and install one `local.acs.codex-app-server.<label>` LaunchAgent for every
configured Codex account. Each app-server service SHALL run with `CODEX_HOME` set
to its configured canonical home, `Umask` 077, `KeepAlive`, `RunAtLoad`, and a
4096 soft file-descriptor limit. Persisted path overrides SHALL be absolute.
`--no-service` SHALL initialize files without installing the service or MCP
registration. Initialization SHALL not restart a healthy unchanged app-server.
The LaunchAgent's `ProgramArguments` SHALL invoke `acs daemon run`; that command
is the foreground daemon. `acs daemon start` SHALL bootstrap an installed,
unloaded LaunchAgent and wait for authenticated control readiness without restarting
an already loaded healthy service. `acs daemon stop` SHALL boot out the
supervisor before a bounded shutdown wait, using authenticated shutdown only for
an unmanaged foreground daemon. Start and stop SHALL be idempotent, and restart
SHALL stop then start. These lifecycle commands SHALL NOT mutate per-account
Codex app-server services.

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

#### Scenario: Service status

- **WHEN** an operator runs `acs daemon status`
- **THEN** it performs no lifecycle mutation and prints `control-ready` with exit 0
  when authenticated control is ready, including an unmanaged foreground daemon
- **AND** it prints `stopped` with exit 1 when neither control nor supervisor is running
- **AND** it prints `supervisor-running/control-unavailable` with exit 2 when the
  LaunchAgent is running but authenticated control is unavailable

#### Scenario: Non-macOS lifecycle operations

- **WHEN** an operator runs a daemon lifecycle command other than `run` outside macOS
- **THEN** ACS directs the operator to run `acs daemon run` under their service manager
