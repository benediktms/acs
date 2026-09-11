## Context

The daemon currently opens `Store`, probes the control socket, binds A2A, removes the socket path, and then binds control. That probe/remove sequence is not an ownership primitive. Runtime and storage paths can also be overridden independently, so listener collisions do not enforce one daemon per ACS home. See `proposal.md` and `specs/local-service/spec.md` for the required behavior.

The CLI initializes configuration at module scope before `main()` dispatches help. The MCP bridge already uses an owned stdio transport and requires only a compiled-process lifetime regression unless that regression exposes a missing EOF close path.

## Goals / Non-Goals

**Goals:**

- Make daemon ownership atomic, crash-released, and independent of listener choices.
- Keep stale-socket cleanup inside the ownership boundary.
- Preserve the existing command surface while making the specified help paths side-effect-free.
- Prove actual MCP stdin EOF behavior without inventing another lifecycle signal.

**Non-Goals:**

- Replace the hand-written CLI; issue #52 owns that migration.
- Infer Codex thread lifecycle from inactivity or process ancestry.
- Change storage, control, A2A, or Codex protocol contracts.

## Decisions

### Use a dedicated SQLite ownership lock

Open a small lock database under the ACS home and retain a `BEGIN EXCLUSIVE` transaction for the daemon lifetime. Bun already provides SQLite, SQLite delegates contention and crash release to operating-system file locks, and a dedicated database avoids holding a transaction on ACS durable data.

The lock connection is acquired before `Store` construction or listener probing. Direct foreground startup uses a zero busy timeout and maps lock contention to the existing stable already-running error. Service handover performs a bounded lock-availability wait before replacement startup. Normal shutdown closes schedulers, listeners, and `Store`, removes the control socket while still owning the lock, then rolls back/closes the lock connection.

Alternatives rejected:

- A PID file or atomic directory needs stale-owner and PID-reuse recovery.
- The control socket cannot key ownership to ACS home when its path is overridden, and stale-socket removal recreates the current race.
- A new lock package is unnecessary when the compiled runtime already includes SQLite locking.

### Keep the immediate help dispatch explicit

Recognize top-level help and `init -h`/`init --help` before calling `configPath`, migration, `paths`, or `loadConfig`. Preserve the existing `acs codex run --` boundary so wrapped arguments are untouched. The broader conversion to generated per-command help remains issue #52.

An early successful process exit is acceptable at the executable boundary and avoids a large relocation of config-dependent command handlers solely for this safety fix.

### Test ownership through the compiled executable

Extend packaging coverage with isolated ACS homes and non-conflicting A2A ports. Synchronize concurrent starts so TCP port collision cannot mask the ownership race, then assert one winner, stable loser output, surviving control health, crash recovery, and distinct-home concurrency.

Run help cases against a fresh temporary home and assert no managed files appear. Run `acs codex run -- --help` with a fake Codex executable that records its arguments. Spawn the compiled MCP bridge with piped stdin, close the writer, and require bounded process exit; add an explicit stdin EOF close hook only if the regression fails.

## Risks / Trade-offs

- [A persistent lock database is visible in the ACS home] → Treat it as an internal runtime artifact, use owner-only permissions, and never store application data in it.
- [SQLite error text varies] → Translate only lock contention at the ownership boundary to the stable ACS error.
- [Abrupt process exit bypasses JavaScript cleanup] → The operating system releases the SQLite file lock, while the next owner performs stale-socket recovery before binding.
- [Concurrent tests can be timing-sensitive] → Coordinate readiness/barriers and use distinct A2A ports rather than relying on sleeps or port collisions.

## Migration Plan

No data migration is required. Existing installations create the lock database on first daemon startup. Rolling back leaves an inert internal lock file that older versions ignore.
