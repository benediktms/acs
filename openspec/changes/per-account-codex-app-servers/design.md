## Design

Configured account labels are durable runtime identities. Each account has a canonical `CODEX_HOME` and a deterministic short socket under the per-user temporary directory. ACS never scans account directories.

On macOS, `acs init` installs one `local.acs.codex-app-server.<label>` LaunchAgent that directly runs `codex app-server --listen unix://<socket>`. The ACS daemon remains a separate single LaunchAgent. Existing healthy account services are left running; restart and adoption are explicit commands.

The daemon creates one adapter context per configured installation. A small installation router selects the adapter for control-plane session operations and the scheduler selects it from each pinned binding. MCP resolves the caller installation from the process `CODEX_HOME`; model-provided routing remains ignored.

The zsh integration is an idempotently sourced function named `codex`. It routes only session-aware commands to the selected managed socket, calls the real executable otherwise, rejects `--remote` routing conflicts, and supports the explicit `--acs-standalone` bypass.
