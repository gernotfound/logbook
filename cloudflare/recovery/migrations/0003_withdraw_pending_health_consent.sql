-- A first consent can commit in the application D1 before the independent
-- floor is promoted. Allow an authenticated withdrawal to deny that generation
-- directly, without creating a window in which fitness becomes available.
DROP TRIGGER recovery_owner_monotone;

CREATE TRIGGER recovery_owner_monotone BEFORE UPDATE ON recovery_owner_fences
WHEN NEW.uid != OLD.uid
  OR NEW.change_seq != OLD.change_seq + 1
  OR NEW.consent_revision < OLD.consent_revision
  OR NEW.fence_epoch < OLD.fence_epoch
  OR NEW.erased_before_revision < OLD.erased_before_revision
  OR NOT (
    (OLD.status = 'pending' AND NEW.status IN ('active', 'blocked')
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
