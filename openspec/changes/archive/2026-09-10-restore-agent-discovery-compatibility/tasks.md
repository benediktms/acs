## 1. Restore Compatible Discovery

- [x] 1.1 Include `unknown` in the Codex MCP agent-list state filter and add a focused bridge regression proving an enabled unknown agent remains visible while offline stays excluded; verify with `bun test tests/mcp.test.ts`
- [x] 1.2 Update operator documentation to distinguish discoverable `unknown` agents from confirmed availability and verify the wording does not claim released Codex presence support

## 2. Validate

- [x] 2.1 Run `mise run specs:check` and the affected MCP test file, leaving full-suite validation to CI
