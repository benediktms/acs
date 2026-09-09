## Design

Configured account labels are durable runtime identities. Each account has a canonical `CODEX_HOME` and a deterministic short socket under the per-user temporary directory. ACS never scans account directories.

On macOS, `acs init` installs one `local.acs.codex-app-server.<label>` LaunchAgent that directly runs `codex app-server --listen unix://<socket>`. The ACS daemon remains a separate single LaunchAgent. Existing healthy account services are left running; restart and adoption are explicit commands.

The daemon creates one adapter context per configured installation. A small installation router selects the adapter for control-plane session operations and the scheduler selects it from each pinned binding. MCP resolves the caller installation from the process `CODEX_HOME`; model-provided routing remains ignored.

ACS does not install an interactive launcher or shell alias. Managed launching is a CLI concern outside this change; operators may define their own shell alias without making ACS responsible for shell startup files. Native `codex` remains untouched.

Initialization removes the legacy sourced zsh integration and any ACS-owned `swarm` executable left by an intermediate release. Rollback restores the prior release and reruns `acs init`.
