## Context

`apps/acs/src/main.ts` currently discovers commands with a long conditional chain over `Bun.argv`. Configuration migration and shared runtime setup happen before most dispatch, while argument lookup helpers scan the entire array. The issue requires a maintained CLI library that works in the standalone Bun executable and does not alter the control protocol or command behavior.

The saved WIP predates the current `init` implementation and therefore cannot be applied wholesale. Its compiled probes and Commander command definitions remain useful inputs, but current per-account app-server behavior must be retained.

## Goals / Non-Goals

**Goals:**

- Keep the command tree declarative and local to the executable entry point.
- Ensure parsing, generated help, and usage validation complete before handler-specific resources load.
- Keep command handlers responsible for loading only the resources they use.
- Centralize managed Codex launch routing in one ACS command without installing another executable.
- Exercise the same behavior through the compiled executable shipped to operators.
- Keep repository validation isolated from installed ACS and live Codex services.

**Non-Goals:**

- Splitting the executable into a new CLI framework or package.
- Changing daemon, storage, control-protocol, or Codex lifecycle semantics.
- Renaming commands or redesigning machine-readable output.

## Decisions

### Use Commander directly

Select Commander 15.0.0 and instantiate its `Command` and `Option` objects directly in `main.ts`. Compiled Bun probes recorded in the saved work show that it supports three-level generated help, `-h` and `--help`, required arguments, choices, conflicts, repeat collectors, synchronous and asynchronous actions, predictable usage failures, and literal passthrough through `parseAsync`. It has no runtime dependencies and the smallest observed compiled-size cost among the candidates that met the behavioral requirements.

Yargs was rejected because the probe allowed an invalid numeric value to reach its handler as `NaN` with a successful exit and it carries more dependencies and compiled size. Citty was rejected because it lost repeated values, consumed help after `--`, and omitted ancestor context from deep help. Clipanion was rejected during maintenance pre-screening because its latest stable release was materially older and the newer line remained prerelease.

No ACS-specific parser wrapper will be introduced. Commander already owns the command model, validation, help, and usage errors.

### Load resources inside actions

Register the full command tree before calling `parseAsync`. Each action will then initialize only what its existing handler requires: control paths for status-only inspection, full configuration for local runtime operations, or a control client for RPC commands. This makes help and parse errors side-effect free without adding a second pre-parser.

### Make `acs codex run` the launch boundary

Configure only `codex run` for unknown and excess options and passthrough. The action retains the literal `--` check, validates only ACS-owned launch constraints, resolves the managed socket from the configured `CODEX_HOME`, supplies `--remote`, adds `--cd` only when the caller did not provide `-C` or `--cd`, and appends the untouched argument tail. This keeps ACS help strict elsewhere and avoids reconstructing downstream arguments from parsed values.

Move the existing launch guards from the generated shell script into this action, then remove launcher generation and installation. `acs init` deletes only marker-owned `swarm` files left by earlier releases and leaves unrelated commands untouched. Documentation may show `alias swarm='acs codex run --'` as a user-owned convenience, but ACS never writes or removes that alias.

### Isolate validation from installed services

Every compiled CLI probe and packaging test uses a temporary binary plus temporary `HOME`, `ACS_HOME`, sockets, and storage. Initialization in validation always uses `--no-service`; help and usage tests additionally assert that no state is created. The A2A TCK setup follows the same rule. No implementation check invokes the installed `acs` binary or rewrites the user's LaunchAgents.

### Rebase the saved work manually

Use the saved command definitions and spike notes as references, not as a tree-level patch. Reapply them to current `main.ts`, retaining all changes since the stash base, especially per-account app-server reconciliation during `init`.

## Risks / Trade-offs

- [Commander defaults differ from the hand-written parser for malformed input] → Lock expected messages only where they are an external contract; otherwise assert stable non-zero usage behavior and handler non-execution.
- [Lazy resource initialization can omit setup an existing command relied on] → Map every current dispatch branch to one action and retain compiled smoke coverage for representative local and RPC commands.
- [Passthrough libraries may consume downstream flags] → Keep a literal-boundary regression for direct `acs codex run` using a fake Codex executable.
- [Repository validation may restart live managed app servers] → Require temporary homes and `--no-service`, including in the A2A TCK harness.
- [A monolithic entry point remains large] → Accept it for this migration; splitting handlers is unrelated scope and can be justified separately if maintenance evidence warrants it.

## Migration Plan

Add and pin Commander, translate the existing dispatch branches in place, centralize launch behavior in `acs codex run`, remove the product-owned `swarm` launcher, isolate every validation command, extend compiled packaging tests, and update notices, operator documentation, and the spike record. Rollback is a normal source revert because persisted state and protocols do not change.
