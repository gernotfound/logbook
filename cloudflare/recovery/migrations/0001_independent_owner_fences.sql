-- CF-08 sandbox-only authority. This DB MUST be independent of the D1 being
-- restored. Applying this migration to the application D1 defeats its purpose.
-- Never attach the registry to a public route; it defaults to sealed.
CREATE TABLE recovery_control (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  mode TEXT NOT NULL CHECK (mode IN ('sealed', 'open')),
  generation INTEGER NOT NULL CHECK (generation >= 1)
);
INSERT INTO recovery_control(singleton, mode, generation) VALUES (1, 'sealed', 1);

CREATE TRIGGER recovery_control_no_delete BEFORE DELETE ON recovery_control
BEGIN SELECT RAISE(ABORT, 'recovery-control-immutable'); END;
CREATE TRIGGER recovery_control_monotone BEFORE UPDATE ON recovery_control
WHEN NEW.singleton != OLD.singleton OR NEW.generation <= OLD.generation
BEGIN SELECT RAISE(ABORT, 'recovery-control-regression'); END;

CREATE TABLE recovery_owner_fences (
  uid TEXT PRIMARY KEY CHECK (
    length(uid) BETWEEN 1 AND 128 AND trim(uid) = uid AND instr(uid, '/') = 0
  ),
  status TEXT NOT NULL CHECK (
    status IN ('pending', 'active', 'blocked', 'withdrawn', 'deleted')
  ),
  consent_revision INTEGER NOT NULL CHECK (consent_revision >= 0),
  fence_epoch INTEGER NOT NULL CHECK (fence_epoch >= 1),
  erased_before_revision INTEGER NOT NULL CHECK (
    erased_before_revision >= 0 AND erased_before_revision <= consent_revision
  ),
  change_seq INTEGER NOT NULL CHECK (change_seq >= 1),
  CHECK (status != 'pending' OR
    (consent_revision = 0 AND erased_before_revision = 0))
) WITHOUT ROWID;

-- All first enrollment starts denied. Do not seed active subjects from a
-- stale application snapshot; authorization requires trusted primary proof.
CREATE TRIGGER recovery_owner_initial_pending
BEFORE INSERT ON recovery_owner_fences
WHEN NEW.status != 'pending' OR NEW.consent_revision != 0
  OR NEW.erased_before_revision != 0 OR NEW.change_seq != 1
BEGIN SELECT RAISE(ABORT, 'recovery-enrollment-fenced'); END;

CREATE TRIGGER recovery_owner_no_delete BEFORE DELETE ON recovery_owner_fences
BEGIN SELECT RAISE(ABORT, 'recovery-owner-immutable'); END;

-- Reacceptance is intentionally NOT allowed in this first migration. It needs
-- a separately verified new-consent protocol and an independent epoch proof.
-- A generic UPDATE may never turn a withdrawal back into active fitness.
CREATE TRIGGER recovery_owner_monotone BEFORE UPDATE ON recovery_owner_fences
WHEN NEW.uid != OLD.uid
  OR NEW.change_seq != OLD.change_seq + 1
  OR NEW.consent_revision < OLD.consent_revision
  OR NEW.fence_epoch < OLD.fence_epoch
  OR NEW.erased_before_revision < OLD.erased_before_revision
  OR NOT (
    (OLD.status = 'pending' AND NEW.status = 'active'
      AND NEW.consent_revision = 1
      AND NEW.fence_epoch = OLD.fence_epoch
      AND NEW.erased_before_revision = 0)
    OR (OLD.status = 'active' AND NEW.status = 'blocked'
      AND NEW.consent_revision = OLD.consent_revision
      AND NEW.fence_epoch = OLD.fence_epoch
      AND NEW.erased_before_revision = OLD.erased_before_revision)
    OR (OLD.status = 'blocked' AND NEW.status = 'withdrawn'
      AND NEW.consent_revision = OLD.consent_revision
      AND NEW.fence_epoch = OLD.fence_epoch
      AND NEW.erased_before_revision = OLD.erased_before_revision)
    OR (OLD.status IN ('blocked', 'withdrawn') AND NEW.status = 'withdrawn'
      AND NEW.consent_revision = OLD.consent_revision + 1
      AND NEW.fence_epoch = OLD.fence_epoch + 1
      AND NEW.erased_before_revision = NEW.consent_revision)
    OR (OLD.status IN ('pending', 'blocked', 'withdrawn') AND NEW.status = 'deleted'
      AND NEW.consent_revision = OLD.consent_revision
      AND NEW.fence_epoch = OLD.fence_epoch
      AND NEW.erased_before_revision = OLD.erased_before_revision)
  )
BEGIN SELECT RAISE(ABORT, 'recovery-fence-regression'); END;
