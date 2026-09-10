import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Message, Role, TaskState as A2ATaskState } from "@a2a-js/sdk";
import { Store, type Paths, type StoredPart } from "../packages/storage-sqlite/src/index";
import { BindingState, TaskState } from "../packages/domain/src/index";
import directDeliveryMigration from "../storage/002_direct_delivery.sql" with { type: "text" };

const roots: string[] = [];
const legacyDeliveryMigration = directDeliveryMigration
  .replace(
    "mode TEXT NOT NULL DEFAULT 'direct' CHECK (mode = 'direct')",
    "mode TEXT NOT NULL CHECK (mode IN ('wake_when_idle', 'append_context', 'join_active'))",
  )
  .replace("  'direct', priority", "  'wake_when_idle', priority");
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});
function fixture(limits: Partial<Store["limits"]> = {}) {
  const root = mkdtempSync(join(tmpdir(), "acs-"));
  roots.push(root);
  const p: Paths = {
    data: join(root, "acs.db"),
    runtime: join(root, "control.sock"),
    token: join(root, "control.token"),
    bridgeToken: join(root, "bridge.token"),
    secret: join(root, "secret.key"),
  };
  return new Store(p, limits);
}

function requestMessage(messageId: string) {
  return Message.fromJSON({ messageId, role: Role.ROLE_USER, parts: [{ text: "work" }] });
}
function authenticated(store: Store) {
  const principal = store.authenticate(readFileSync(store.config.token, "utf8"));
  if (!principal) throw new Error("missing test principal");
  return principal;
}

test("projects only current binding-fenced acknowledged task activity", () => {
  const store = fixture(),
    agent = store.createAgent("activity-worker"),
    binding = store.bind(agent.id, "activity-session"),
    requester = authenticated(store),
    first = store.accept(agent.id, requester.id, requestMessage("activity-first"), {}),
    second = store.accept(agent.id, requester.id, requestMessage("activity-second"), {});
  const activityTimes = (taskId: string) => {
      const row = store.db
        .query<{ updated: number; expires: number }, [string]>(
          "SELECT json_extract(metadata_json, '$.urn:agent-communications:task-activity:v1.updatedAtMs') updated,json_extract(metadata_json, '$.urn:agent-communications:task-activity:v1.expiresAtMs') expires FROM a2a_tasks WHERE id=?",
        )
        .get(taskId);
      if (!row) throw new Error("missing activity");
      return row;
    },
    setActivityTimes = (taskId: string, updated: number, expires: number) => {
      store.db
        .query(
          "UPDATE a2a_tasks SET metadata_json=json_set(metadata_json, '$.urn:agent-communications:task-activity:v1.updatedAtMs', ?, '$.urn:agent-communications:task-activity:v1.expiresAtMs', ?) WHERE id=?",
        )
        .run(updated, expires, taskId);
    };
  store.db
    .query(
      "UPDATE runtime_bindings SET last_observed_runtime_state='idle',last_observed_blocking_reason='none',last_observed_interactive_presence='present' WHERE id=?",
    )
    .run(binding.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.acknowledgeTask(first.task.id, binding.principalId, first.deliveryId, "Reviewing the plan");
  store.acknowledgeTask(second.task.id, binding.principalId, second.deliveryId, "Second task");
  const fixed = Date.now() - 10_000;
  setActivityTimes(first.task.id, fixed, fixed + 1_800_000);
  setActivityTimes(second.task.id, fixed + 1, fixed + 1_800_000);
  expect(store.currentActivity(agent.id)).toMatchObject({ summary: "Second task" });
  setActivityTimes(first.task.id, fixed, fixed + 1_800_000);
  setActivityTimes(second.task.id, fixed, fixed + 1_800_000);
  expect(store.currentActivity(agent.id)).toMatchObject({
    summary: first.task.id > second.task.id ? "Reviewing the plan" : "Second task",
  });
  expect(() => store.updateTaskActivity(first.task.id, requester.id, "clear")).toThrow(
    "TASK_NOT_ASSIGNED",
  );
  expect(() =>
    store.updateTaskActivity(first.task.id, binding.principalId, "clear", "must reject"),
  ).toThrow("VALIDATION_FAILED");
  expect(() =>
    store.updateTaskActivity(first.task.id, binding.principalId, "refresh", "x".repeat(241)),
  ).toThrow("VALIDATION_FAILED");
  const beforeTransition = activityTimes(first.task.id);
  store.setTaskState(first.task.id, binding.principalId, TaskState.InputRequired, "Need input");
  const afterTransition = activityTimes(first.task.id);
  expect(afterTransition.expires - afterTransition.updated).toBe(1_800_000);
  expect(afterTransition.updated).toBeGreaterThan(beforeTransition.updated);
  expect(store.currentActivity(agent.id)).toMatchObject({
    state: "input-required",
    summary: "Reviewing the plan",
  });
  const beforeRequesterUpdate = activityTimes(first.task.id);
  store.accept(
    agent.id,
    requester.id,
    Message.fromJSON({
      messageId: "requester-followup",
      taskId: first.task.id,
      contextId: first.task.contextId,
      role: Role.ROLE_USER,
      parts: [{ text: "requester update" }],
    }),
    {},
  );
  expect(activityTimes(first.task.id)).toEqual(beforeRequesterUpdate);
  store.updateTaskActivity(first.task.id, binding.principalId, "clear");
  expect(store.currentActivity(agent.id)).toMatchObject({ summary: "Second task" });
  store.db
    .query("UPDATE runtime_bindings SET last_observed_interactive_presence='unknown' WHERE id=?")
    .run(binding.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.db
    .query(
      "UPDATE runtime_bindings SET last_observed_runtime_state='idle',last_observed_blocking_reason='none',last_observed_interactive_presence='present' WHERE id=?",
    )
    .run(binding.id);
  expect(store.currentActivity(agent.id)).toMatchObject({ summary: "Second task" });
  setActivityTimes(second.task.id, fixed, 0);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.updateTaskActivity(second.task.id, binding.principalId, "refresh");
  const replacement = store.bind(agent.id, "replacement-session", { revokeExisting: true });
  store.db
    .query(
      "UPDATE runtime_bindings SET last_observed_runtime_state='idle',last_observed_blocking_reason='none',last_observed_interactive_presence='present' WHERE id=?",
    )
    .run(replacement.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.updateTaskActivity(second.task.id, replacement.principalId, "refresh", "Taking over");
  expect(store.currentActivity(agent.id)).toMatchObject({ summary: "Taking over" });
  store.revokeBinding(replacement.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.requestCancellation(second.task.id, requester.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.close();
});

test("projects binding-scoped activity through its current binding lifecycle", () => {
  const store = fixture(),
    agent = store.createAgent("local-activity"),
    binding = store.bind(agent.id, "local-activity-session"),
    requester = authenticated(store),
    task = store.accept(agent.id, requester.id, requestMessage("local-activity-task"), {});
  store.db
    .query(
      "UPDATE runtime_bindings SET last_observed_runtime_state='idle',last_observed_blocking_reason='none',last_observed_interactive_presence='present',metadata_json='{\"keep\":true}' WHERE id=?",
    )
    .run(binding.id);
  expect(() => store.updateActivity(binding.principalId, "refresh")).toThrow("VALIDATION_FAILED");
  expect(
    store.updateActivity(binding.principalId, "refresh", "Implementing issue 42", {
      cwd: "/workspace/issue-42",
      gitBranch: "feature/42",
    }),
  ).toMatchObject({
    state: "working",
    summary: "Implementing issue 42",
    cwd: "/workspace/issue-42",
    gitBranch: "feature/42",
  });
  expect(store.updateActivity(binding.principalId, "refresh")).toMatchObject({
    summary: "Implementing issue 42",
    cwd: "/workspace/issue-42",
    gitBranch: "feature/42",
  });
  expect(
    store.updateActivity(binding.principalId, "refresh", "Reviewing issue 43", {
      cwd: "/workspace/issue-43",
    }),
  ).toMatchObject({ summary: "Reviewing issue 43", cwd: "/workspace/issue-43" });
  expect(() => store.updateActivity(binding.principalId, "clear", "must reject")).toThrow(
    "VALIDATION_FAILED",
  );
  const metadata = store.db
    .query<{ metadata_json: string }, [string]>(
      "SELECT metadata_json FROM runtime_bindings WHERE id=?",
    )
    .get(binding.id)?.metadata_json;
  expect(metadata).toContain("keep");
  store.acknowledgeTask(task.task.id, binding.principalId, task.deliveryId, "Older task", {
    cwd: "/workspace/task",
    gitBranch: "feature/task",
  });
  store.setTaskState(task.task.id, binding.principalId, TaskState.InputRequired, "Need input");
  expect(store.currentActivity(agent.id)).toMatchObject({
    cwd: "/workspace/task",
    gitBranch: "feature/task",
  });
  store.updateActivity(binding.principalId, "refresh", "New local focus");
  const localUpdatedAt = Date.now() + 1_000;
  store.db
    .query(
      "UPDATE runtime_bindings SET metadata_json=json_set(metadata_json, '$.urn:agent-communications:binding-activity:v1.updatedAtMs', ?, '$.urn:agent-communications:binding-activity:v1.expiresAtMs', ?) WHERE id=?",
    )
    .run(localUpdatedAt, localUpdatedAt + 1_800_000, binding.id);
  store.setTaskState(task.task.id, binding.principalId, TaskState.Working, "Resumed work");
  store.setTaskState(task.task.id, binding.principalId, TaskState.Completed, "done");
  expect(store.currentActivity(agent.id)).toMatchObject({ summary: "New local focus" });
  store.db
    .query(
      "UPDATE runtime_bindings SET metadata_json=json_set(metadata_json, '$.urn:agent-communications:binding-activity:v1.expiresAtMs', 0) WHERE id=?",
    )
    .run(binding.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.updateActivity(binding.principalId, "refresh", "Resumed local focus");
  store.db
    .query("UPDATE runtime_bindings SET last_observed_interactive_presence='unknown' WHERE id=?")
    .run(binding.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.db
    .query(
      "UPDATE runtime_bindings SET last_observed_runtime_state='idle',last_observed_blocking_reason='none',last_observed_interactive_presence='present' WHERE id=?",
    )
    .run(binding.id);
  expect(store.currentActivity(agent.id)).toMatchObject({ summary: "Resumed local focus" });
  const replacement = store.bind(agent.id, "local-activity-replacement", { revokeExisting: true });
  store.db
    .query(
      "UPDATE runtime_bindings SET last_observed_runtime_state='idle',last_observed_blocking_reason='none',last_observed_interactive_presence='present' WHERE id=?",
    )
    .run(replacement.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  expect(() => store.updateActivity(binding.principalId, "refresh", "stale")).toThrow(
    "STALE_BINDING",
  );
  store.updateActivity(replacement.principalId, "refresh", "Replacement local focus");
  expect(store.currentActivity(agent.id)).toMatchObject({ summary: "Replacement local focus" });
  expect(store.updateActivity(replacement.principalId, "clear")).toBeUndefined();
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.revokeBinding(replacement.id);
  expect(store.currentActivity(agent.id)).toBeUndefined();
  store.close();
});

test("preserves removed Codex installations as offline records", () => {
  const store = fixture();
  store.syncCodexInstallations([
    { label: "personal", home: "/accounts/personal", socket: "/tmp/personal.sock" },
    { label: "work", home: "/accounts/work", socket: "/tmp/work.sock" },
  ]);
  const work = store.db
    .query<{ id: `ins_${string}` }, []>(
      "SELECT id FROM runtime_installations WHERE harness_id='codex' AND label='work'",
    )
    .get();
  if (!work) throw new Error("missing work installation");
  const agent = store.createAgent("work-agent"),
    binding = store.bind(agent.id, "work-session", { installationId: work.id });
  store.observeSession({
    session: { installationId: work.id, opaqueId: "work-session" },
    runtimeState: "idle",
    blockingReason: "none",
    interactivePresence: "absent",
    observedAt: new Date().toISOString(),
    attributes: {},
  });
  store.syncCodexInstallations([]);
  expect(
    store.db
      .query<{ state: string }, [string]>(
        "SELECT state FROM runtime_installations WHERE harness_id='codex' AND label=?",
      )
      .get("work"),
  ).toEqual({ state: "offline" });
  expect(
    store.db
      .query<{ runtimeState: string; presence: string }, [string]>(
        "SELECT last_observed_runtime_state runtimeState,last_observed_interactive_presence presence FROM runtime_bindings WHERE id=?",
      )
      .get(binding.id),
  ).toEqual({ runtimeState: "unknown", presence: "unknown" });
  expect(
    store.db
      .query<{ offline_since_ms: number | null }, [string]>(
        "SELECT offline_since_ms FROM agents WHERE id=?",
      )
      .get(agent.id)?.offline_since_ms,
  ).toBeNull();
});

test("reaps only continuously offline active bindings and fails queued work", () => {
  const store = fixture(),
    agent = store.createAgent("reaped-worker"),
    binding = store.bind(agent.id, "reaped-session"),
    requester = store.createAgent("reap-requester"),
    requesterBinding = store.bind(requester.id, "reap-requester-session"),
    accepted = store.accept(agent.id, requesterBinding.principalId, requestMessage("reaped-task"), {
      notifyOn: ["terminal"],
    }),
    stored = store.binding(binding.id);
  if (!stored) throw new Error("missing binding");
  const oldToken = store.issueToken(binding.principalId, ["executor"]);
  const offlineAt = Date.now() - 2_000;
  store.observeSession({
    session: { installationId: stored.installation_id, opaqueId: "reaped-session" },
    runtimeState: "idle",
    blockingReason: "none",
    interactivePresence: "absent",
    observedAt: new Date(offlineAt).toISOString(),
    attributes: {},
  });
  expect(store.reapOfflineAgents(1_000)).toEqual([agent.id]);
  expect(store.agent(agent.id)).toBeNull();
  expect(store.binding(binding.id)?.status).toBe(BindingState.Revoked);
  expect(store.authenticate(oldToken)).toBeNull();
  const task = store.task(accepted.task.id, requesterBinding.principalId);
  expect(task?.status?.state).toBe(4);
  expect(task?.status?.message?.parts.at(0)?.content).toEqual({
    $case: "text",
    value: "target-reaped",
  });
  expect(store.eventsAfter(accepted.task.id, 0).at(-1)).toMatchObject({ eventType: "task-failed" });
  expect(
    store.db
      .query<{ count: number }, [string, string]>(
        "SELECT count(*) count FROM delivery_intents WHERE task_id=? AND kind='task-event-notification' AND target_agent_id=? AND state='pending'",
      )
      .get(accepted.task.id, requester.id),
  ).toEqual({ count: 1 });
  expect(
    store.db
      .query(
        "SELECT count(*) count FROM delivery_intents WHERE target_agent_id=? AND state IN ('pending','leased','attempting','deferred','acceptance-unknown')",
      )
      .get(agent.id),
  ).toEqual({ count: 0 });
  expect(store.createAgent("reaped-worker").id).not.toBe(agent.id);
  store.close();
});

test("clears the offline interval for reconnects and unsupported observations", () => {
  const store = fixture(),
    agent = store.createAgent("offline-reset"),
    binding = store.bind(agent.id, "offline-reset-session"),
    stored = store.binding(binding.id);
  if (!stored) throw new Error("missing binding");
  const session = { installationId: stored.installation_id, opaqueId: "offline-reset-session" };
  store.observeSession({
    session,
    runtimeState: "idle",
    blockingReason: "none",
    interactivePresence: "absent",
    observedAt: new Date(Date.now() - 2_000).toISOString(),
    attributes: {},
  });
  store.observeSession({
    session,
    runtimeState: "idle",
    blockingReason: "none",
    interactivePresence: "present",
    observedAt: new Date().toISOString(),
    attributes: {},
  });
  expect(store.reapOfflineAgents(1)).toEqual([]);
  store.observeSession({
    session,
    runtimeState: "system-error",
    blockingReason: "unknown",
    interactivePresence: "unknown",
    observedAt: new Date().toISOString(),
    attributes: {},
  });
  expect(store.reapOfflineAgents(1)).toEqual([]);
  expect(store.agent(agent.id)?.id).toBe(agent.id);
  store.close();
});

test("ignores stale session observations", () => {
  const store = fixture(),
    agent = store.createAgent("stale-observation"),
    binding = store.bind(agent.id, "stale-observation-session"),
    stored = store.binding(binding.id);
  if (!stored) throw new Error("missing binding");
  const session = {
    installationId: stored.installation_id,
    opaqueId: "stale-observation-session",
  };
  store.observeSession({
    session,
    runtimeState: "idle",
    blockingReason: "none",
    interactivePresence: "present",
    observedAt: new Date(2_000).toISOString(),
    attributes: {},
  });
  store.observeSession({
    session,
    runtimeState: "idle",
    blockingReason: "none",
    interactivePresence: "absent",
    observedAt: new Date(1_000).toISOString(),
    attributes: {},
  });
  expect(store.binding(binding.id)).toMatchObject({
    last_observed_interactive_presence: "present",
    last_observed_at_ms: 2_000,
  });
  expect(
    store.db
      .query<{ offline_since_ms: number | null }, [string]>(
        "SELECT offline_since_ms FROM agents WHERE id=?",
      )
      .get(agent.id)?.offline_since_ms,
  ).toBeNull();
  store.close();
});

test("starts the offline interval when a runtime disconnects", () => {
  const store = fixture(),
    agent = store.createAgent("disconnected-worker"),
    binding = store.bind(agent.id, "disconnected-session"),
    stored = store.binding(binding.id);
  if (!stored) throw new Error("missing binding");
  store.markRuntimeOffline(stored.installation_id);
  expect(store.reapOfflineAgents(0)).toEqual([agent.id]);
  store.close();
});

describe("schema migrations", () => {
  test("upgrades legacy delivery intents without losing durable state", () => {
    const store = fixture(),
      config = store.config,
      agent = store.createAgent("legacy-worker"),
      binding = store.bind(agent.id, "legacy-session"),
      principal = authenticated(store),
      accepted = ["wake_when_idle", "append_context", "join_active"].map((messageId) =>
        store.accept(agent.id, principal.id, requestMessage(messageId), {}),
      );
    const first = accepted[0];
    if (!first) throw new Error("missing legacy delivery");
    store.db
      .query(
        "INSERT INTO delivery_attempts(id,intent_id,attempt_number,adapter_id,binding_id,binding_epoch,started_at_ms) VALUES('att_legacy',?,1,'codex.app-server',?,?,1)",
      )
      .run(first.deliveryId, binding.id, binding.epoch);
    store.db
      .query(
        "INSERT INTO runtime_executions(id,intent_id,binding_id,binding_epoch,runtime_execution_opaque_id,relationship,state,accepted_at_ms,updated_at_ms) VALUES('exe_legacy',?,?,?,'turn-legacy','started','accepted',1,1)",
      )
      .run(first.deliveryId, binding.id, binding.epoch);
    expect(store.db.query("SELECT count(*) count FROM delivery_intents").get()).toEqual({
      count: 3,
    });
    store.close();

    const legacy = new Database(config.data, { strict: true });
    legacy.exec("PRAGMA foreign_keys=OFF");
    expect(legacy.query("SELECT count(*) count FROM delivery_intents").get()).toEqual({ count: 3 });
    legacy
      .transaction(() => {
        legacy.exec(legacyDeliveryMigration);
        for (const [index, mode] of ["wake_when_idle", "append_context", "join_active"].entries()) {
          const delivery = accepted[index];
          if (!delivery) throw new Error("missing legacy delivery");
          legacy
            .query("UPDATE delivery_intents SET mode=? WHERE id=?")
            .run(mode, delivery.deliveryId);
        }
        legacy.query("DELETE FROM schema_migrations WHERE version=2").run();
      })
      .immediate();
    legacy.exec("PRAGMA foreign_keys=ON");
    expect(legacy.query("SELECT mode FROM delivery_intents ORDER BY created_at_ms").all()).toEqual([
      { mode: "wake_when_idle" },
      { mode: "append_context" },
      { mode: "join_active" },
    ]);
    legacy.close();

    const upgraded = new Store(config);
    expect(upgraded.task(first.task.id, principal.id)?.id).toBe(first.task.id);
    expect(upgraded.binding(binding.id)?.id).toBe(binding.id);
    expect(
      upgraded.db.query("SELECT mode FROM delivery_intents ORDER BY created_at_ms").all(),
    ).toEqual([{ mode: "direct" }, { mode: "direct" }, { mode: "direct" }]);
    expect(
      upgraded.db.query("SELECT version FROM schema_migrations ORDER BY version").all(),
    ).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }]);
    expect(
      upgraded.db
        .query("SELECT intent_id,binding_id FROM delivery_attempts WHERE id='att_legacy'")
        .get(),
    ).toEqual({ intent_id: first.deliveryId, binding_id: binding.id });
    expect(
      upgraded.db
        .query(
          "SELECT intent_id,binding_id,relationship FROM runtime_executions WHERE id='exe_legacy'",
        )
        .get(),
    ).toEqual({ intent_id: first.deliveryId, binding_id: binding.id, relationship: "started" });
    upgraded.accept(agent.id, principal.id, requestMessage("current-send"), {});
    upgraded.close();

    const reopened = new Store(config);
    expect(reopened.db.query("SELECT count(*) count FROM delivery_intents").get()).toEqual({
      count: 4,
    });
    expect(
      reopened.db.query("SELECT count(*) count FROM schema_migrations WHERE version=2").get(),
    ).toEqual({
      count: 1,
    });
    reopened.close();
  });

  test("rolls back a failed legacy migration without recording version 2", () => {
    const store = fixture(),
      config = store.config,
      agent = store.createAgent("corrupt-legacy-worker"),
      principal = authenticated(store),
      accepted = store.accept(agent.id, principal.id, requestMessage("corrupt-legacy"), {});
    store.close();

    const legacy = new Database(config.data, { strict: true });
    legacy.exec("PRAGMA foreign_keys=OFF");
    legacy
      .transaction(() => {
        legacy.exec(legacyDeliveryMigration);
        legacy
          .query("UPDATE delivery_intents SET target_agent_id='agt_missing' WHERE id=?")
          .run(accepted.deliveryId);
        legacy.query("DELETE FROM schema_migrations WHERE version=2").run();
      })
      .immediate();
    legacy.exec("PRAGMA foreign_keys=ON");
    legacy.close();

    expect(() => new Store(config)).toThrow("foreign key check failed");

    const inspected = new Database(config.data, { strict: true });
    expect(
      inspected.query("SELECT count(*) count FROM schema_migrations WHERE version=2").get(),
    ).toEqual({
      count: 0,
    });
    expect(
      inspected
        .query("SELECT target_agent_id,mode FROM delivery_intents WHERE id=?")
        .get(accepted.deliveryId),
    ).toEqual({
      target_agent_id: "agt_missing",
      mode: "wake_when_idle",
    });
    expect(
      inspected
        .query<{ sql: string }, []>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='delivery_intents'",
        )
        .get()?.sql,
    ).toContain("mode IN ('wake_when_idle', 'append_context', 'join_active')");
    inspected.close();
  });

  test("records current migrations once for a fresh database", () => {
    const store = fixture(),
      config = store.config;
    expect(store.db.query("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
    ]);
    store.close();
    const reopened = new Store(config);
    expect(reopened.db.query("SELECT count(*) count FROM schema_migrations").get()).toEqual({
      count: 5,
    });
    reopened.close();
  });

  test("rebuilds task events for explicit acknowledgements without losing events", () => {
    const store = fixture(),
      config = store.config,
      agent = store.createAgent("legacy-acknowledgement-worker"),
      principal = authenticated(store),
      accepted = store.accept(agent.id, principal.id, requestMessage("legacy-acknowledgement"), {}),
      events = store.db
        .query<
          {
            id: string;
            task_id: string;
            sequence: number;
            event_type: string;
            actor_principal_id: string | null;
            payload_json: string;
            created_at_ms: number;
          },
          []
        >("SELECT * FROM task_events ORDER BY task_id,sequence")
        .all();
    store.close();

    const legacy = new Database(config.data, { strict: true });
    legacy.exec("PRAGMA foreign_keys=OFF");
    legacy
      .transaction(() => {
        legacy.exec(
          "DROP TRIGGER task_events_no_update; DROP TRIGGER task_events_no_delete; DROP INDEX task_events_task_created_idx; CREATE TABLE task_events_legacy AS SELECT * FROM task_events; DROP TABLE task_events; ALTER TABLE task_events_legacy RENAME TO task_events;",
        );
        legacy.query("DELETE FROM schema_migrations WHERE version=4").run();
      })
      .immediate();
    legacy.exec("PRAGMA foreign_keys=ON");
    legacy.close();

    const upgraded = new Store(config);
    expect(
      upgraded.db
        .query(
          "SELECT id,task_id,sequence,event_type,actor_principal_id,payload_json,created_at_ms FROM task_events ORDER BY task_id,sequence",
        )
        .all(),
    ).toEqual(events);
    expect(
      upgraded.db
        .query<{ sql: string }, []>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='task_events'",
        )
        .get()?.sql,
    ).toContain("'task-acknowledged'");
    expect(
      upgraded.db
        .query("SELECT 1 value FROM sqlite_master WHERE type='index' AND name=?")
        .get("task_events_task_created_idx"),
    ).toEqual({ value: 1 });
    expect(() =>
      upgraded.db
        .query("UPDATE task_events SET event_type=event_type WHERE task_id=?")
        .run(accepted.task.id),
    ).toThrow("TASK_EVENT_IMMUTABLE");
    expect(() =>
      upgraded.db.query("DELETE FROM task_events WHERE task_id=?").run(accepted.task.id),
    ).toThrow("TASK_EVENT_IMMUTABLE");
    upgraded.close();
  });

  test("adds the runtime execution relationship to a legacy database", () => {
    const store = fixture(),
      config = store.config,
      agent = store.createAgent("legacy-execution-worker"),
      binding = store.bind(agent.id, "legacy-execution-session"),
      principal = authenticated(store),
      accepted = store.accept(agent.id, principal.id, requestMessage("legacy-execution"), {});
    store.db
      .query(
        "INSERT INTO runtime_executions(id,intent_id,binding_id,binding_epoch,runtime_execution_opaque_id,relationship,state,accepted_at_ms,updated_at_ms) VALUES('exe_legacy',?,?,?,?,?,'accepted',1,1)",
      )
      .run(accepted.deliveryId, binding.id, binding.epoch, "turn-legacy", "started");
    store.close();

    const legacy = new Database(config.data, { strict: true });
    legacy.exec("DROP INDEX runtime_executions_runtime_turn_idx");
    legacy.exec("ALTER TABLE runtime_executions DROP COLUMN relationship");
    legacy.query("DELETE FROM schema_migrations WHERE version=3").run();
    legacy.close();

    const upgraded = new Store(config);
    expect(
      upgraded.db
        .query(
          "SELECT intent_id,binding_id,runtime_execution_opaque_id,relationship,state FROM runtime_executions WHERE id='exe_legacy'",
        )
        .get(),
    ).toEqual({
      intent_id: accepted.deliveryId,
      binding_id: binding.id,
      runtime_execution_opaque_id: "turn-legacy",
      relationship: "unknown",
      state: "accepted",
    });
    expect(
      upgraded.db
        .query("SELECT 1 value FROM sqlite_master WHERE type='index' AND name=?")
        .get("runtime_executions_runtime_turn_idx"),
    ).toEqual({ value: 1 });
    expect(
      upgraded.db.query("SELECT count(*) count FROM schema_migrations WHERE version=3").get(),
    ).toEqual({ count: 1 });
    upgraded.close();
  });
});

describe("durable acceptance", () => {
  test("repairs permissions on existing runtime credentials", () => {
    const root = mkdtempSync(join(tmpdir(), "acs-permissions-"));
    roots.push(root);
    const paths: Paths = {
      data: join(root, "acs.db"),
      runtime: join(root, "control.sock"),
      token: join(root, "control.token"),
      bridgeToken: join(root, "bridge.token"),
      secret: join(root, "secret.key"),
    };
    writeFileSync(paths.secret, Buffer.alloc(32, 1));
    writeFileSync(paths.token, "existing-control-token");
    writeFileSync(paths.bridgeToken, "existing-bridge-token");
    for (const file of [paths.secret, paths.token, paths.bridgeToken]) chmodSync(file, 0o666);
    const store = new Store(paths);
    expect(statSync(root).mode & 0o777).toBe(0o700);
    for (const file of [paths.secret, paths.token, paths.bridgeToken])
      expect(statSync(file).mode & 0o777).toBe(0o600);
    store.close();
  });
  test("rejects a permissive runtime directory", () => {
    const root = mkdtempSync(join(tmpdir(), "acs-unsafe-runtime-"));
    roots.push(root);
    chmodSync(root, 0o777);
    expect(
      () =>
        new Store({
          data: join(root, "acs.db"),
          runtime: join(root, "control.sock"),
          token: join(root, "control.token"),
          bridgeToken: join(root, "bridge.token"),
          secret: join(root, "secret.key"),
        }),
    ).toThrow("runtime directory must have mode 0700");
  });
  test("signs opaque cursors and rejects tampering", () => {
    const store = fixture(),
      cursor = store.encodeCursor({ sortKey: "backend", id: "agt_1", offset: 1 });
    expect(store.decodeCursor(cursor)).toEqual({ offset: 1, sortKey: "backend", id: "agt_1" });
    expect(() => store.decodeCursor(`${cursor}x`)).toThrow("invalid cursor");
    store.close();
  });
  test("paginates tasks by stable key when newer work arrives", async () => {
    const store = fixture(),
      agent = store.createAgent("paged-worker"),
      principal = authenticated(store);
    const ids: string[] = [];
    for (const messageId of ["page-1", "page-2", "page-3"]) {
      ids.push(
        store.accept(
          agent.id,
          principal.id,
          Message.fromJSON({ messageId, role: Role.ROLE_USER, parts: [{ text: messageId }] }),
          {},
        ).task.id,
      );
      await Bun.sleep(2);
    }
    const first = store.listTasks(agent.id, principal.id, { limit: 2 });
    expect(first.tasks).toHaveLength(2);
    expect(first.nextCursor).toBeString();
    await Bun.sleep(2);
    const newer = store.accept(
      agent.id,
      principal.id,
      Message.fromJSON({ messageId: "page-new", role: Role.ROLE_USER, parts: [{ text: "new" }] }),
      {},
    ).task.id;
    const second = store.listTasks(agent.id, principal.id, {
      limit: 2,
      cursor: first.nextCursor,
    });
    expect([...first.tasks, ...second.tasks].map((task) => task.id).toSorted()).toEqual(
      ids.toSorted(),
    );
    expect(second.tasks.map((task) => task.id)).not.toContain(newer);
    store.close();
  });
  test("commits one task and one delivery for an idempotent message", () => {
    const store = fixture(),
      agent = store.createAgent("backend"),
      principal = authenticated(store);
    const message = Message.fromJSON({
      messageId: "request-1",
      role: Role.ROLE_USER,
      parts: [{ text: "work" }],
    });
    const first = store.accept(agent.id, principal.id, message, {});
    store.setTaskState(first.task.id, principal.id, TaskState.Canceled, "canceled");
    const second = store.accept(agent.id, principal.id, message, {});
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.task.status?.state).toBe(A2ATaskState.TASK_STATE_CANCELED);
    expect(second.deliveryId).toBe(first.deliveryId);
    expect(store.db.query("SELECT count(*) n FROM delivery_intents").get()).toEqual({ n: 1 });
    store.close();
  });
  test("checks idempotency after acquiring the acceptance write lock", () => {
    const store = fixture(),
      agent = store.createAgent("idempotency-race"),
      principal = authenticated(store),
      seed = store.accept(
        agent.id,
        principal.id,
        Message.fromJSON({
          messageId: "idempotency-seed",
          role: Role.ROLE_USER,
          parts: [{ text: "seed" }],
        }),
        {},
      ),
      originalWrite = store.write.bind(store);
    let injectCommittedDuplicate = true;
    store.write = <Result>(operation: () => Result) => {
      if (injectCommittedDuplicate) {
        injectCommittedDuplicate = false;
        const now = Date.now();
        store.db
          .query(
            "INSERT INTO idempotency_records(scope,key,request_hash,state,response_json,created_at_ms,updated_at_ms) VALUES(?,?,?,'committed',?,?,?)",
          )
          .run(
            `${principal.id}:${agent.id}`,
            "idempotency-race",
            "racing-hash",
            JSON.stringify({
              task: seed.task,
              deliveryId: seed.deliveryId,
              stateVersion: seed.stateVersion,
            }),
            now,
            now,
          );
      }
      return originalWrite(operation);
    };
    expect(
      store.accept(
        agent.id,
        principal.id,
        Message.fromJSON({
          messageId: "idempotency-race",
          role: Role.ROLE_USER,
          parts: [{ text: "work" }],
        }),
        {},
        "racing-hash",
      ),
    ).toMatchObject({ duplicate: true, deliveryId: seed.deliveryId });
    store.close();
  });
  test("keeps task events immutable", () => {
    const store = fixture(),
      target = store.createAgent("immutable-events"),
      requester = authenticated(store),
      accepted = store.accept(
        target.id,
        requester.id,
        Message.fromJSON({
          messageId: "immutable-events-message",
          role: Role.ROLE_USER,
          parts: [{ text: "work" }],
        }),
        {},
      );
    expect(() =>
      store.db
        .query("UPDATE task_events SET event_type='task-failed' WHERE task_id=?")
        .run(accepted.task.id),
    ).toThrow("TASK_EVENT_IMMUTABLE");
    expect(() =>
      store.db.query("DELETE FROM task_events WHERE task_id=?").run(accepted.task.id),
    ).toThrow("TASK_EVENT_IMMUTABLE");
    store.close();
  });
  test("rejects target overload without partial acceptance", () => {
    const store = fixture({ maxQueuedDeliveryIntents: 1 }),
      agent = store.createAgent("overloaded-worker"),
      principal = authenticated(store);
    store.accept(agent.id, principal.id, requestMessage("overload-1"), {});
    expect(() => store.accept(agent.id, principal.id, requestMessage("overload-2"), {})).toThrow(
      "ACS_OVERLOADED",
    );
    expect(store.db.query("SELECT count(*) count FROM a2a_tasks").get()).toEqual({ count: 1 });
    expect(store.db.query("SELECT count(*) count FROM delivery_intents").get()).toEqual({
      count: 1,
    });
    store.close();
  });
  test("rejects acceptance for a disabled target", () => {
    const store = fixture(),
      agent = store.createAgent("disabled-target"),
      principal = authenticated(store);
    store.updateAgent(agent.id, { enabled: false });
    expect(() => store.accept(agent.id, principal.id, requestMessage("disabled"), {})).toThrow(
      "ACS_AGENT_DISABLED",
    );
    expect(store.db.query("SELECT count(*) count FROM a2a_tasks").get()).toEqual({ count: 0 });
    store.close();
  });
  test("enforces configured message part limits", () => {
    const store = fixture({ maxParts: 1, maxTextPartBytes: 4 }),
      agent = store.createAgent("bounded-message"),
      principal = authenticated(store);
    expect(() =>
      store.accept(
        agent.id,
        principal.id,
        Message.fromJSON({
          messageId: "too-many-parts",
          role: Role.ROLE_USER,
          parts: [{ text: "one" }, { text: "two" }],
        }),
        {},
      ),
    ).toThrow("ACS_MESSAGE_TOO_LARGE");
    expect(() =>
      store.accept(
        agent.id,
        principal.id,
        Message.fromJSON({
          messageId: "text-too-large",
          role: Role.ROLE_USER,
          parts: [{ text: "12345" }],
        }),
        {},
      ),
    ).toThrow("ACS_MESSAGE_TOO_LARGE");
    expect(store.db.query("SELECT count(*) count FROM a2a_tasks").get()).toEqual({ count: 0 });
    store.close();
  });
  test("rolls back when any acceptance write fails", () => {
    const tables = [
      "conversation_contexts",
      "a2a_tasks",
      "a2a_messages",
      "task_events",
      "delivery_intents",
      "idempotency_records",
    ];
    for (const failureTable of tables) {
      const store = fixture(),
        agent = store.createAgent(`rollback-${failureTable.replaceAll("_", "-")}`),
        principal = authenticated(store);
      store.db.exec(
        `CREATE TEMP TRIGGER fail_acceptance BEFORE INSERT ON ${failureTable} BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
      );
      expect(() =>
        store.accept(
          agent.id,
          principal.id,
          Message.fromJSON({
            messageId: `rollback-${failureTable}`,
            role: Role.ROLE_USER,
            parts: [{ text: "work" }],
          }),
          {},
        ),
      ).toThrow("injected failure");
      for (const table of tables)
        expect(store.db.query(`SELECT count(*) count FROM ${table}`).get()).toEqual({ count: 0 });
      store.close();
    }
  });
  test("recovers committed work after a WAL restart", () => {
    const store = fixture(),
      config = store.config,
      agent = store.createAgent("restart-worker"),
      principal = authenticated(store),
      accepted = store.accept(
        agent.id,
        principal.id,
        Message.fromJSON({ messageId: "restart", role: Role.ROLE_USER, parts: [{ text: "work" }] }),
        {},
      );
    store.close();
    const reopened = new Store(config);
    expect(reopened.db.query("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(reopened.task(accepted.task.id, principal.id)?.id).toBe(accepted.task.id);
    expect(
      reopened.db.query("SELECT state FROM delivery_intents WHERE id=?").get(accepted.deliveryId),
    ).toEqual({ state: "pending" });
    reopened.close();
  });
  test("acquires the SQLite write lock before transaction work", () => {
    const first = fixture(),
      second = new Store(first.config, { busyTimeoutMs: 1 });
    first.write(() => {
      expect(() => second.db.exec("BEGIN IMMEDIATE")).toThrow("database is locked");
    });
    second.close();
    first.close();
  });
  test("detects and repairs task projection drift from the event log", () => {
    const store = fixture(),
      target = store.createAgent("projection-worker"),
      binding = store.bind(target.id, "projection-thread"),
      requester = authenticated(store),
      accepted = store.accept(
        target.id,
        requester.id,
        Message.fromJSON({
          messageId: "projection",
          role: Role.ROLE_USER,
          parts: [{ text: "work" }],
        }),
        {},
      );
    store.publishMessage(accepted.task.id, binding.principalId, [
      { content: { $case: "text", value: "result" }, filename: "", mediaType: "text/plain" },
    ]);
    store.publishArtifacts(accepted.task.id, binding.principalId, [
      {
        artifactId: "artifact-1",
        name: "result",
        description: "",
        parts: [
          { content: { $case: "text", value: "artifact" }, filename: "", mediaType: "text/plain" },
        ],
        extensions: [],
      },
    ]);
    store.setTaskState(accepted.task.id, binding.principalId, TaskState.Completed, "done");
    expect(store.eventsAfter(accepted.task.id, 0).map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    store.db
      .query("UPDATE a2a_tasks SET state='submitted',a2a_snapshot_json=? WHERE id=?")
      .run(JSON.stringify(accepted.task), accepted.task.id);
    expect(store.verifyTaskProjections()).toEqual({
      checked: 1,
      mismatched: [accepted.task.id],
      missing: [],
      repaired: 0,
    });
    expect(store.verifyTaskProjections(true).repaired).toBe(1);
    expect(store.verifyTaskProjections().mismatched).toEqual([]);
    expect(store.task(accepted.task.id, requester.id)?.status?.state).toBe(
      A2ATaskState.TASK_STATE_COMPLETED,
    );
    store.close();
  });
  test("enforces one active binding per agent and runtime session", () => {
    const store = fixture(),
      firstAgent = store.createAgent("first-bound-agent"),
      secondAgent = store.createAgent("second-bound-agent"),
      binding = store.bind(firstAgent.id, "shared-runtime-session");
    expect(
      store.db
        .query<{ kind: string }, [string]>("SELECT kind FROM principals WHERE id=?")
        .get(binding.principalId)?.kind,
    ).toBe("bound-agent");
    expect(store.authenticate(store.createToken().token)?.kind).toBe("external-a2a-client");
    expect(() =>
      store.db
        .query(
          "INSERT INTO runtime_bindings(id,agent_id,installation_id,session_opaque_id,epoch,status,continuity_policy,delivery_policy_json,created_at_ms) SELECT 'bnd_duplicate_agent',agent_id,installation_id,'other-session',epoch+1,'active',continuity_policy,delivery_policy_json,created_at_ms FROM runtime_bindings WHERE id=?",
        )
        .run(binding.id),
    ).toThrow("UNIQUE constraint failed");
    expect(() =>
      store.db
        .query(
          "INSERT INTO runtime_bindings(id,agent_id,installation_id,session_opaque_id,epoch,status,continuity_policy,delivery_policy_json,created_at_ms) SELECT 'bnd_duplicate_session',?,installation_id,session_opaque_id,1,'active',continuity_policy,delivery_policy_json,created_at_ms FROM runtime_bindings WHERE id=?",
        )
        .run(secondAgent.id, binding.id),
    ).toThrow("UNIQUE constraint failed");
    store.close();
  });
  test("consumes a Crockford claim once and retries idempotently for its owning session", () => {
    const store = fixture(),
      agent = store.createAgent("claimed-agent"),
      requester = authenticated(store),
      claim = store.createClaim(agent.id, requester.id),
      now = Date.now();
    store.db
      .query(
        "INSERT INTO runtime_installations(id,harness_id,adapter_id,label,endpoint_json,state,created_at_ms,updated_at_ms) VALUES(?,?,?,?,?,'offline',?,?)",
      )
      .run("ins_other", "other", "test.other", "other", "{}", now, now);
    const binding = store.claim(claim.claimCode, "claimed-thread", {
      installationId: "ins_other",
    });
    expect(claim.claimCode).toMatch(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{26}$/);
    expect(binding.agentId).toBe(agent.id);
    expect(binding.idempotent).toBe(false);
    expect(binding.rebound).toBe(false);
    expect(store.claim(claim.claimCode, "claimed-thread", { installationId: "ins_other" })).toEqual(
      { ...binding, idempotent: true },
    );
    expect(() =>
      store.claim(claim.claimCode, "replayed-thread", { installationId: "ins_other" }),
    ).toThrow("CLAIM_CONSUMED");
    expect(store.binding(binding.id)?.session_opaque_id).toBe("claimed-thread");
    expect(store.binding(binding.id)?.installation_id).toBe("ins_other");
    store.close();
  });
  test("allows only one competing claim consumer", async () => {
    const store = fixture(),
      agent = store.createAgent("claim-race"),
      requester = authenticated(store),
      claim = store.createClaim(agent.id, requester.id),
      results = await Promise.allSettled(
        ["race-one", "race-two"].map((sessionId) =>
          Promise.resolve().then(() => store.claim(claim.claimCode, sessionId)),
        ),
      );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")?.reason).toMatchObject({
      message: expect.stringContaining("CLAIM_CONSUMED"),
    });
    store.close();
  });
  test("classifies expired claims and rolls back consumption when binding fails", () => {
    const store = fixture(),
      requester = authenticated(store),
      expiredAgent = store.createAgent("expired-claim"),
      expired = store.createClaim(expiredAgent.id, requester.id);
    store.db
      .query("UPDATE binding_claims SET created_at_ms=?,expires_at_ms=? WHERE id=?")
      .run(Date.now() - 2_000, Date.now() - 1_000, expired.claimId);
    expect(() => store.claim(expired.claimCode, "expired-thread")).toThrow("CLAIM_EXPIRED");

    const owner = store.createAgent("session-owner"),
      target = store.createAgent("atomic-claim"),
      claim = store.createClaim(target.id, requester.id);
    store.bind(owner.id, "occupied-thread");
    expect(() => store.claim(claim.claimCode, "occupied-thread")).toThrow(
      "session already belongs to another agent",
    );
    expect(store.claim(claim.claimCode, "free-thread").agentId).toBe(target.id);
    store.close();
  });
  test("requires explicit rebind and fences retries through the old claim", () => {
    const store = fixture(),
      agent = store.createAgent("rebound-claim"),
      requester = authenticated(store),
      oldClaim = store.createClaim(agent.id, requester.id),
      oldBinding = store.claim(oldClaim.claimCode, "old-thread"),
      newClaim = store.createClaim(agent.id, requester.id);
    expect(() => store.claim(newClaim.claimCode, "new-thread")).toThrow("rebind required");
    const rebound = store.claim(newClaim.claimCode, "new-thread", { revokeExisting: true });
    expect(rebound).toMatchObject({ epoch: oldBinding.epoch + 1, rebound: true });
    expect(store.binding(oldBinding.id)?.status).toBe(BindingState.Revoked);
    expect(() => store.claim(oldClaim.claimCode, "old-thread")).toThrow("STALE_BINDING");
    store.close();
  });
  test("distinguishes replacing an active binding from binding after revocation", () => {
    const store = fixture(),
      agent = store.createAgent("rebind-classification"),
      first = store.bind(agent.id, "first-thread");
    expect(first.rebound).toBe(false);
    const replacement = store.bind(agent.id, "replacement-thread", { revokeExisting: true });
    expect(replacement.rebound).toBe(true);
    store.revokeBinding(replacement.id);
    const afterRevocation = store.bind(agent.id, "after-revocation-thread");
    expect(afterRevocation.epoch).toBe(3);
    expect(afterRevocation.rebound).toBe(false);
    store.close();
  });
  test("reports observed active runtime sessions by state", () => {
    const store = fixture(),
      agent = store.createAgent("observed-agent"),
      binding = store.bind(agent.id, "observed-thread"),
      storedBinding = store.binding(binding.id);
    if (!storedBinding) throw new Error("missing stored binding");
    store.observeSession({
      session: { installationId: storedBinding.installation_id, opaqueId: "observed-thread" },
      runtimeState: "active",
      blockingReason: "none",
      interactivePresence: "present",
      observedAt: new Date().toISOString(),
      attributes: {},
    });
    expect(
      store
        .metrics()
        .find(
          (point) =>
            point.name === "acs_runtime_sessions_by_state" && point.labels.state === "active",
        ),
    ).toMatchObject({ value: 1 });
    store.revokeBinding(binding.id);
    expect(
      store
        .metrics()
        .find(
          (point) =>
            point.name === "acs_runtime_sessions_by_state" && point.labels.state === "active",
        ),
    ).toMatchObject({ value: 0 });
    store.close();
  });
  test("uses delivery defaults and queues subscribed terminal notifications", () => {
    const store = fixture(),
      sender = store.createAgent("sender"),
      target = store.createAgent("target"),
      senderBinding = store.bind(sender.id, "sender-thread"),
      targetBinding = store.bind(target.id, "target-thread");
    const message = Message.fromJSON({
      messageId: "request-2",
      role: Role.ROLE_USER,
      parts: [{ text: "work" }],
    });
    const accepted = store.accept(target.id, senderBinding.principalId, message, {
      mode: "direct",
      priority: "normal",
      notifyOn: ["terminal"],
      replyExpected: true,
    });
    store.setTaskState(accepted.task.id, targetBinding.principalId, TaskState.Working);
    store.setTaskState(
      accepted.task.id,
      targetBinding.principalId,
      TaskState.InputRequired,
      "continue",
    );
    store.accept(
      target.id,
      senderBinding.principalId,
      Message.fromJSON({
        messageId: "request-2-continuation",
        taskId: accepted.task.id,
        contextId: accepted.task.contextId,
        role: Role.ROLE_USER,
        parts: [{ text: "continued" }],
      }),
      { notifyOn: ["terminal"] },
    );
    store.setTaskState(accepted.task.id, targetBinding.principalId, TaskState.Completed, "done");
    const notifications = store.db
      .query<
        {
          kind: string;
          target_agent_id: string;
          pinned_binding_id: string;
          state: string;
        },
        []
      >(
        "SELECT kind,target_agent_id,pinned_binding_id,state FROM delivery_intents WHERE kind='task-event-notification'",
      )
      .all();
    expect(notifications).toEqual([
      {
        kind: "task-event-notification",
        target_agent_id: sender.id,
        pinned_binding_id: senderBinding.id,
        state: "pending",
      },
    ]);
    store.close();
  });
  test("allows only the assigned agent to publish and complete work", () => {
    const store = fixture(),
      target = store.createAgent("worker"),
      stranger = store.createAgent("stranger"),
      targetBinding = store.bind(target.id, "worker-thread"),
      strangerBinding = store.bind(stranger.id, "stranger-thread"),
      requester = authenticated(store);
    const accepted = store.accept(
      target.id,
      requester.id,
      Message.fromJSON({ messageId: "request-3", role: Role.ROLE_USER, parts: [{ text: "work" }] }),
      {},
    );
    const output: StoredPart[] = [
      { content: { $case: "text", value: "done" }, filename: "", mediaType: "text/plain" },
    ];
    expect(() =>
      store.publishMessage(accepted.task.id, strangerBinding.principalId, output),
    ).toThrow("TASK_NOT_ASSIGNED");
    expect(
      store.publishMessage(accepted.task.id, targetBinding.principalId, output).task.status?.state,
    ).toBe(A2ATaskState.TASK_STATE_WORKING);
    expect(
      store.setTaskState(accepted.task.id, targetBinding.principalId, TaskState.Completed, "done")
        .status?.state,
    ).toBe(A2ATaskState.TASK_STATE_COMPLETED);
    const terminalVersion = store.taskVersion(accepted.task.id),
      terminalEvents = store.eventsAfter(accepted.task.id, 0).length;
    expect(
      store.setTaskState(accepted.task.id, targetBinding.principalId, TaskState.Completed, "done")
        .status?.state,
    ).toBe(A2ATaskState.TASK_STATE_COMPLETED);
    expect(store.taskVersion(accepted.task.id)).toBe(terminalVersion);
    expect(store.eventsAfter(accepted.task.id, 0)).toHaveLength(terminalEvents);
    expect(() =>
      store.setTaskState(
        accepted.task.id,
        targetBinding.principalId,
        TaskState.Completed,
        "different",
      ),
    ).toThrow("TASK_STATE_CONFLICT");
    store.close();
  });
  test("rejects executor callbacks from a rebound session after delivery was pinned", () => {
    const store = fixture(),
      target = store.createAgent("rebound-worker"),
      first = store.bind(target.id, "old-thread"),
      requester = authenticated(store),
      accepted = store.accept(
        target.id,
        requester.id,
        Message.fromJSON({
          messageId: "request-4",
          role: Role.ROLE_USER,
          parts: [{ text: "work" }],
        }),
        { mode: "direct" },
      );
    store.db
      .query("UPDATE delivery_intents SET pinned_binding_id=?,pinned_binding_epoch=? WHERE id=?")
      .run(first.id, first.epoch, accepted.deliveryId);
    expect(() => store.bind(target.id, "new-thread")).toThrow("BINDING_CONFLICT");
    const rebound = store.bind(target.id, "new-thread", { revokeExisting: true });
    expect(
      store.db
        .query<{ disabled_at_ms: number | null }, [string]>(
          "SELECT disabled_at_ms FROM principals WHERE id=?",
        )
        .get(first.principalId)?.disabled_at_ms,
    ).toBeNumber();
    expect(
      store.db
        .query<{ pinned_binding_id: string; pinned_binding_epoch: number }, [string]>(
          "SELECT pinned_binding_id,pinned_binding_epoch FROM delivery_intents WHERE id=?",
        )
        .get(accepted.deliveryId),
    ).toEqual({ pinned_binding_id: first.id, pinned_binding_epoch: first.epoch });
    expect(() =>
      store.setTaskState(
        accepted.task.id,
        rebound.principalId,
        TaskState.Completed,
        "wrong session",
      ),
    ).toThrow("TASK_NOT_ASSIGNED");
    store.close();
  });
});
