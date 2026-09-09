## Why

One ACS daemon currently assumes a single Codex app-server and therefore cannot safely deliver to independently authenticated Codex installations. Operators need explicit, account-scoped local app-servers without discovering credentials from disk.

## What Changes

- Add explicit Codex account configuration with validated labels and canonical homes.
- Install and supervise one owner-only app-server LaunchAgent per configured account.
- Register each configured runtime installation independently and route delivery, inspection, and caller attestation by installation.

## Capabilities

### New Capabilities

- `codex-app-server-management`: Explicit per-account Codex app-server configuration and supervision.

### Modified Capabilities

- `local-service`: Install and manage account-scoped app-server services alongside the ACS daemon.
- `runtime-delivery`: Route runtime activity through the binding installation and isolate account failures.
- `codex-registration`: Derive the configured Codex installation from the host-owned `CODEX_HOME`.

## Impact

Changes configuration parsing, the macOS service installer, CLI startup, Codex runtime registration, the scheduler/control bridge, MCP startup, tests, and operator specifications. Removes ACS-owned zsh masking of the native `codex` executable without installing another shell command.
