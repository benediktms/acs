ALTER TABLE runtime_bindings ADD COLUMN last_observed_runtime_state TEXT CHECK (
  last_observed_runtime_state IS NULL OR last_observed_runtime_state IN (
    'unknown', 'offline', 'not-loaded', 'idle', 'active', 'system-error'
  )
);
ALTER TABLE runtime_bindings ADD COLUMN last_observed_blocking_reason TEXT CHECK (
  last_observed_blocking_reason IS NULL OR last_observed_blocking_reason IN (
    'none', 'user-input', 'approval', 'unknown'
  )
);
ALTER TABLE runtime_bindings ADD COLUMN last_observed_interactive_presence TEXT CHECK (
  last_observed_interactive_presence IS NULL OR last_observed_interactive_presence IN (
    'present', 'absent', 'unknown'
  )
);
ALTER TABLE agents ADD COLUMN offline_since_ms INTEGER;

UPDATE runtime_bindings
SET last_observed_runtime_state='unknown',
    last_observed_blocking_reason='unknown',
    last_observed_interactive_presence='unknown'
WHERE last_observed_availability IS NOT NULL;

CREATE INDEX agents_offline_since_idx
  ON agents(offline_since_ms)
  WHERE enabled=1 AND deleted_at_ms IS NULL AND offline_since_ms IS NOT NULL;
