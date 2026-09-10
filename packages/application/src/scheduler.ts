import {
  DeliveryAttemptOutcome,
  DeliveryState,
  deriveAgentState,
  id,
  RuntimeExecutionState,
  TaskState,
  transitionDelivery,
  transitionRuntimeExecution,
} from "../../domain/src/index";
import type {
  BindingRow,
  DeliveryIntentRow,
  DeliveryStoragePort,
  StoredMessage,
  StoredPart,
} from "../../ports/src/index";
import type {
  BindingId,
  DeliveryId,
  RuntimeAdapter,
  RuntimeAdapterContext,
  RuntimeCapabilities,
  RuntimeDeliveryEnvelopeV1,
  RuntimeDeliveryRequest,
  RuntimeEvent,
  RuntimeExecutionRef,
  RuntimeInstallationId,
  RuntimeExecutionId,
  RuntimeSessionSnapshot,
  NeutralPart,
  JsonObject,
  RuntimeTraceContext,
} from "../../../contracts/runtime-adapter";
import { telemetry } from "../../observability/src/index";

type DeliveryPayload =
  | {
      taskId: string;
      contextId: string;
      message: StoredMessage;
      replyExpected: boolean;
      traceContext?: RuntimeTraceContext;
    }
  | { taskId: string; contextId: string; state: string; sequence: number; summary: string };
type PartiesRow = {
  display_name: string;
  requester_principal_kind: string;
  actor_principal_kind: string | null;
  actor_agent_id: string | null;
  actor_slug: string | null;
  actor_display_name: string | null;
  requester_agent_id: string | null;
  requester_slug: string | null;
};
type ExecutionRow = {
  id: RuntimeExecutionId;
  task_id: `tsk_${string}`;
  binding_id: BindingId;
  state: RuntimeExecutionState;
  relationship: "started" | "joined" | "unknown";
};
type ReconciliationRow = {
  id: DeliveryId;
  task_id: `tsk_${string}`;
  kind: "a2a-message" | "task-event-notification";
  payload_hash: string;
  pinned_binding_id: BindingId;
  pinned_binding_epoch: number;
  installation_id: RuntimeInstallationId;
  session_opaque_id: string;
  reconciliation_token: string;
};
type SchedulerOptions = {
  concurrency: number;
  leaseMs: number;
  retryBaseMs: number;
  retryCapMs: number;
  reconnectMs: number;
  offlineRetentionMs?: number;
};

export class DeliveryConcurrency {
  private inFlight = 0;
  constructor(private limit: number) {}
  tryAcquire() {
    if (this.inFlight >= this.limit) return false;
    this.inFlight++;
    return true;
  }
  release() {
    this.inFlight--;
  }
}

export class DeliveryScheduler {
  private timer?: Timer;
  private scheduling = false;
  private abort = new AbortController();
  private observeTask?: Promise<void>;
  private lanes = new Set<string>();
  private inFlight = new Set<Promise<void>>();
  private context?: RuntimeAdapterContext;
  private connected = false;
  private capabilities: RuntimeCapabilities;
  private nextConnectAt = 0;
  private reconnectAttempts = 0;
  private nextReapAt = 0;
  private pendingExecutionEvents: RuntimeEvent[] = [];
  constructor(
    private store: DeliveryStoragePort,
    private adapter: RuntimeAdapter,
    private instanceId: string,
    options: Partial<SchedulerOptions> = {},
    private installationId?: RuntimeInstallationId,
    private sharedConcurrency?: DeliveryConcurrency,
  ) {
    this.options = {
      concurrency: 16,
      leaseMs: 30_000,
      retryBaseMs: 250,
      retryCapMs: 30_000,
      reconnectMs: 2000,
      offlineRetentionMs: 24 * 60 * 60 * 1000,
      ...options,
    };
    this.capabilities = adapter.descriptor.capabilities;
  }
  private options: SchedulerOptions;

  async start() {
    const installation = this.installationId
      ? { id: this.installationId }
      : required(
          this.store
            .query<{ id: RuntimeInstallationId }, [string]>(
              "SELECT id FROM runtime_installations WHERE adapter_id=? LIMIT 1",
            )
            .get(this.adapter.descriptor.adapterId),
          "runtime installation",
        );
    this.context = {
      installationId: installation.id,
      instanceId: this.instanceId,
      clock: { now: () => new Date().toISOString() },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      assertBindingFence: async (bindingId, epoch) => {
        const valid = Boolean(
          this.store
            .query("SELECT 1 FROM runtime_bindings WHERE id=? AND epoch=? AND status='active'")
            .get(bindingId, epoch),
        );
        return valid ? { valid: true } : { valid: false, reason: "stale" };
      },
    };
    this.recoverExpiredLeases();
    const reconciled = await this.connect();
    if (!this.connected || reconciled) await this.reap();
    this.timer = setInterval(() => void this.tick(), 250);
  }
  signal() {
    void this.tick();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.abort.abort();
    await Promise.allSettled(this.inFlight);
    await this.adapter.stop({ reason: "shutdown" });
    await this.observeTask;
    this.pendingExecutionEvents.length = 0;
  }
  private async tick() {
    if (this.scheduling) return;
    this.scheduling = true;
    try {
      if (!this.connected) {
        if (Date.now() >= this.nextConnectAt) await this.connect();
        if (!this.connected) {
          await this.reap();
          return;
        }
      }
      await this.reap();
      if (await this.reconcileOne()) return;
      if (await this.cancelOne()) return;
      while (this.inFlight.size < this.options.concurrency) {
        if (this.sharedConcurrency && !this.sharedConcurrency.tryAcquire()) break;
        let intent: DeliveryIntentRow | null;
        try {
          intent = this.lease();
        } catch (error) {
          this.sharedConcurrency?.release();
          throw error;
        }
        if (!intent) {
          this.sharedConcurrency?.release();
          break;
        }
        this.lanes.add(intent.target_agent_id);
        const work = this.deliver(intent)
          .catch((error: unknown) => {
            this.recoverDeliveryError(
              intent.id,
              error instanceof Error
                ? (error.message.split(":").at(0) ?? "delivery-error")
                : "delivery-error",
              retryDelay(
                intent.attempt_count + 1,
                Math.random,
                this.options.retryBaseMs,
                this.options.retryCapMs,
              ),
            );
          })
          .finally(() => {
            this.lanes.delete(intent.target_agent_id);
            this.inFlight.delete(work);
            this.sharedConcurrency?.release();
          });
        this.inFlight.add(work);
        void work;
      }
    } finally {
      this.scheduling = false;
    }
  }
  private async reconcileOne() {
    const now = Date.now(),
      row = this.store
        .query<ReconciliationRow, [number, RuntimeInstallationId]>(
          "SELECT i.id,i.task_id,i.kind,i.payload_hash,i.pinned_binding_id,i.pinned_binding_epoch,b.installation_id,b.session_opaque_id,a.reconciliation_token FROM delivery_intents i JOIN runtime_bindings b ON b.id=i.pinned_binding_id JOIN delivery_attempts a ON a.intent_id=i.id AND a.attempt_number=i.attempt_count WHERE i.state='acceptance-unknown' AND i.not_before_ms<=? AND b.installation_id=? AND a.reconciliation_token IS NOT NULL LIMIT 1",
        )
        .get(now, required(this.context, "adapter context").installationId);
    if (!row) return false;
    const result = await this.adapter.reconcile(
      {
        deliveryId: row.id,
        target: {
          session: {
            installationId: row.installation_id,
            opaqueId: row.session_opaque_id,
          },
          bindingId: row.pinned_binding_id,
          bindingEpoch: row.pinned_binding_epoch,
        },
        payloadHash: row.payload_hash,
        reconciliationToken: row.reconciliation_token,
      },
      this.abort.signal,
    );
    if (result.outcome === "accepted") {
      const executionId = result.execution ? id("exe") : null;
      this.store.write(() => {
        const accepted = transitionDelivery(
          DeliveryState.AcceptanceUnknown,
          DeliveryState.Accepted,
        );
        this.store
          .query(
            "UPDATE delivery_intents SET state=?,state_reason=NULL,runtime_execution_id=?,updated_at_ms=? WHERE id=? AND state='acceptance-unknown'",
          )
          .run(accepted, executionId, now, row.id);
        if (result.execution)
          this.store
            .query(
              "INSERT OR IGNORE INTO runtime_executions(id,intent_id,binding_id,binding_epoch,runtime_execution_opaque_id,relationship,state,accepted_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              required(executionId, "runtime execution id"),
              row.id,
              row.pinned_binding_id,
              row.pinned_binding_epoch,
              result.execution.opaqueId,
              result.execution.relationship ?? "unknown",
              RuntimeExecutionState.Accepted,
              now,
              now,
            );
      });
      if (result.execution)
        this.replayExecutionEvents({
          opaqueId: result.execution.opaqueId,
          session: {
            installationId: row.installation_id,
            opaqueId: row.session_opaque_id,
          },
        });
    } else if (result.outcome === "not-accepted") {
      const state = transitionDelivery(
        DeliveryState.AcceptanceUnknown,
        result.safeToRetry ? DeliveryState.Pending : DeliveryState.FailedTerminal,
      );
      this.store
        .query(
          "UPDATE delivery_intents SET state=?,state_reason=?,not_before_ms=?,updated_at_ms=? WHERE id=? AND state='acceptance-unknown'",
        )
        .run(state, result.safeToRetry ? null : "reconciliation-not-accepted", now, now, row.id);
    } else {
      this.store
        .query(
          "UPDATE delivery_intents SET state_reason=?,not_before_ms=?,updated_at_ms=? WHERE id=? AND state='acceptance-unknown'",
        )
        .run(result.reason, now + 30_000, now, row.id);
    }
    return true;
  }
  private async connect() {
    try {
      await this.adapter.start(required(this.context, "adapter context"));
      const probe = await this.adapter.probe();
      this.capabilities = probe.capabilities;
      this.store.observeRuntime(required(this.context, "adapter context").installationId, probe);
      this.connected = true;
      this.reconnectAttempts = 0;
      this.observeTask = this.observe();
      try {
        await this.reconcileBoundSessions();
        return true;
      } catch {
        return false;
      }
    } catch {
      this.store.markRuntimeOffline(required(this.context, "adapter context").installationId);
      this.scheduleReconnect();
      return false;
    }
  }
  private async reconcileBoundSessions() {
    const installationId = required(this.context, "adapter context").installationId,
      sessions = this.store
        .query<{ session_opaque_id: string }, [RuntimeInstallationId]>(
          "SELECT session_opaque_id FROM runtime_bindings WHERE installation_id=? AND status='active'",
        )
        .all(installationId);
    for (const row of sessions) {
      const snapshot = await this.adapter.inspectSession({
        installationId,
        opaqueId: row.session_opaque_id,
      });
      this.observeSession(snapshot);
    }
  }
  private scheduleReconnect() {
    this.nextConnectAt =
      Date.now() +
      retryDelay(
        ++this.reconnectAttempts,
        Math.random,
        this.options.reconnectMs,
        this.options.retryCapMs,
      );
  }
  private async cancelOne() {
    const task = this.store
      .query<
        {
          task_id: `tsk_${string}`;
          requester_principal_id: `prn_${string}`;
        },
        [RuntimeInstallationId]
      >(
        "SELECT t.id task_id,t.requester_principal_id FROM a2a_tasks t WHERE t.cancellation_requested=1 AND t.state NOT IN ('completed','failed','canceled','rejected') AND EXISTS(SELECT 1 FROM delivery_intents i LEFT JOIN runtime_bindings p ON p.id=i.pinned_binding_id LEFT JOIN runtime_bindings b ON b.agent_id=i.target_agent_id AND b.status='active' WHERE i.task_id=t.id AND i.kind='a2a-message' AND coalesce((SELECT eb.installation_id FROM runtime_executions e JOIN runtime_bindings eb ON eb.id=e.binding_id WHERE e.intent_id=i.id AND e.relationship='started' AND e.state IN ('accepted','started','awaiting-local-input') LIMIT 1),CASE WHEN p.status='active' OR p.continuity_policy='strict' THEN p.installation_id ELSE b.installation_id END)=?) AND NOT EXISTS(SELECT 1 FROM delivery_intents i WHERE i.task_id=t.id AND i.kind='a2a-message' AND i.state IN ('leased','attempting','acceptance-unknown')) LIMIT 1",
      )
      .get(required(this.context, "adapter context").installationId);
    if (!task) return false;
    const row = this.store
      .query<
        {
          id: RuntimeExecutionId;
          runtime_execution_opaque_id: string;
          binding_id: BindingId;
          binding_epoch: number;
          installation_id: RuntimeInstallationId;
          session_opaque_id: string;
          delivery_policy_json: string;
          state: RuntimeExecutionState;
        },
        [`tsk_${string}`, RuntimeInstallationId]
      >(
        "SELECT e.id,e.runtime_execution_opaque_id,e.binding_id,e.binding_epoch,e.state,b.installation_id,b.session_opaque_id,b.delivery_policy_json FROM runtime_executions e JOIN delivery_intents i ON i.id=e.intent_id JOIN runtime_bindings b ON b.id=e.binding_id WHERE i.task_id=? AND b.installation_id=? AND i.kind='a2a-message' AND e.relationship='started' AND e.state IN ('accepted','started','awaiting-local-input') AND NOT EXISTS(SELECT 1 FROM runtime_executions e2 WHERE e2.binding_id=e.binding_id AND e2.runtime_execution_opaque_id=e.runtime_execution_opaque_id AND e2.id<>e.id AND e2.state IN ('accepted','started','awaiting-local-input')) LIMIT 1",
      )
      .get(task.task_id, required(this.context, "adapter context").installationId);
    if (
      row &&
      this.capabilities.cancelOwnedExecution &&
      interruptOnCancel(row.delivery_policy_json)
    ) {
      const result = await this.adapter.cancel(
        {
          execution: {
            normalizedId: row.id,
            opaqueId: row.runtime_execution_opaque_id,
            session: {
              installationId: row.installation_id,
              opaqueId: row.session_opaque_id,
            },
            bindingId: row.binding_id,
            bindingEpoch: row.binding_epoch,
          },
          reason: "A2A cancellation requested",
        },
        this.abort.signal,
      );
      if (result.outcome === "accepted" || result.outcome === "not-running") {
        this.store.write(() => {
          const interrupted = transitionRuntimeExecution(
              row.state,
              RuntimeExecutionState.Interrupted,
            ),
            now = Date.now();
          this.store
            .query(
              "UPDATE runtime_executions SET state=?,completed_at_ms=?,updated_at_ms=? WHERE id=? AND state IN ('accepted','started','awaiting-local-input')",
            )
            .run(interrupted, now, now, row.id);
        });
      }
    }
    const ambiguous = this.store
      .query<{ value: number }, [`tsk_${string}`]>(
        "SELECT exists(SELECT 1 FROM delivery_intents WHERE task_id=? AND kind='a2a-message' AND state='acceptance-unknown') value",
      )
      .get(task.task_id)?.value;
    if (!ambiguous) {
      try {
        this.store.setTaskState(
          task.task_id,
          task.requester_principal_id,
          TaskState.Canceled,
          "Canceled by requester",
        );
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("TASK_STATE_CONFLICT"))
          throw error;
      }
    }
    return true;
  }
  private lease() {
    return telemetry.traceSync("delivery.lease", () =>
      this.store.write(() => {
        const now = Date.now();
        const expired = this.store
          .query<DeliveryIntentRow, [number]>(
            "SELECT * FROM delivery_intents WHERE state NOT IN ('accepted','failed-terminal','canceled','superseded') AND deadline_ms IS NOT NULL AND deadline_ms<=?",
          )
          .all(now);
        for (const intent of expired) {
          const status = parsePreemption(intent.preemption_status_json);
          if (
            status.requested &&
            ["attempted", "pending-confirmation", "unresolved"].includes(status.state)
          )
            this.setPreemption(
              intent.id,
              {
                ...status,
                state: "unresolved",
                reason: "deadline-expired",
              },
              true,
            );
          this.store
            .query(
              "UPDATE delivery_intents SET state=?,state_reason='deadline-expired',lease_owner=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=? AND state NOT IN ('accepted','failed-terminal','canceled','superseded')",
            )
            .run(transitionDelivery(intent.state, DeliveryState.FailedTerminal), now, intent.id);
        }
        const rows = this.store
            .query<
              DeliveryIntentRow,
              [number, number, number, number, RuntimeInstallationId, number]
            >(
              "SELECT * FROM (SELECT i.*,row_number() OVER (PARTITION BY i.target_agent_id ORDER BY CASE WHEN ? - i.created_at_ms >= 60000 THEN 1 ELSE 0 END DESC,i.priority DESC,i.not_before_ms,i.created_at_ms) lane_rank FROM delivery_intents i LEFT JOIN runtime_bindings p ON p.id=i.pinned_binding_id LEFT JOIN runtime_bindings b ON b.agent_id=i.target_agent_id AND b.status='active' WHERE i.state IN ('pending','deferred') AND i.not_before_ms<=? AND (i.deadline_ms IS NULL OR i.deadline_ms>?) AND (i.lease_expires_at_ms IS NULL OR i.lease_expires_at_ms<=?) AND CASE WHEN p.status='active' OR p.continuity_policy='strict' THEN p.installation_id ELSE b.installation_id END=? AND NOT EXISTS(SELECT 1 FROM delivery_intents active WHERE active.target_agent_id=i.target_agent_id AND active.id<>i.id AND active.state IN ('leased','attempting'))) WHERE lane_rank=1 ORDER BY CASE WHEN ? - created_at_ms >= 60000 THEN 1 ELSE 0 END DESC,priority DESC,not_before_ms,created_at_ms LIMIT 100",
            )
            .all(now, now, now, now, required(this.context, "adapter context").installationId, now),
          row = rows.find((item) => !this.lanes.has(item.target_agent_id));
        if (!row) return null;
        if (row.state === DeliveryState.Deferred) {
          row.state = transitionDelivery(row.state, DeliveryState.Pending);
          this.store
            .query("UPDATE delivery_intents SET state=?,updated_at_ms=? WHERE id=?")
            .run(row.state, now, row.id);
        }
        row.state = transitionDelivery(row.state, DeliveryState.Leased);
        this.store
          .query(
            "UPDATE delivery_intents SET state=?,lease_owner=?,lease_generation=lease_generation+1,lease_expires_at_ms=?,updated_at_ms=? WHERE id=?",
          )
          .run(row.state, this.instanceId, now + this.options.leaseMs, now, row.id);
        return row;
      }),
    );
  }
  private async deliver(intent: DeliveryIntentRow) {
    if (intent.deadline_ms !== null && intent.deadline_ms <= Date.now()) return;
    const signal = deadlineSignal(this.abort.signal, intent.deadline_ms);
    const target = this.store.agent(intent.target_agent_id);
    if (!target?.enabled) return this.failTerminal(intent.id, "target-disabled");
    if (!this.capabilities.directDelivery)
      return this.defer(intent.id, "unsupported-capability", 30_000);
    const now = Date.now(),
      pinned = intent.pinned_binding_id
        ? this.store
            .query<BindingRow, [BindingId, number | null]>(
              "SELECT * FROM runtime_bindings WHERE id=? AND epoch=?",
            )
            .get(intent.pinned_binding_id, intent.pinned_binding_epoch)
        : undefined;
    if (pinned && pinned.status !== "active" && pinned.continuity_policy === "strict")
      return this.failTerminal(intent.id, "strict-binding-revoked");
    const binding =
      pinned?.status === "active"
        ? pinned
        : this.store
            .query<BindingRow, [`agt_${string}`]>(
              "SELECT * FROM runtime_bindings WHERE agent_id=? AND status='active'",
            )
            .get(intent.target_agent_id);
    if (!binding) return this.defer(intent.id, "offline", 30_000);
    const state = deriveAgentState({
      runtimeState: runtimeState(binding.last_observed_runtime_state),
      blockingReason: blockingReason(binding.last_observed_blocking_reason),
      interactivePresence: interactivePresence(binding.last_observed_interactive_presence),
    });
    if (!["ready", "working"].includes(state)) {
      const reason =
        state === "input-required" || state === "auth-required"
          ? "local-input"
          : state === "error" || state === "unknown"
            ? "unsupported-active-state"
            : state;
      return this.defer(intent.id, reason, 30_000);
    }
    if (await this.maybePreempt(intent, binding, signal)) return;
    const payload: DeliveryPayload = JSON.parse(intent.payload_json),
      isTaskEventNotification = intent.kind === "task-event-notification",
      parties = required(
        this.store
          .query<PartiesRow, [number, `tsk_${string}`]>(
            "SELECT p.display_name,p.kind requester_principal_kind,actor.kind actor_principal_kind,actor_agent.id actor_agent_id,actor_agent.slug actor_slug,actor.display_name actor_display_name,a.id requester_agent_id,a.slug requester_slug FROM a2a_tasks t JOIN principals p ON p.id=t.requester_principal_id LEFT JOIN agents a ON a.id=t.requester_agent_id LEFT JOIN task_events e ON e.task_id=t.id AND e.sequence=? LEFT JOIN principals actor ON actor.id=e.actor_principal_id LEFT JOIN agents actor_agent ON actor_agent.id=actor.agent_id WHERE t.id=?",
          )
          .get(
            isTaskEventNotification && "sequence" in payload ? payload.sequence : -1,
            intent.task_id,
          ),
        "delivery parties",
      ),
      provenance = deliveryProvenance(
        isTaskEventNotification ? parties.actor_principal_kind : parties.requester_principal_kind,
      );
    if (!provenance) return this.failTerminal(intent.id, "unsupported-requester-principal");
    const attempt = id("atm"),
      number = intent.attempt_count + 1;
    const startedAttempt = this.store.write(() => {
      const attempting = transitionDelivery(intent.state, DeliveryState.Attempting);
      const fenced = this.store
        .query("SELECT 1 FROM runtime_bindings WHERE id=? AND epoch=? AND status='active'")
        .get(binding.id, binding.epoch);
      if (!fenced) throw new Error("stale binding");
      const updated = this.store
        .query(
          "UPDATE delivery_intents SET state=?,pinned_binding_id=?,pinned_binding_epoch=?,attempt_count=?,updated_at_ms=? WHERE id=? AND state=? AND lease_owner=?",
        )
        .run(
          attempting,
          binding.id,
          binding.epoch,
          number,
          now,
          intent.id,
          intent.state,
          this.instanceId,
        );
      if (updated.changes !== 1) return false;
      this.store
        .query(
          "INSERT INTO delivery_attempts(id,intent_id,attempt_number,adapter_id,binding_id,binding_epoch,started_at_ms) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          attempt,
          intent.id,
          number,
          this.adapter.descriptor.adapterId,
          binding.id,
          binding.epoch,
          now,
        );
      return true;
    });
    if (!startedAttempt) return;
    const senderName = isTaskEventNotification
      ? (parties.actor_slug ?? parties.actor_display_name ?? "external")
      : (parties.requester_slug ?? parties.display_name);
    const envelope: RuntimeDeliveryEnvelopeV1 = {
      agentNotice: `${isTaskEventNotification ? "AGENT REPLY" : "AGENT MESSAGE"} from ${senderName} — ${provenance.workAuthority === "delegated" ? "authenticated ACS delegation within your existing permissions" : "external peer input with untrusted work authority"}.${activityMaintenancePrompt(isTaskEventNotification, "state" in payload ? payload.state : undefined)}`,
      schema: "urn:agent-communications:runtime-envelope:v1",
      deliveryId: intent.id,
      kind: isTaskEventNotification ? "a2a-task-event" : "a2a-message",
      from: isTaskEventNotification
        ? { agentId: parties.actor_agent_id ?? "external", name: senderName }
        : {
            agentId: parties.requester_agent_id ?? "external",
            name: senderName,
          },
      to: { agentId: target.id, name: target.slug },
      task: {
        id: payload.taskId,
        contextId: payload.contextId,
        state: "state" in payload ? payload.state : "submitted",
      },
      ...(isTaskEventNotification
        ? {
            event:
              "sequence" in payload
                ? { sequence: payload.sequence, state: payload.state, summary: payload.summary }
                : undefined,
          }
        : {
            message: {
              id: "message" in payload ? payload.message.messageId : "",
              parts: "message" in payload ? payload.message.parts.map(toNeutral) : [],
            },
            reply: {
              acknowledgeTool: "acs_task_acknowledge",
              completeTool: "acs_task_complete",
              failTool: "acs_task_fail",
              requestInputTool: "acs_task_request_input",
              taskId: payload.taskId,
              deliveryId: intent.id,
            },
          }),
      provenance,
    };
    const result = await this.runtimeDeliver(
      {
        deliveryId: intent.id,
        target: {
          session: {
            installationId: binding.installation_id,
            opaqueId: binding.session_opaque_id,
          },
          bindingId: binding.id,
          bindingEpoch: binding.epoch,
        },
        mode: "direct",
        envelope,
        payloadHash: intent.payload_hash,
        deadline: intent.deadline_ms ? new Date(intent.deadline_ms).toISOString() : undefined,
        traceContext: "message" in payload ? payload.traceContext : undefined,
        markRequestFlushed: () => {
          this.store
            .query(
              "UPDATE delivery_attempts SET request_flushed_at_ms=? WHERE id=? AND request_flushed_at_ms IS NULL",
            )
            .run(Date.now(), attempt);
        },
      },
      signal,
    );
    const completed = Date.now();
    const currentAttempt = this.store
      .query(
        "SELECT 1 FROM delivery_intents WHERE id=? AND state='attempting' AND lease_owner=? AND attempt_count=?",
      )
      .get(intent.id, this.instanceId, number);
    if (!currentAttempt) return;
    if (result.outcome === "accepted") {
      const execution = result.execution,
        executionId = execution ? id("exe") : null;
      this.store.write(() => {
        const accepted = transitionDelivery(DeliveryState.Attempting, DeliveryState.Accepted);
        this.store
          .query(
            "UPDATE delivery_intents SET state=?,state_reason=NULL,lease_owner=NULL,lease_expires_at_ms=NULL,runtime_execution_id=?,updated_at_ms=? WHERE id=?",
          )
          .run(accepted, executionId, completed, intent.id);
        this.store
          .query(
            "UPDATE delivery_attempts SET completed_at_ms=?,outcome=?,runtime_execution_opaque_id=?,evidence_json=? WHERE id=? AND outcome IS NULL",
          )
          .run(
            completed,
            DeliveryAttemptOutcome.Accepted,
            execution?.opaqueId ?? null,
            JSON.stringify(result.evidence),
            attempt,
          );
        if (execution)
          this.store
            .query(
              "INSERT INTO runtime_executions(id,intent_id,binding_id,binding_epoch,runtime_execution_opaque_id,relationship,state,accepted_at_ms,updated_at_ms) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              required(executionId, "runtime execution id"),
              intent.id,
              binding.id,
              binding.epoch,
              execution.opaqueId,
              execution.relationship ?? "unknown",
              RuntimeExecutionState.Accepted,
              completed,
              completed,
            );
      });
      if (execution)
        this.replayExecutionEvents({
          opaqueId: execution.opaqueId,
          session: {
            installationId: binding.installation_id,
            opaqueId: binding.session_opaque_id,
          },
        });
    } else if (result.outcome === "deferred") {
      this.store.write(() => {
        this.finishAttempt(attempt, DeliveryAttemptOutcome.Deferred, result.reason);
        this.defer(
          intent.id,
          result.reason,
          result.retryAfterMs ??
            retryDelay(number, Math.random, this.options.retryBaseMs, this.options.retryCapMs),
        );
      });
    } else if (result.outcome === "acceptance-unknown") {
      telemetry.increment("acs_acceptance_unknown_total");
      this.store.write(() => {
        this.finishAttempt(
          attempt,
          DeliveryAttemptOutcome.AcceptanceUnknown,
          result.ambiguity,
          result.reconciliationToken,
        );
        this.store
          .query(
            "UPDATE delivery_intents SET state=?,state_reason=?,lease_owner=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=?",
          )
          .run(
            transitionDelivery(DeliveryState.Attempting, DeliveryState.AcceptanceUnknown),
            result.ambiguity,
            completed,
            intent.id,
          );
      });
    } else {
      this.store.write(() => {
        this.finishAttempt(
          attempt,
          DeliveryAttemptOutcome.Rejected,
          result.reason,
          undefined,
          result.details,
        );
        if (result.retryable)
          this.defer(
            intent.id,
            result.reason,
            retryDelay(number, Math.random, this.options.retryBaseMs, this.options.retryCapMs),
          );
        else
          this.store
            .query(
              "UPDATE delivery_intents SET state=?,state_reason=?,lease_owner=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=?",
            )
            .run(
              transitionDelivery(DeliveryState.Attempting, DeliveryState.FailedTerminal),
              result.reason,
              completed,
              intent.id,
            );
      });
    }
    this.auditPreemptionDelivery(intent.id, result.outcome);
    if (
      result.outcome === "accepted" &&
      !isTaskEventNotification &&
      result.execution?.relationship === "started" &&
      this.capabilities.cancelOwnedExecution &&
      interruptOnCancel(binding.delivery_policy_json)
    )
      return;
    this.finishRequestedCancellation(intent.task_id);
  }
  private finishRequestedCancellation(taskId: `tsk_${string}`) {
    const row = this.store
      .query<
        {
          requester_principal_id: `prn_${string}`;
          state: TaskState;
          cancellation_requested: number;
          ambiguous: number;
        },
        [`tsk_${string}`]
      >(
        "SELECT t.requester_principal_id,t.state,t.cancellation_requested,exists(SELECT 1 FROM delivery_intents i WHERE i.task_id=t.id AND i.kind='a2a-message' AND i.state IN ('leased','attempting','acceptance-unknown')) ambiguous FROM a2a_tasks t WHERE t.id=?",
      )
      .get(taskId);
    if (
      !row?.cancellation_requested ||
      row.ambiguous ||
      [TaskState.Completed, TaskState.Failed, TaskState.Canceled, TaskState.Rejected].includes(
        row.state,
      )
    )
      return;
    this.store.setTaskState(taskId, row.requester_principal_id, TaskState.Canceled);
  }
  private async maybePreempt(
    intent: DeliveryIntentRow,
    recipient: BindingRow,
    signal: AbortSignal,
  ): Promise<boolean> {
    const status = parsePreemption(intent.preemption_status_json);
    if (!status.requested || status.state === "not-requested") return false;
    if (
      status.attempted &&
      ["attempted", "pending-confirmation", "unresolved"].includes(status.state)
    ) {
      const execution = preemptionExecution(status),
        target = preemptionTarget(status);
      if (!execution || !target || !this.adapter.reconcileInterrupt) {
        this.setPreemption(intent.id, { ...status, state: "unresolved" });
        return (this.defer(intent.id, "preemption-reconciliation", 30_000), true);
      }
      const result = await this.adapter.reconcileInterrupt(
        {
          target,
          execution,
          reconciliationToken: preemptionToken(status),
        },
        signal,
      );
      if (result.outcome === "pending-confirmation" || result.outcome === "unresolved") {
        this.setPreemption(intent.id, { ...status, state: result.outcome });
        this.defer(intent.id, "preemption-reconciliation", 30_000);
        return true;
      }
      this.setPreemption(intent.id, {
        ...status,
        state:
          result.outcome === "achieved"
            ? "achieved"
            : result.outcome === "terminal"
              ? "unnecessary"
              : "unresolved",
      });
      return false;
    }
    if (status.attempted || status.state !== "requested") return false;
    if (
      !this.capabilities.peerPreemption ||
      !this.adapter.findActiveExecution ||
      !this.adapter.interruptExecution
    ) {
      this.setPreemption(intent.id, {
        ...status,
        state: "downgraded",
        reason: "unsupported-runtime",
      });
      return false;
    }
    const sender = this.store
      .query<
        { principal_id: string; binding_id: BindingId; scopes_json: string; status: string },
        [`tsk_${string}`]
      >(
        "SELECT p.id principal_id,p.binding_id,p.scopes_json,b.status FROM a2a_tasks t JOIN principals p ON p.id=t.requester_principal_id JOIN runtime_bindings b ON b.id=p.binding_id WHERE t.id=? AND p.disabled_at_ms IS NULL",
      )
      .get(intent.task_id);
    if (!sender || sender.status !== "active" || !hasPreemptionScope(sender.scopes_json)) {
      this.store.audit(
        null,
        "delivery.preemption.authorization-denied",
        "delivery-intent",
        intent.id,
      );
      this.setPreemption(intent.id, {
        ...status,
        state: "downgraded",
        reason: "missing-sender-authority",
      });
      return false;
    }
    if (!allowPeerPreemption(recipient.delivery_policy_json)) {
      this.store.audit(
        sender.principal_id,
        "delivery.preemption.policy-denied",
        "delivery-intent",
        intent.id,
        {
          bindingId: recipient.id,
        },
      );
      this.setPreemption(intent.id, {
        ...status,
        state: "downgraded",
        reason: "recipient-opt-out",
      });
      return false;
    }
    this.store.audit(
      sender.principal_id,
      "delivery.preemption.authorized",
      "delivery-intent",
      intent.id,
      {
        bindingId: recipient.id,
        bindingEpoch: recipient.epoch,
      },
    );
    const target = {
      session: { installationId: recipient.installation_id, opaqueId: recipient.session_opaque_id },
      bindingId: recipient.id,
      bindingEpoch: recipient.epoch,
    } as const;
    const found = await this.adapter.findActiveExecution({ target }, this.abort.signal);
    if (found.outcome !== "found") {
      this.setPreemption(intent.id, {
        ...status,
        state: found.outcome === "unsupported" ? "downgraded" : "unnecessary",
        reason: found.outcome === "unsupported" ? "unsupported-runtime" : "no-active-execution",
      });
      return false;
    }
    this.setPreemption(intent.id, {
      ...status,
      attempted: true,
      state: "attempted",
      execution: found.execution,
      target,
    });
    const result = await this.adapter.interruptExecution(
      {
        target,
        execution: found.execution,
        reason: "Authorized peer delivery",
        assertAuthorityFence: async () => ({
          valid: Boolean(
            this.store
              .query<{ value: number }, [string, BindingId, BindingId, number]>(
                "SELECT exists(SELECT 1 FROM principals p JOIN runtime_bindings b ON b.id=p.binding_id WHERE p.id=? AND p.binding_id=? AND p.disabled_at_ms IS NULL AND b.status='active' AND exists(SELECT 1 FROM json_each(p.scopes_json) WHERE value='a2a:preempt')) AND exists(SELECT 1 FROM runtime_bindings WHERE id=? AND epoch=? AND status='active' AND json_extract(delivery_policy_json,'$.allowPeerPreemption')=1) value",
              )
              .get(sender.principal_id, sender.binding_id, recipient.id, recipient.epoch)?.value,
          ),
        }),
      },
      signal,
    );
    const next =
      result.outcome === "achieved"
        ? { state: "achieved" }
        : result.outcome === "pending-confirmation"
          ? {
              state: "pending-confirmation",
              reconciliationToken: result.reconciliationToken,
              execution: found.execution,
              target,
            }
          : result.outcome === "unnecessary"
            ? { state: "unnecessary", reason: result.reason }
            : result.outcome === "rejected"
              ? { state: "downgraded", reason: result.reason }
              : {
                  state: "downgraded",
                  reason: result.outcome === "stale-fence" ? "stale-fence" : "unsupported-runtime",
                };
    this.setPreemption(intent.id, { ...status, attempted: true, ...next });
    if (result.outcome === "pending-confirmation") {
      this.defer(intent.id, "preemption-reconciliation", 30_000);
      return true;
    }
    return false;
  }
  private setPreemption(
    intentId: DeliveryId,
    status: Record<string, unknown>,
    allowExpired = false,
  ) {
    const encoded = JSON.stringify(status),
      row = this.store
        .query<{ preemption_status_json: string; deadline_ms: number | null }, [DeliveryId]>(
          "SELECT preemption_status_json,deadline_ms FROM delivery_intents WHERE id=?",
        )
        .get(intentId),
      previous = row?.preemption_status_json;
    if (!row || (!allowExpired && row.deadline_ms !== null && row.deadline_ms <= Date.now()))
      return;
    let changed = false;
    this.store.write(() => {
      const now = Date.now();
      const updated = this.store
        .query(
          allowExpired
            ? "UPDATE delivery_intents SET preemption_status_json=?,updated_at_ms=? WHERE id=?"
            : "UPDATE delivery_intents SET preemption_status_json=?,updated_at_ms=? WHERE id=? AND (deadline_ms IS NULL OR deadline_ms>?)",
        )
        .run(...(allowExpired ? [encoded, now, intentId] : [encoded, now, intentId, now]));
      if (updated.changes !== 1 || previous === encoded) return;
      changed = true;
      const task = this.store
        .query<{ task_id: string }, [DeliveryId]>("SELECT task_id FROM delivery_intents WHERE id=?")
        .get(intentId);
      if (!task) return;
      const snapshot = this.store
        .query<{ a2a_snapshot_json: string; next_event_sequence: number }, [string]>(
          "SELECT a2a_snapshot_json,next_event_sequence FROM a2a_tasks WHERE id=?",
        )
        .get(task.task_id);
      if (!snapshot) return;
      this.store
        .query(
          "INSERT INTO task_events(id,task_id,sequence,event_type,actor_principal_id,payload_json,created_at_ms) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          id("evt"),
          task.task_id,
          snapshot.next_event_sequence,
          "delivery-deferred",
          null,
          JSON.stringify({ preemption: status, snapshot: JSON.parse(snapshot.a2a_snapshot_json) }),
          now,
        );
      this.store
        .query("UPDATE a2a_tasks SET next_event_sequence=next_event_sequence+1 WHERE id=?")
        .run(task.task_id);
    });
    if (!changed) return;
    this.store.audit(
      null,
      `delivery.preemption.${String(status.state)}`,
      "delivery-intent",
      intentId,
      {
        requested: status.requested === true,
        attempted: status.attempted === true,
        reason: typeof status.reason === "string" ? status.reason : undefined,
      },
    );
    telemetry.increment("acs_peer_preemption_total", { state: String(status.state) });
  }
  private auditPreemptionDelivery(intentId: DeliveryId, outcome: string) {
    const row = this.store
      .query<{ preemption_status_json: string }, [DeliveryId]>(
        "SELECT preemption_status_json FROM delivery_intents WHERE id=?",
      )
      .get(intentId);
    if (!row || !parsePreemption(row.preemption_status_json).requested) return;
    this.store.audit(null, "delivery.preemption.delivery", "delivery-intent", intentId, {
      outcome,
    });
  }
  private defer(intentId: string, reason: string, delay: number) {
    const now = Date.now(),
      intent = required(
        this.store
          .query<DeliveryIntentRow, [string]>("SELECT * FROM delivery_intents WHERE id=?")
          .get(intentId),
        "delivery intent",
      ),
      deferred = transitionDelivery(intent.state, DeliveryState.Deferred);
    this.store
      .query(
        "UPDATE delivery_intents SET state=?,state_reason=?,not_before_ms=?,lease_owner=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=?",
      )
      .run(deferred, reason, now + delay, now, intentId);
  }
  private recoverDeliveryError(intentId: string, reason: string, delay: number) {
    this.store.write(() => {
      const row = this.store
        .query<
          {
            state: DeliveryState;
            attempt_id: string | null;
            request_flushed_at_ms: number | null;
            session_opaque_id: string | null;
          },
          [string]
        >(
          "SELECT i.state,a.id attempt_id,a.request_flushed_at_ms,b.session_opaque_id FROM delivery_intents i LEFT JOIN delivery_attempts a ON a.intent_id=i.id AND a.attempt_number=i.attempt_count LEFT JOIN runtime_bindings b ON b.id=a.binding_id WHERE i.id=?",
        )
        .get(intentId);
      if (!row || (row.state !== DeliveryState.Leased && row.state !== DeliveryState.Attempting))
        return;
      const unknown = row.state === DeliveryState.Attempting && row.request_flushed_at_ms !== null,
        now = Date.now(),
        next = unknown ? DeliveryState.AcceptanceUnknown : DeliveryState.Deferred;
      if (row.attempt_id)
        this.store
          .query(
            "UPDATE delivery_attempts SET completed_at_ms=?,outcome=?,error_code=?,reconciliation_token=? WHERE id=? AND outcome IS NULL",
          )
          .run(
            now,
            unknown ? DeliveryAttemptOutcome.AcceptanceUnknown : DeliveryAttemptOutcome.Deferred,
            reason,
            unknown && row.session_opaque_id ? `${row.session_opaque_id}:${intentId}` : null,
            row.attempt_id,
          );
      this.store
        .query(
          "UPDATE delivery_intents SET state=?,state_reason=?,not_before_ms=?,lease_owner=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=?",
        )
        .run(
          transitionDelivery(row.state, next),
          unknown ? "request-flushed-no-response" : reason,
          unknown ? now : now + delay,
          now,
          intentId,
        );
      if (unknown) telemetry.increment("acs_acceptance_unknown_total");
    });
  }
  private failTerminal(intentId: string, reason: string) {
    this.store.write(() => {
      const intent = required(
        this.store
          .query<DeliveryIntentRow, [string]>("SELECT * FROM delivery_intents WHERE id=?")
          .get(intentId),
        "delivery intent",
      );
      if (intent.state === DeliveryState.Leased) {
        intent.state = transitionDelivery(intent.state, DeliveryState.Pending);
        this.store
          .query("UPDATE delivery_intents SET state=?,updated_at_ms=? WHERE id=?")
          .run(intent.state, Date.now(), intentId);
      }
      const failed = transitionDelivery(intent.state, DeliveryState.FailedTerminal);
      this.store
        .query(
          "UPDATE delivery_intents SET state=?,state_reason=?,lease_owner=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=?",
        )
        .run(failed, reason, Date.now(), intentId);
    });
  }
  private async runtimeDeliver(request: RuntimeDeliveryRequest, signal: AbortSignal) {
    const started = performance.now();
    telemetry.increment("acs_delivery_attempts_total", {
      adapter: this.adapter.descriptor.adapterId,
    });
    const renew = setInterval(
      () => {
        const now = Date.now();
        this.store
          .query(
            "UPDATE delivery_intents SET lease_expires_at_ms=?,updated_at_ms=? WHERE id=? AND state='attempting' AND lease_owner=?",
          )
          .run(now + this.options.leaseMs, now, request.deliveryId, this.instanceId);
      },
      Math.max(25, Math.floor(this.options.leaseMs / 2)),
    );
    try {
      return await telemetry.trace("runtime.deliver", () => this.adapter.deliver(request, signal));
    } finally {
      clearInterval(renew);
      telemetry.observe("acs_delivery_latency_ms", performance.now() - started, {
        adapter: this.adapter.descriptor.adapterId,
      });
    }
  }
  private recoverExpiredLeases() {
    const now = Date.now();
    this.store.write(() => {
      const expired = this.store
        .query<
          DeliveryIntentRow & {
            recovered_attempt_id: string | null;
            request_flushed_at_ms: number | null;
            session_opaque_id: string | null;
          },
          [number]
        >(
          "SELECT i.*,a.id recovered_attempt_id,a.request_flushed_at_ms,b.session_opaque_id FROM delivery_intents i LEFT JOIN delivery_attempts a ON a.intent_id=i.id AND a.attempt_number=i.attempt_count LEFT JOIN runtime_bindings b ON b.id=a.binding_id WHERE i.state IN ('leased','attempting') AND i.lease_expires_at_ms<=?",
        )
        .all(now);
      for (const intent of expired) {
        const next =
          intent.state === DeliveryState.Attempting && intent.request_flushed_at_ms !== null
            ? DeliveryState.AcceptanceUnknown
            : DeliveryState.Pending;
        this.store
          .query(
            "UPDATE delivery_intents SET state=?,state_reason=?,lease_owner=NULL,lease_expires_at_ms=NULL,updated_at_ms=? WHERE id=?",
          )
          .run(
            transitionDelivery(intent.state, next),
            next === DeliveryState.AcceptanceUnknown ? "request-flushed-no-response" : null,
            now,
            intent.id,
          );
        if (intent.recovered_attempt_id)
          this.store
            .query(
              "UPDATE delivery_attempts SET completed_at_ms=?,outcome=?,error_code=?,reconciliation_token=? WHERE id=? AND outcome IS NULL",
            )
            .run(
              now,
              next === DeliveryState.AcceptanceUnknown
                ? DeliveryAttemptOutcome.AcceptanceUnknown
                : DeliveryAttemptOutcome.Deferred,
              next === DeliveryState.AcceptanceUnknown
                ? "request-flushed-no-response"
                : "lease-expired-before-write",
              next === DeliveryState.AcceptanceUnknown && intent.session_opaque_id
                ? `${intent.session_opaque_id}:${intent.id}`
                : null,
              intent.recovered_attempt_id,
            );
      }
    });
  }
  private finishAttempt(
    attempt: string,
    outcome: DeliveryAttemptOutcome,
    error: string,
    token?: string,
    details?: JsonObject,
  ) {
    this.store
      .query(
        "UPDATE delivery_attempts SET completed_at_ms=?,outcome=?,error_code=?,error_json=?,reconciliation_token=? WHERE id=? AND outcome IS NULL",
      )
      .run(
        Date.now(),
        outcome,
        error,
        details ? JSON.stringify(details) : null,
        token ?? null,
        attempt,
      );
  }
  private async observe() {
    for await (const event of this.adapter.observe(this.abort.signal)) {
      if (event.type === "adapter.connection" && event.state === "offline") {
        this.connected = false;
        this.store.markRuntimeOffline(required(this.context, "adapter context").installationId);
        this.scheduleReconnect();
        return;
      }
      this.project(event);
    }
  }
  private project(event: RuntimeEvent) {
    if (event.type === "session.observed") {
      this.observeSession(event.snapshot);
      return;
    }
    if (event.type === "execution.started") {
      const now = Date.now(),
        executions = this.executions(event.execution);
      if (!executions.length) return this.queueExecutionEvent(event);
      for (const execution of executions) {
        if (execution.state !== RuntimeExecutionState.Accepted) continue;
        this.store
          .query("UPDATE runtime_executions SET state=?,started_at_ms=?,updated_at_ms=? WHERE id=?")
          .run(
            transitionRuntimeExecution(execution.state, RuntimeExecutionState.Started),
            now,
            now,
            execution.id,
          );
      }
      return;
    }
    if (event.type === "execution.awaiting-local-input") {
      const executions = this.executions(event.execution);
      if (!executions.length) return this.queueExecutionEvent(event);
      this.store.write(() => {
        for (const execution of executions) {
          if (
            ![RuntimeExecutionState.Accepted, RuntimeExecutionState.Started].includes(
              execution.state,
            )
          )
            continue;
          if (execution.state === RuntimeExecutionState.Accepted) {
            execution.state = transitionRuntimeExecution(
              execution.state,
              RuntimeExecutionState.Started,
            );
            this.store
              .query(
                "UPDATE runtime_executions SET state=?,started_at_ms=?,updated_at_ms=? WHERE id=?",
              )
              .run(execution.state, Date.now(), Date.now(), execution.id);
          }
          execution.state = transitionRuntimeExecution(
            execution.state,
            RuntimeExecutionState.AwaitingLocalInput,
          );
          this.store
            .query("UPDATE runtime_executions SET state=?,updated_at_ms=? WHERE id=?")
            .run(execution.state, Date.now(), execution.id);
        }
      });
      return;
    }
    if (event.type !== "execution.completed") return;
    const executions = this.executions(event.execution);
    if (!executions.length) return this.queueExecutionEvent(event);
    const now = Date.now(),
      state =
        event.outcome === "completed"
          ? RuntimeExecutionState.Completed
          : event.outcome === "interrupted"
            ? RuntimeExecutionState.Interrupted
            : RuntimeExecutionState.Failed;
    this.store.write(() => {
      for (const execution of executions) {
        if (
          [
            RuntimeExecutionState.Completed,
            RuntimeExecutionState.Failed,
            RuntimeExecutionState.Interrupted,
          ].includes(execution.state)
        )
          continue;
        const completedState = transitionRuntimeExecution(execution.state, state);
        this.store
          .query(
            "UPDATE runtime_executions SET state=?,final_parts_json=?,completed_at_ms=?,updated_at_ms=? WHERE id=?",
          )
          .run(completedState, JSON.stringify(event.finalParts), now, now, execution.id);
      }
    });
  }
  private executions(reference: RuntimeExecutionRef) {
    return this.store
      .query<ExecutionRow, [string, RuntimeInstallationId, string]>(
        "SELECT e.*,i.task_id,b.id binding_id FROM runtime_executions e JOIN delivery_intents i ON i.id=e.intent_id JOIN runtime_bindings b ON b.id=e.binding_id WHERE e.runtime_execution_opaque_id=? AND b.installation_id=? AND b.session_opaque_id=?",
      )
      .all(reference.opaqueId, reference.session.installationId, reference.session.opaqueId);
  }
  private queueExecutionEvent(event: RuntimeEvent) {
    this.pendingExecutionEvents.push(event);
    if (this.pendingExecutionEvents.length > 256) this.pendingExecutionEvents.shift();
  }
  private replayExecutionEvents(reference: RuntimeExecutionRef) {
    const matching = this.pendingExecutionEvents.filter(
      (event) =>
        "execution" in event &&
        event.execution.opaqueId === reference.opaqueId &&
        event.execution.session.installationId === reference.session.installationId &&
        event.execution.session.opaqueId === reference.session.opaqueId,
    );
    this.pendingExecutionEvents = this.pendingExecutionEvents.filter(
      (event) => !matching.includes(event),
    );
    for (const event of matching) this.project(event);
    // A sibling delivery may already have projected completion while this
    // acceptance was in flight. Runtime lifecycle is shared by all its rows.
    const terminal = this.store
      .query<
        {
          state: RuntimeExecutionState;
          final_parts_json: string | null;
          completed_at_ms: number;
          updated_at_ms: number;
        },
        [string, RuntimeInstallationId, string]
      >(
        "SELECT e.state,e.final_parts_json,e.completed_at_ms,e.updated_at_ms FROM runtime_executions e JOIN runtime_bindings b ON b.id=e.binding_id WHERE e.runtime_execution_opaque_id=? AND b.installation_id=? AND b.session_opaque_id=? AND e.state IN ('completed','failed','interrupted') ORDER BY e.completed_at_ms DESC LIMIT 1",
      )
      .get(reference.opaqueId, reference.session.installationId, reference.session.opaqueId);
    if (terminal)
      this.store
        .query(
          "UPDATE runtime_executions SET state=?,final_parts_json=?,completed_at_ms=?,updated_at_ms=? WHERE runtime_execution_opaque_id=? AND binding_id IN (SELECT id FROM runtime_bindings WHERE installation_id=? AND session_opaque_id=?) AND state IN ('accepted','started','awaiting-local-input','unknown')",
        )
        .run(
          terminal.state,
          terminal.final_parts_json,
          terminal.completed_at_ms,
          terminal.updated_at_ms,
          reference.opaqueId,
          reference.session.installationId,
          reference.session.opaqueId,
        );
  }
  private observeSession(snapshot: RuntimeSessionSnapshot) {
    this.store.observeSession(snapshot);
    if (!["ready", "working"].includes(deriveAgentState(snapshot))) return;
    const now = Date.now();
    this.store
      .query(
        "UPDATE delivery_intents SET not_before_ms=?,updated_at_ms=? WHERE state='deferred' AND (state_reason IN ('offline','dormant','local-input','unsupported-active-state','route-unavailable','policy')) AND target_agent_id IN (SELECT agent_id FROM runtime_bindings WHERE installation_id=? AND session_opaque_id=? AND status='active')",
      )
      .run(now, now, snapshot.session.installationId, snapshot.session.opaqueId);
  }
  private async reap() {
    const now = Date.now();
    if (now < this.nextReapAt) return;
    this.nextReapAt = now + 60_000;
    const installationId = required(this.context, "adapter context").installationId;
    if (this.connected) {
      try {
        await this.reconcileBoundSessions();
      } catch {
        return;
      }
    }
    if (this.options.offlineRetentionMs === undefined) return;
    this.store.reapOfflineAgents(this.options.offlineRetentionMs, now, installationId);
  }
}

export function activityMaintenancePrompt(isTaskEventNotification: boolean, state?: string) {
  if (!isTaskEventNotification)
    return " When starting work, acknowledge with a concise peer-visible activity; update it when objective or scope materially changes, refresh before 30 minutes while working, then use the correct input-required or terminal tool. A final response alone does not complete this task.";
  return state && !["completed", "failed", "canceled", "rejected"].includes(state)
    ? " If this resumes assigned work, update its concise peer-visible activity when objective or scope materially changes and refresh before 30 minutes."
    : "";
}

function deliveryProvenance(
  principalKind: string | null,
): RuntimeDeliveryEnvelopeV1["provenance"] | undefined {
  if (principalKind === "bound-agent") return { principalKind, workAuthority: "delegated" };
  if (principalKind === "external-a2a-client" || principalKind === "service")
    return { principalKind, workAuthority: "untrusted" };
}

function interruptOnCancel(json: string) {
  const value: unknown = JSON.parse(json);
  return (
    typeof value === "object" &&
    value !== null &&
    "interruptOnCancel" in value &&
    value.interruptOnCancel === true
  );
}
function allowPeerPreemption(json: string) {
  const value: unknown = JSON.parse(json);
  return (
    typeof value === "object" &&
    value !== null &&
    "allowPeerPreemption" in value &&
    value.allowPeerPreemption === true
  );
}
function hasPreemptionScope(json: string) {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) && value.includes("a2a:preempt");
  } catch {
    return false;
  }
}
type PreemptionStatus = Record<string, unknown> & {
  requested: boolean;
  attempted: boolean;
  state: string;
};
function isPreemptionStatus(value: unknown): value is PreemptionStatus {
  return (
    typeof value === "object" &&
    value !== null &&
    "requested" in value &&
    "attempted" in value &&
    "state" in value &&
    typeof value.requested === "boolean" &&
    typeof value.attempted === "boolean" &&
    typeof value.state === "string"
  );
}
function parsePreemption(json: string): PreemptionStatus {
  const value: unknown = JSON.parse(json);
  if (isPreemptionStatus(value)) return value;
  return { requested: false, attempted: false, state: "not-requested" };
}
function preemptionExecution(status: PreemptionStatus): RuntimeExecutionRef | undefined {
  const value = status.execution;
  if (
    typeof value !== "object" ||
    value === null ||
    !("opaqueId" in value) ||
    typeof value.opaqueId !== "string" ||
    !("session" in value) ||
    typeof value.session !== "object" ||
    value.session === null ||
    !("opaqueId" in value.session) ||
    typeof value.session.opaqueId !== "string" ||
    !("installationId" in value.session) ||
    typeof value.session.installationId !== "string" ||
    !value.session.installationId.startsWith("ins_")
  )
    return undefined;
  return {
    ...value,
    opaqueId: value.opaqueId,
    session: {
      ...value.session,
      opaqueId: value.session.opaqueId,
      installationId: `ins_${value.session.installationId.slice(4)}`,
    },
  };
}
function preemptionTarget(status: PreemptionStatus) {
  const value = status.target;
  if (
    typeof value !== "object" ||
    value === null ||
    !("bindingId" in value) ||
    typeof value.bindingId !== "string" ||
    !value.bindingId.startsWith("bnd_") ||
    !("bindingEpoch" in value) ||
    typeof value.bindingEpoch !== "number" ||
    !("session" in value) ||
    typeof value.session !== "object" ||
    value.session === null ||
    !("opaqueId" in value.session) ||
    typeof value.session.opaqueId !== "string" ||
    !("installationId" in value.session) ||
    typeof value.session.installationId !== "string" ||
    !value.session.installationId.startsWith("ins_")
  )
    return undefined;
  const bindingId: BindingId = `bnd_${value.bindingId.slice(4)}`,
    installationId: RuntimeInstallationId = `ins_${value.session.installationId.slice(4)}`;
  return {
    bindingId,
    bindingEpoch: value.bindingEpoch,
    session: {
      installationId,
      opaqueId: value.session.opaqueId,
    },
  };
}
function preemptionToken(status: PreemptionStatus) {
  return typeof status.reconciliationToken === "string" ? status.reconciliationToken : undefined;
}
function runtimeState(value: string | null) {
  if (
    value === "offline" ||
    value === "not-loaded" ||
    value === "idle" ||
    value === "active" ||
    value === "system-error"
  )
    return value;
  return "unknown";
}
function blockingReason(value: string | null) {
  if (value === "none" || value === "user-input" || value === "approval") return value;
  return "unknown";
}
function interactivePresence(value: string | null) {
  if (value === "present" || value === "absent") return value;
  return "unknown";
}
function required<T>(value: T | null | undefined, name: string): T {
  if (value === undefined || value === null) throw new Error(`missing ${name}`);
  return value;
}

function deadlineSignal(parent: AbortSignal, deadlineMs: number | null): AbortSignal {
  if (deadlineMs === null) return parent;
  return AbortSignal.any([parent, AbortSignal.timeout(Math.max(0, deadlineMs - Date.now()))]);
}

export function retryDelay(attempt: number, random = Math.random, base = 250, cap = 30_000) {
  return Math.floor(random() * Math.min(cap, base * 2 ** Math.min(attempt, 16)));
}

function toNeutral(part: StoredPart): NeutralPart {
  if (part.content?.$case === "text")
    return {
      kind: "text",
      text: part.content.value,
      mediaType: part.mediaType === "text/markdown" ? "text/markdown" : "text/plain",
    };
  if (part.content?.$case === "url")
    return {
      kind: "uri",
      uri: part.content.value,
      name: part.filename || undefined,
      mediaType: part.mediaType || undefined,
    };
  if (part.content?.$case === "data")
    return {
      kind: "data",
      data: part.content.value,
      name: part.filename || undefined,
      mediaType: part.mediaType || "application/json",
    };
  throw new Error("unsupported content");
}
