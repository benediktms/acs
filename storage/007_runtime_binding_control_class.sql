DROP TRIGGER IF EXISTS runtime_bindings_control_class_immutable;

ALTER TABLE runtime_bindings ADD COLUMN control_class TEXT NOT NULL DEFAULT 'attached' CHECK (
  control_class IN ('attached', 'managed')
);

CREATE TRIGGER runtime_bindings_control_class_immutable
BEFORE UPDATE OF control_class ON runtime_bindings
WHEN OLD.control_class <> NEW.control_class
BEGIN
  SELECT RAISE(ABORT, 'BINDING_CONTROL_CLASS_IMMUTABLE');
END;
