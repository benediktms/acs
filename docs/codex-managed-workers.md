# Managed Codex workers

Create a persistent worker for an existing, unbound logical agent:

```sh
acs codex workers create <agent> [--account <label>] [--cwd <absolute-dir>]
```

The command creates one persistent Codex thread, records its managed binding receipt, and submits
one asynchronous readiness task and delivery. A successful response reports all three receipts as
submitted; it does not claim that the worker is ready. The readiness prompt is:

> Initialize for readiness: call acs_identity and follow the existing registration guidance if
> needed, then call acs_agents_list once to inspect the agents currently visible to you. Do not
> contact them or persist a peer snapshot. Complete this task normally.

The prompt calls `acs_identity` first and `acs_agents_list` once without contacting peers.
The binding ID is diagnostic evidence; attachment is addressed by agent:

```sh
acs codex workers attach <agent>
```

Attachment verifies the receipt's configured installation and socket, then starts native Codex on
that exact thread. Native detach and interrupt controls remain operator-certification work.
ACS does not unsubscribe, interrupt, or change binding ownership when the child exits.

Managed workers remain owned while no interactive client is present. They may resume only for a
fenced delivery on their recorded installation. Approval, authentication, and user-input requests
remain native-Codex operator work: ACS observes them and never responds or bypasses them.

A flushed `thread/start` with no response is reported as `RUNTIME_AMBIGUOUS`; do not retry,
adopt, or delete the possible thread blindly. Managed receipts are retained when an installation is
unreachable. Interactive presence reported as `unknown` retains the existing attached-session
behavior.

The pinned native evidence is deliberately narrow. A crash before readiness completion may leave the
receipt with terminal `session-not-found`; ACS does not retry, recreate, adopt, or delete it. After
the readiness completion seeds the rollout, a graceful restart on the same home and socket lets one
managed attempt resume that exact session and complete one second delivery without duplication. An
attached control does not resume. Do not generalize this evidence to other Codex versions or restart
topologies. Lost-create reconciliation, approval restoration, and multiple-client/TUI behavior remain
unsupported pending task 7.2.
