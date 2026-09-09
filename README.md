# Agent Communications Service

Local-first A2A messaging for independently launched Codex threads.

```sh
mise install
mise exec -- bun install --frozen-lockfile
bun run check
bun run format
bun run build
./dist/acs init
```

On macOS, `init` installs and starts a `launchd` user service and registers the
global Codex MCP bridge with the same socket path. The service starts at login
and restarts if it exits; logs are in `~/Library/Logs/acs.log`. Re-running `init`
updates the registration and retires the legacy `local.asc.daemon` service. Restart existing Codex sessions to load the MCP tools.
Use `acs init --no-service` for file initialization only (for example in tests).
The LaunchAgent runs `acs daemon run` in the foreground. Use `acs daemon start`
to bootstrap its installed plist and wait for authenticated control readiness;
it is safe to repeat. `acs daemon stop` boots out the supervisor before waiting
for shutdown, `acs daemon restart` is stop then start, and `acs daemon status`
prints `control-ready` (exit 0), `stopped` (exit 1), or
`supervisor-running/control-unavailable` (exit 2). These lifecycle commands do
not alter per-account Codex app-server services; restart one explicitly with
`acs codex app-server restart <account-label>`. On other platforms, run
`acs daemon run` under your service manager.

`init` migrates a running foreground daemon to the login service and restarts
an existing service so rebuilt binaries take effect.

### Receiving messages in independently launched sessions

MCP registration and runtime delivery are separate connections. A successful
`acs_identity` proves identity, not that ACS's app-server hosts the live session.
Standalone sessions can register, send, and poll without being loaded on that
app-server. Launch/resume the recipient through the shared endpoint
(`codex --remote unix:// resume <session-id>`) only when automatic delivery is required.
ACS never resumes an unreachable thread on a second app-server.

Peer messages use direct native input: Codex receives empty local-user input
plus named `acs.receive_agent_message` tool output. Idle sessions start a turn;
supported active sessions accept peer input into the ongoing turn. Runtime
acceptance is not an acknowledgement that the model has processed the message.
Several peer requests may share one runtime turn, and each task must be completed
explicitly with `acs_task_complete`, failed, or put into an input-required state.
Turn completion never automatically completes an A2A task.
Subscribed task replies are durably queued and injected back into the requester's
pinned bound session through the same direct path; polling is only for inspection
or recovery. Each injected envelope begins with an explicit `AGENT MESSAGE` or
`AGENT REPLY` notice naming its peer sender.

ACS derives work authority from the authenticated requester principal. Tasks
from bound agents are delegated work that recipients may perform within their
existing sandbox, approval policy, credentials, and network permissions; they
do not need local confirmation merely because another agent requested them.
External clients and services remain untrusted work sources. No peer task can
approve a local prompt or expand the recipient's permissions. Each delegated
task must be acknowledged and then explicitly completed, failed, or placed in
input-required state using the task and delivery IDs in its envelope.

Offline, dormant, locally blocked, and unsupported sessions retain pending
messages with a diagnostic reason. `acs_inbox_list` and `acs_task_get` are useful
for inspection, not a replacement for automatic delivery. There is no history
append fallback or wake-policy flag. Canceling a task never confers ownership of
a shared turn; the shared-endpoint Codex adapter does not advertise interruption.
Urgency/preemption remains a separate OpenSpec change, not an implemented feature.

This repository currently trials automatic ACS registration through its local
Codex `SessionStart` hook. Before testing a fresh or resumed session, open
`/hooks` and trust the repository hook. On its first turn, the agent checks
`acs_identity` and, when unbound, chooses a name and calls `acs_register`.
This does not install the hook globally.

The daemon listens on `127.0.0.1:7432`. Run `acs --help` for administration,
binding, diagnostics, and MCP bridge commands.

Create and securely claim the current Codex session without copying a thread
ID:

```sh
acs agents create backend --claim
# In the intended Codex session, call acs_claim with the returned claimCode.
```

An attested unbound session can instead call `acs_register` to create and bind a
new logical identity without transferring a claim code.

For operator-driven binding, `acs codex bind backend` opens a discovered-session
picker; automation can use `acs codex bind backend --session <opaque-thread-id>`.
See [the registration contract](docs/registration.md) for retry and rebind
semantics.

`bun run check` runs TypeScript, oxlint (including `no-explicit-any` and bans on
handwritten type assertions and non-null assertions), oxfmt, package
import-boundary checks, and the test suite. Persistence uses Bun's native SQLite
driver directly; there is no ORM.

The pinned official A2A JSON-RPC profile can be run with:

```sh
A2A_TCK_DIR=/path/to/a2a-tck bun run test:a2a-tck
```

The runner verifies the exact revision in
`conformance/a2a-tck-revision.txt` and rejects any failure outside the reviewed
requirement-level allowlist.

## Development workflow

Activate mise in your shell, or prefix commands with `mise exec --`.
`mise.toml` pins Bun, Node (for OpenSpec), OpenSpec, Python, and uv (for the A2A
TCK). JavaScript dependencies, including Codex `0.153.2`, are already pinned
in `package.json` and `bun.lock`.

Behavioral and architectural requirements live in [OpenSpec specs](openspec/specs),
which are the sole normative specification source for ACS. Use the generated
Codex skills: `$openspec-propose` to propose a change, `$openspec-apply-change`
to implement it, and `$openspec-archive-change` to archive it after verification.
Validate artifacts with `mise run specs:check`. The [OpenSpec workflow documentation](https://github.com/Fission-AI/OpenSpec)
describes the workflow. README/operator docs, security documentation, typed
contracts, tests, and implementation code are supporting artifacts and must
conform to OpenSpec; do not introduce new architecture requirements outside it.
Existing local Threadmark history is retained as historical context.

For the external TCK checkout, use `uv sync --frozen --python "$(command -v python)" --directory "$A2A_TCK_DIR"`
before running the conformance command above.

## Current conformance boundary

The service includes a standalone Bun binary, native SQLite persistence,
authenticated Unix-socket control and loopback A2A endpoints, identity/claim/binding
administration, explicit task callbacks, direct delivery, and recovery controls.
The initial schema changes directly; development data from the former delivery
model should use a fresh ACS data directory. There is no legacy-data migration.

`bun run test:codex-real` runs an isolated **real Codex binary** against a local
mock Responses API. It verifies idle and active delivery, several distinct
messages sharing one turn, tool rather than local-user provenance, delayed model
input inclusion, exact persisted marker reconciliation, and rejection of
empty-input context-only steering. No credentials or billable inference are used.
The native CI matrix checks the supported `0.153.2` and `0.153.4` binaries.

`bun run test:codex-model` is a separate explicit opt-in that uses configured
Codex authentication and real inference. It has not been run as part of the
credential-free verification. Neither a mock model nor this isolated smoke test
proves the complete desktop/TUI ownership and human-approval experience.

See [the verification record](docs/direct-delivery-verification.md) for exact
scope, commands, and remaining interactive evidence. Do not infer a new delivery
capability merely from an old compatibility or phase-zero result.
