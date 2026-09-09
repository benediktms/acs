## ADDED Requirements

### Requirement: Structured command-line interface

The ACS executable SHALL expose its existing command tree through consistent root, group, and command-level help. It SHALL validate commands, positional arguments, and options before loading configuration, opening storage, connecting to sockets, or performing service operations, while preserving established successful command output and exit behavior.

#### Scenario: Help at every command level

- **WHEN** an operator invokes the root command, a command group, or a leaf command with `-h` or `--help`
- **THEN** ACS prints help for that command level and exits successfully
- **AND** it creates, migrates, or modifies no ACS state

#### Scenario: Explicit help command

- **WHEN** an operator invokes `acs help` followed by a valid command path
- **THEN** ACS prints help for that command path and exits successfully
- **AND** it creates, migrates, or modifies no ACS state

#### Scenario: Invalid command input

- **WHEN** an operator supplies an unknown command, a missing required argument, or an invalid option
- **THEN** ACS prints a consistent usage error for the relevant command and exits non-zero
- **AND** it does not execute the requested command handler

#### Scenario: Codex argument passthrough

- **WHEN** an operator invokes `acs codex run --` followed by arguments including `--help`
- **THEN** ACS preserves the order and values of every argument after the literal `--` boundary when launching Codex
- **AND** ACS does not consume the passed `--help` as its own help option

#### Scenario: Managed Codex route

- **WHEN** `acs codex run --` launches Codex for a configured `CODEX_HOME`
- **THEN** ACS connects Codex to that account's managed app-server socket
- **AND** ACS supplies the current directory unless the operator passed `-C` or `--cd`
- **AND** ACS rejects an operator-supplied `--remote` option because ACS owns the managed route

#### Scenario: Obsolete launcher cleanup

- **WHEN** `acs init` finds an ACS-owned `swarm` executable from an earlier release
- **THEN** ACS removes that executable without installing a replacement
- **AND** it removes the legacy ACS zsh integration while preserving unrelated shell startup content
- **AND** it leaves an unrelated command at the same path unchanged
