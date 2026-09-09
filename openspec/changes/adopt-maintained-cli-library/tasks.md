## 1. Selection and dependency

- [x] 1.1 Re-run the maintained-library probes with the pinned Bun compiler, record the candidates, behavior, maintenance, dependency, and compiled-size results in `docs/cli-library-spike.md`, and verify every claim against the probe output and package metadata
- [x] 1.2 Pin Commander 15.0.0 in `package.json` and `bun.lock`, add it to `THIRD_PARTY_NOTICES`, and verify `bun install --frozen-lockfile` succeeds

## 2. Command migration

- [x] 2.1 Define every existing root, group, and leaf command directly with Commander in `apps/acs/src/main.ts`, preserving per-account app-server initialization, command arguments, options, JSON output, and exit behavior; verify type checking succeeds
- [x] 2.2 Move configuration, runtime, and control-client initialization into the actions that need them, remove superseded hand-written argument helpers and dispatch branches, and verify help and parse failures do not create ACS state
- [x] 2.3 Make `acs codex run --` own managed-socket selection, reserved `--remote` validation, current-directory propagation, and untouched Codex argument passthrough; verify a fake Codex executable receives the expected injected and caller-provided arguments
- [x] 2.4 Remove ACS-owned `swarm` generation and installation, retain marker-safe cleanup for earlier copies, and document the optional user-owned `alias swarm='acs codex run --'`; verify unrelated commands and shell startup files remain untouched

## 3. Regression coverage and validation

- [x] 3.1 Extend `tests/packaging.test.ts` to exercise compiled root, group, and leaf help through both help forms, consistent unknown/missing/invalid usage failures, state-free help, representative preserved command behavior, and direct Codex passthrough; verify `bun test tests/packaging.test.ts` passes
- [x] 3.2 Add `--no-service` to the isolated A2A TCK initialization and verify the harness cannot install or restart user LaunchAgents
- [x] 3.3 Run `mise run specs:check`, the targeted packaging and service tests, and `bun run check` using only temporary homes and binaries, resolving any migration regression before marking the change complete
