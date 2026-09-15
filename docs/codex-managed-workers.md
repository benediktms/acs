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
topologies. Lost-create reconciliation and approval/user-input reattachment remain unsupported. The
isolated runtime-evidence matrix below records its tested boundary. Unsupported rows are deliberately
not product claims.

## Operator certification matrix

Recorded 2026-09-15 against `codex-cli 0.154.0` at
`/Users/benedikt.schnatterbeck/.local/bin/codex`. The native proof uses a temporary `CODEX_HOME`,
temporary ACS home, temporary Unix app-server/control sockets, a local credential-free mock model,
one ACS observer, and no LaunchAgent, existing ACS service, user session, or account configuration.

| Action                               | Exact action and observed RPCs                                                                                                                                                                                                                             | Terminal status                                                                                                                 | Completion count                                 | Result                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Managed readiness                    | `ACS_REAL_CODEX=1 mise exec -- bun test tests/real-codex.test.ts`; `runtimes.sessions.createManaged`, `system.initialize`, `runtimes.list`, `bridge.identity`, `agents.list`, `bridge.attestCaller`, `executor.task.acknowledge`, `executor.task.complete` | No native TUI attached; model turn completed                                                                                    | 1 readiness execution                            | Certified for this topology                                                                                               |
| Restart/reconnect                    | Gracefully stop and restart the temporary same-home/socket app-server; observer sees `thread/resume` once for the managed delivery, while attached control makes no resume/input call                                                                      | No native TUI attached; follow-up model turn completed                                                                          | 1 follow-up execution; 2 total                   | Certified for this topology                                                                                               |
| Ctrl+D                               | Native TUI `thread/resume` followed by `thread/unsubscribe`; no `turn/interrupt`                                                                                                                                                                           | Native client exited after empty-composer Ctrl+D; observer remained connected and thread stayed idle                            | 1 completed seed turn; no additional turn        | Certified for this topology                                                                                               |
| `/exit`                              | 2 native TUI `thread/resume` then `thread/unsubscribe` cycles; no `turn/interrupt`                                                                                                                                                                         | Both native clients exited; observer remained connected and thread stayed idle                                                  | 1 completed seed turn; no additional turn        | Certified for this topology                                                                                               |
| `/quit`                              | Native TUI `thread/resume` followed by `thread/unsubscribe`; no `turn/interrupt`                                                                                                                                                                           | Native client exited; observer remained connected and thread stayed idle                                                        | 1 completed seed turn; no additional turn        | Certified for this topology                                                                                               |
| Ctrl+C during work                   | Native TUI `turn/start` then `turn/interrupt`; held mock request observed abort; no operator detach command                                                                                                                                                | Observer reported the original active turn `interrupted`; native client remained attached                                       | 1 completed seed turn; 1 interrupted active turn | Certified for this topology                                                                                               |
| Terminal transport close             | Native TUI reached `thread/resume`; no subsequent `thread/unsubscribe` or `turn/interrupt` before the client process exited                                                                                                                                | Reported terminal close; client later absent while observer and app-server remained alive and thread stayed idle                | 1 completed seed turn; no additional turn        | Certified only for this topology                                                                                          |
| Approval/user-input reattachment     | The isolated mock cannot issue or trace genuine app-server `item/tool/requestUserInput` or `*/requestApproval` frames                                                                                                                                      | Unproven                                                                                                                        | Unproven                                         | Unsupported; worker stays visibly blocked                                                                                 |
| Two native clients plus ACS observer | 2 native `initialize`/`thread/resume` clients and one observer on one thread; one client unsubscribed, then the remaining client received one shared-thread response before temporary-backend teardown                                                     | Observer recorded 3 completed shared-thread turns (seed plus one turn before and one after detach); no duplicate root execution | 3 completed shared-thread turns                  | Certified only for concurrent update fanout and one-client detachment before teardown; prompt routing remains unsupported |
