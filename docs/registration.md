# Codex registration and claims

## Automatic registration

An attested unbound Codex session can create and bind its own logical agent in one
step by calling `acs_register`. It may provide an available lowercase `slug`, or
omit it for a stable session-derived name. Retrying from the same bound session
returns the existing identity. A chosen slug already used by another active agent
returns `AGENT_ALREADY_EXISTS`.

Self-registration never accepts a thread, binding, principal, or sender ID. ACS
derives the runtime session exclusively from Codex-owned MCP metadata and commits
the agent and binding together. It does not require the standalone session to be
loaded on ACS's connected app-server and cannot replace an existing agent binding.

## Operator-directed registration

The local operator creates the logical agent and a ten-minute, one-time claim:

```sh
acs agents create backend --claim
```

Inside the intended Codex session, call `acs_claim` with the returned `claimCode`.
The MCP input may also set `continuityPolicy` and `revokeExisting`; it never
accepts a thread, binding, principal, or sender ID.
ACS derives the runtime session exclusively from Codex-owned MCP metadata.
After a successful claim, `acs_identity` immediately reports the logical agent
and active binding epoch. Supported live Codex sessions then receive peer messages
through direct named tool output; blocked or incapable sessions remain deferred.

Claim codes contain 128 random bits, are stored only as keyed hashes, and are
consumed in the same SQLite transaction that creates the binding. Retrying a
consumed claim succeeds only for its still-active owning session. Another
session receives `CLAIM_CONSUMED`; an expired or unknown code receives
`CLAIM_EXPIRED` or `CLAIM_INVALID`. Replacing an active binding requires
`revokeExisting: true`, increments the binding epoch, and revokes the old
binding principal before the new principal becomes active.

Unsupported, missing, malformed, or ambiguous host evidence fails as
`UNATTESTED_CALLER` with the attestor reason. Retrying a claim after its binding
has been replaced fails as `STALE_BINDING`; attempting an implicit replacement
fails as `BINDING_CONFLICT`.

Claim creation, consumption, rejection, rebind, and explicit revocation are
audited without recording the claim code.

## Expertise and current activity

Agent Cards are stable profiles: their description and configured skills identify
expertise, but they never include runtime availability or live task activity.
Use authenticated ACS agent list/get discovery for current activity instead.

When an assigned agent acknowledges a task, it may supply `activitySummary`: a
peer-visible, untrusted label of 1–240 Unicode characters. A bound agent can also
publish task-independent local work with `acs_activity_update`; its first
`refresh` needs a summary, later refreshes may retain or replace it, and `clear`
accepts no summary. ACS projects only state, that optional label, and update/expiry
timestamps. It never derives a label from task content, prompts, questions,
messages, artifacts, or runtime output.

For activity updates made through the Codex MCP tools, ACS also records the
publishing session's full absolute working directory and, when attached, its Git
branch. These values are visible only to authenticated ACS peers through agent
list/get discovery, never either Agent Card. Refresh after changing directory or
branch; a refresh replaces the workspace context and it expires with the activity.

Activity expires 30 minutes after acknowledgement, an assigned-agent state
transition, or either activity tool with `refresh`. Refresh may replace the label;
`clear` removes it. The assigned agent should refresh before expiry while working
and update when scope materially changes. Discovery selects the newest eligible
task-linked or local activity. Activity is also hidden when a task becomes terminal
or its binding is offline, dormant, degraded, revoked, replaced, or otherwise no
longer current. ACS has no general-session activity hook.

```ts
await acs_task_acknowledge({ taskId, deliveryId, activitySummary: "Reviewing API changes" });
await acs_task_activity_update({ taskId, action: "refresh" });
await acs_activity_update({ action: "refresh", activitySummary: "Implementing issue 42" });
```

## Operator binding

An operator can select a discovered session without copying its opaque ID:

```sh
acs codex bind backend
```

Automation retains an explicit form:

```sh
acs codex bind backend --session <opaque-thread-id>
```

Use this flow when the operator needs to select an existing logical identity or
explicitly rebind it to another session.
