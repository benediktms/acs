## Design

Configured account labels are durable runtime identities. Each account has a canonical `CODEX_HOME` and a deterministic short socket under the per-user temporary directory. ACS never scans account directories.

On macOS, `acs init` installs one `local.acs.codex-app-server.<label>` LaunchAgent that directly runs `codex app-server --listen unix://<socket>`. The ACS daemon remains a separate single LaunchAgent. Existing healthy account services are left running; restart and adoption are explicit commands.

The daemon creates one adapter context per configured installation. A small installation router selects the adapter for control-plane session operations and the scheduler selects it from each pinned binding. MCP resolves the caller installation from the process `CODEX_HOME`; model-provided routing remains ignored.

`acs init` installs an executable named `swarm` without modifying shell startup files or shadowing `codex`. The launcher accepts only interactive new, resume, and fork sessions, resolves the selected account through the existing `CODEX_HOME` configuration and deterministic socket, and execs the configured Codex binary with `--remote unix://<socket>`. It supplies the current directory when the caller does not provide one and fails closed when the account or listener is unavailable. Non-interactive and administrative commands remain available only through native `codex`, so no standalone bypass flag or broad Codex command classifier is needed.

Initialization removes the legacy sourced zsh integration before installing `swarm`. Re-running initialization updates the launcher idempotently; disabling all Codex accounts removes it. Rollback restores the prior release and reruns `acs init`.
