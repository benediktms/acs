CREATE TABLE task_events_new (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES a2a_tasks(id),
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'task-created',
      'message-received',
      'delivery-queued',
      'delivery-deferred',
      'delivery-accepted',
      'delivery-acceptance-unknown',
      'task-working',
      'task-acknowledged',
      'message-published',
      'artifact-published',
      'input-required',
      'cancellation-requested',
      'task-completed',
      'task-failed',
      'task-canceled',
      'task-rejected',
      'operator-resolution'
    )
  ),
  actor_principal_id TEXT REFERENCES principals(id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at_ms INTEGER NOT NULL,
  UNIQUE(task_id, sequence)
) STRICT;

INSERT INTO task_events_new(id,task_id,sequence,event_type,actor_principal_id,payload_json,created_at_ms)
SELECT id,task_id,sequence,event_type,actor_principal_id,payload_json,created_at_ms
FROM task_events;

DROP TABLE task_events;
ALTER TABLE task_events_new RENAME TO task_events;

CREATE INDEX task_events_task_created_idx
  ON task_events(task_id, created_at_ms, sequence);

CREATE TRIGGER task_events_no_update
BEFORE UPDATE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'TASK_EVENT_IMMUTABLE');
END;

CREATE TRIGGER task_events_no_delete
BEFORE DELETE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'TASK_EVENT_IMMUTABLE');
END;
