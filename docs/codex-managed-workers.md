# Managed Codex workers

Create a persistent worker for an existing, unbound logical agent:

```sh
acs codex workers create <agent> [--account <label>] [--cwd <absolute-dir>]
```

The command creates one persistent Codex thread and records its managed binding receipt.
The binding ID is diagnostic evidence; attachment is addressed by agent:

```sh
acs codex workers attach <agent>
```

Attachment verifies the receipt's configured installation and socket, then starts native Codex on
that exact thread. ACS prints that Ctrl+D on an empty composer, `/exit`, and `/quit` detach while
Ctrl+C interrupts active work; native interaction behavior remains operator-certification work.
ACS does not unsubscribe, interrupt, or change binding ownership when the child exits.

Managed workers remain owned while no interactive client is present. They may resume only for a
fenced delivery on their recorded installation. Approval, authentication, and user-input requests
remain native-Codex operator work: ACS observes them and never responds or bypasses them.

A flushed `thread/start` with no response is reported as `RUNTIME_AMBIGUOUS`; do not retry,
adopt, or delete the possible thread blindly. Managed receipts are retained when an installation is
unreachable. Interactive presence reported as `unknown` retains the existing attached-session
behavior. Lost-create reconciliation, approval restoration, app-server restart, and multiple native
clients remain unsupported until separately operator-certified.
