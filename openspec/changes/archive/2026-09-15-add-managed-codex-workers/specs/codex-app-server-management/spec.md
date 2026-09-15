## ADDED Requirements

### Requirement: Managed workers remain installation-scoped

ACS SHALL create, resume, deliver to, and attach to a managed Codex worker only through the explicitly configured account installation recorded in its binding receipt and that installation's exact derived owner-only Unix socket. A thread identifier alone SHALL NOT authorize routing. ACS MUST NOT resume a managed worker on another configured installation, infer ownership from a reachable socket or discovered thread, or silently migrate it when configuration changes.

#### Scenario: Worker is created for a configured account

- **WHEN** a local operator creates a managed worker with an explicit or existing default account selection
- **THEN** ACS starts the persistent thread on that account's managed app-server and records that exact installation in the binding receipt

#### Scenario: Worker creation preserves account policy

- **WHEN** ACS requests persistent managed-thread creation
- **THEN** it supplies the validated working directory and persistent-thread setting without overriding approval or sandbox policy

#### Scenario: Recorded account is available

- **WHEN** ACS resumes, delivers to, or attaches to a managed worker
- **THEN** it uses only the account home and derived socket matching the recorded installation

#### Scenario: Another account is available

- **WHEN** the recorded installation is unavailable but a different configured Codex account is ready
- **THEN** ACS leaves the worker unavailable on its recorded route and does not resume or attach it through the other account

#### Scenario: Installation configuration drifted

- **WHEN** the current configured account home or derived socket no longer matches the daemon's recorded installation identity
- **THEN** ACS fails closed before worker resume or native attachment and reports the route mismatch

### Requirement: Managed worker lifecycle uses the pinned native boundary

ACS SHALL use the pinned supported Codex app-server's persistent thread creation and same-installation resume operations for managed workers, while leaving interactive subscription and shutdown signaling to the native Codex TUI. ACS SHALL NOT add a production terminal proxy, protocol proxy, custom TUI, custom app-server client, or generated-protocol modification for this lifecycle.

#### Scenario: Persistent worker thread is created

- **WHEN** the compatible recorded app-server accepts managed creation
- **THEN** ACS records the returned opaque thread identifier without starting a turn or taking an interactive subscription

#### Scenario: Native TUI attaches

- **WHEN** an operator attaches to a managed worker
- **THEN** the native client owns its interactive subscription and native shutdown behavior while ACS remains a non-interactive observer

#### Scenario: Runtime version is incompatible

- **WHEN** the configured app-server does not match the supported Codex compatibility policy
- **THEN** ACS rejects managed creation, recovery, or attachment rather than claiming lifecycle support
