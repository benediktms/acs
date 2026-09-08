Claiming a logical agent from Codex now supports retries by the same owning session and explicit replacement of an existing binding. Claims from other sessions fail, replacement increments the binding epoch, and claim outcomes are audited without storing the raw secret in audit events.

`acs codex bind <agent>` offers a numbered session picker; `--session` remains available for automation. The MCP claim tool accepts continuity, non-atomic wake opt-in, and rebind policy while deriving session identity from host metadata.

The change includes registration documentation, control/MCP contracts, and tests for retries, expiry, competing consumers, binding conflicts, stale bindings, model-supplied identity fields, and compiled CLI/MCP behavior.

Validation: `bun run check` passed on the implementation commit: 85 tests passed, two opt-in real-Codex tests skipped. This includes typechecking, oxlint, oxfmt, import boundaries, string-enum checks, and protocol regeneration using the pinned Codex dependency. The real-Codex probes were not rerun for this change.

Related issue: https://github.com/benediktms/asc/issues/3
