## Context

See `proposal.md` for motivation. Logical agents already store descriptions and structured skills, bindings already provide coarse availability, and A2A tasks already store target agent, lifecycle state, metadata, and update time. The existing task `summary` is not a safe discovery source because some transitions use it for full input questions. A2A Agent Cards are stable capability manifests and have no native live-activity field.

## Goals / Non-Goals

**Goals:**

- Add one safe, deterministic activity lifecycle and projection shared by control and MCP discovery.
- Reuse existing agent, binding, and task records without a cleanup scheduler.
- Prompt the assigned agent to publish and maintain a short discovery-safe work label.

**Non-Goals:**

- Advertise prompts, conversation history, artifacts, requester identity, or runtime identifiers.
- Add a general presence document, manually managed agent status, activity history, or free-standing goal publication.
- Add an A2A extension or change Agent Card versioning.

## Decisions

### Acknowledgement creates task-scoped activity

Successful acknowledgement writes an ACS-owned activity marker into the task's existing metadata. The marker records the optional summary, publication time, expiry time, binding ID, and binding epoch. A merely submitted task has no marker and is not current activity; acknowledgement is the point at which the target accepts ownership of the work.

Alternative considered: persist a separate agent-presence record with a TTL. Rejected because it duplicates task and binding state and creates another stale-state path.

### Agents update activity through one task-scoped operation

Add optional `activitySummary` to task acknowledgement and an `acs_task_activity_update` tool backed by an executor control operation. The update takes an action: `refresh` optionally replaces the summary and extends the marker, while `clear` removes the whole marker and rejects a summary. Summaries are validated as 1-240 Unicode characters. Only the assigned, attested principal acting through the current binding may update the task; a current binding may explicitly replace a marker fenced to an earlier binding epoch.

Assigned-agent transitions among `working`, `input-required`, and `auth-required` refresh the marker and its derived state. Requester messages and unrelated task writes do not refresh it. The projection never falls back to the task `summary`, message parts, input-required question, artifacts, or runtime output.

Alternative considered: derive text from the incoming prompt or existing task summary. Rejected because those values can contain sensitive or requester-controlled content. Adding activity options to every task tool was rejected because one explicit update operation is smaller and gives replace, refresh, and clear one consistent contract.

### Delivery instructions prompt semantic updates

Extend the existing direct-delivery prompt contract to tell the assigned agent to acknowledge with an initial concise activity, update it when the objective or scope materially changes, and refresh it before expiry during long-running work. This is the semantic prompt that only the model can satisfy; it does not decide whether activity is eligible.

No new Codex lifecycle hook is needed for ACS-assigned tasks. Server-side task state, binding fences, and read-time expiry enforce correctness even when the model omits an update. General session activity unrelated to an ACS task would require separate lifecycle-hook design and remains out of scope.

Alternative considered: install periodic Codex hooks for all sessions. Rejected because hooks cannot safely infer a concise semantic goal, and task delivery already provides the relevant instruction point.

### Expire and select activity at read time

Each acknowledgement, explicit update, or assigned-agent lifecycle transition sets expiry to 30 minutes after that action. Discovery filters markers whose task is terminal, expiry has elapsed, publishing binding or epoch is no longer current, or binding lacks a current runtime claimant. It then orders eligible markers by publication/refresh time descending and task ID descending. No deletion or timer job is required.

An explicit clear removes the whole marker without changing task state. Task completion, failure, cancellation, rejection, ownership loss, and expiry also make the marker ineligible. A cleared or older-epoch task can become current again only through a later acknowledgement or explicit `refresh` from the current assigned binding.

### Keep activity in ACS discovery contracts

Extend `LogicalAgentDto` and the MCP agent list/get views with the same optional shape:

```ts
currentActivity?: {
  state: "working" | "input-required" | "auth-required";
  summary?: string;
  updatedAt: string;
  expiresAt: string;
}
```

The control protocol retains structured skills. MCP continues its concise model-facing expertise projection and gains the activity object. A shared storage projection prevents the two surfaces from drifting.

Alternative considered: include activity in an A2A data-only extension or authenticated extended Agent Card. Rejected because Agent Cards are cacheable stable profiles, version changes do not notify clients, and ACS already owns the live binding/task state.

## Risks / Trade-offs

- [An agent ignores the maintenance prompt] -> Discovery still reports acknowledged task state until the fixed TTL, then expires without relying on model cooperation.
- [An agent writes sensitive text into the explicitly public-to-peers summary] -> Keep the field short, describe its visibility in the tool contract, and never infer or copy other task content.
- [Several tasks are active] -> Show one deterministic most-recent activity rather than adding workload aggregation before it is needed.
- [A logical task survives a runtime rebind] -> Fence the marker by binding ID and epoch; the replacement binding must acknowledge or republish it.
- [A task runs silently for longer than 30 minutes] -> Prompt the agent to refresh; increase or configure the TTL only after real workloads show the fixed value is unsuitable.

## Migration Plan

The response fields and acknowledgement input are optional, and the task metadata column already exists, so no schema migration is required. Deploy the daemon and MCP bridge together; older stored tasks have no marker and therefore advertise no activity. Rollback ignores the metadata key and removes the optional operations and response field without data loss.
