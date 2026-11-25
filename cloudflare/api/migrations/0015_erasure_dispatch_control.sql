-- Dispatch fairness only: this counter never authorizes owner erasure.
CREATE TABLE erasure_dispatch_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  turn INTEGER NOT NULL CHECK (turn BETWEEN 0 AND 9007199254740991)
) STRICT;

INSERT INTO erasure_dispatch_control VALUES (1, 0);

CREATE TRIGGER erasure_dispatch_control_no_replace
BEFORE INSERT ON erasure_dispatch_control
WHEN EXISTS (SELECT 1 FROM erasure_dispatch_control)
BEGIN SELECT RAISE(ABORT, 'erasure-dispatch-immutable'); END;

CREATE TRIGGER erasure_dispatch_control_no_delete
BEFORE DELETE ON erasure_dispatch_control
BEGIN SELECT RAISE(ABORT, 'erasure-dispatch-immutable'); END;

CREATE TRIGGER erasure_dispatch_control_transition
BEFORE UPDATE ON erasure_dispatch_control
WHEN NEW.singleton != OLD.singleton OR NEW.turn != OLD.turn + 1
BEGIN SELECT RAISE(ABORT, 'erasure-dispatch-fenced'); END;
