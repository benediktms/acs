CREATE TABLE delivery_intents_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('a2a-message', 'task-event-notification')),
  task_id TEXT REFERENCES a2a_tasks(id),
  message_id TEXT REFERENCES a2a_messages(id),
  target_agent_id TEXT NOT NULL REFERENCES agents(id),
  pinned_binding_id TEXT REFERENCES runtime_bindings(id),
  pinned_binding_epoch INTEGER,
  mode TEXT NOT NULL DEFAULT 'direct' CHECK (mode = 'direct'),
  priority INTEGER NOT NULL DEFAULT 10,
  state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'attempting', 'deferred', 'accepted', 'acceptance-unknown', 'failed-terminal', 'canceled', 'superseded')),
  state_reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  not_before_ms INTEGER NOT NULL,
  deadline_ms INTEGER,
  lease_owner TEXT,
  lease_generation INTEGER NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_expires_at_ms INTEGER,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  payload_hash TEXT NOT NULL,
  runtime_execution_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CHECK ((pinned_binding_id IS NULL AND pinned_binding_epoch IS NULL) OR (pinned_binding_id IS NOT NULL AND pinned_binding_epoch IS NOT NULL))
) STRICT;

INSERT INTO delivery_intents_new (
  id, kind, task_id, message_id, target_agent_id, pinned_binding_id, pinned_binding_epoch,
  mode, priority, state, state_reason, attempt_count, not_before_ms, deadline_ms, lease_owner,
  lease_generation, lease_expires_at_ms, payload_json, payload_hash, runtime_execution_id,
  created_at_ms, updated_at_ms
)
SELECT
  id, kind, task_id, message_id, target_agent_id, pinned_binding_id, pinned_binding_epoch,
  'direct', priority, state, state_reason, attempt_count, not_before_ms, deadline_ms, lease_owner,
  lease_generation, lease_expires_at_ms, payload_json, payload_hash, runtime_execution_id,
  created_at_ms, updated_at_ms
FROM delivery_intents;

DROP TABLE delivery_intents;
ALTER TABLE delivery_intents_new RENAME TO delivery_intents;

CREATE INDEX delivery_intents_due_idx
  ON delivery_intents(state, not_before_ms, priority DESC, created_at_ms);
CREATE INDEX delivery_intents_target_idx
  ON delivery_intents(target_agent_id, state, created_at_ms);
CREATE INDEX delivery_intents_task_idx
  ON delivery_intents(task_id, created_at_ms);
