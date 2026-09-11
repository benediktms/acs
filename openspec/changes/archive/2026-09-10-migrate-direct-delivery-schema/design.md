## Context

See `proposal.md` for motivation. `Store` currently executes the current `001_initial.sql` only for a new database. Existing databases record migration version 1 but receive no later schema changes. The direct-delivery implementation changed the initial `delivery_intents.mode` constraint in place, so databases created by earlier builds reject current writes.

The A2A boundary intentionally sanitizes unexpected errors, but it currently discards the original error before the daemon logger can associate it with the public correlation identifier.

## Goals / Non-Goals

**Goals:**

- Upgrade known version-1 databases without discarding durable state.
- Make migration application atomic and idempotent.
- Correlate sanitized A2A errors with useful daemon diagnostics.

**Non-Goals:**

- Preserve the behavior of obsolete delivery modes.
- Support arbitrary or unversioned third-party schemas.
- Expose SQLite details through A2A responses.

## Decisions

- Add ordered migrations for the legacy delivery constraint and runtime-execution relationship, and run every unapplied migration at store startup. This reuses the existing `schema_migrations` authority instead of adding a second version mechanism.
- Rebuild `delivery_intents` transactionally because SQLite cannot alter a `CHECK` constraint in place. Copy every row and normalize legacy mode values to `direct`, then recreate its indexes. Foreign-key validation runs before startup continues.
- Keep `001_initial.sql` as the current fresh-install schema. Applying the delivery rebuild to that schema is safe; the relationship migration records itself without altering a fresh schema where the column already exists. Rewriting the historical initial migration would not repair databases that already recorded version 1.
- Generate one correlation identifier when mapping an unexpected application error, pass the original error and identifier to an injected reporter, and return only the existing sanitized error publicly. The daemon supplies its structured logger; protocol tests can supply a recording callback.

## Risks / Trade-offs

- Rebuilding `delivery_intents` briefly requires additional disk space proportional to that table -> run before network listeners start and keep the rebuild in one transaction.
- Normalizing legacy modes removes their prior scheduling preference -> those modes are no longer supported, and preserving queued work as ordinary direct delivery is safer than deleting it.
- A malformed legacy database can prevent startup -> roll back the migration and report the underlying startup error instead of serving against an incompatible schema.

## Migration Plan

1. On store startup, inspect `schema_migrations` and apply missing ordered migrations.
2. Rebuild and validate `delivery_intents`, add the missing runtime-execution relationship where required, and record each version atomically.
3. Start the daemon listeners only after migration succeeds.
4. Rollback is restoring the pre-upgrade database backup; the current binary does not write legacy delivery modes.
