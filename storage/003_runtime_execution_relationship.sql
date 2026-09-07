ALTER TABLE runtime_executions
  ADD COLUMN relationship TEXT NOT NULL DEFAULT 'unknown' CHECK (
    relationship IN ('started', 'joined', 'unknown')
  );

CREATE INDEX runtime_executions_runtime_turn_idx
  ON runtime_executions(binding_id, runtime_execution_opaque_id, updated_at_ms);
