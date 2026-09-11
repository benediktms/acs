## 1. Daemon Ownership

- [x] 1.1 Add a dedicated owner-only SQLite lock under the ACS home, acquire it before `Store` or listener startup, map contention to the stable already-running error, and verify same-home concurrent starts yield one healthy winner while distinct homes run concurrently in `tests/packaging.test.ts`.
- [x] 1.2 Retain ownership through shutdown and socket cleanup, add bounded service-handover waiting, and verify loser cleanup cannot disrupt the winner and a killed daemon permits stale-socket recovery in `tests/packaging.test.ts` and `tests/service.test.ts`.

## 2. CLI Help

- [x] 2.1 Dispatch top-level and `init` help before configuration or service side effects, clarify foreground versus LaunchAgent usage, preserve the `codex run --` boundary, and verify compiled help and passthrough cases in `tests/packaging.test.ts`.

## 3. MCP Transport Lifetime

- [x] 3.1 Add a compiled-process regression that keeps an idle bridge alive while stdin is open and observes bounded exit after EOF; add the minimum explicit EOF close path only if the regression fails, and verify it in `tests/packaging.test.ts`.

## 4. Validation

- [x] 4.1 Run `bun test tests/packaging.test.ts tests/service.test.ts`, the affected static checks, and `mise run specs:check`, resolving every failure before handoff.
