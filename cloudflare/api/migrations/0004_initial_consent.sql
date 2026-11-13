-- Fresh-start CF-05: append-only proof for the first explicit health consent.
-- No health data or account migrated from Firebase. A full withdrawal/erasure
-- lifecycle requires its own trusted and separately verified job transaction.
CREATE TABLE health_consent_acceptances (
  uid TEXT PRIMARY KEY REFERENCES sync_subjects(uid) ON DELETE RESTRICT,
  consent_revision INTEGER NOT NULL CHECK (consent_revision = 1),
  privacy_version TEXT NOT NULL CHECK (length(privacy_version) BETWEEN 1 AND 32),
  terms_version TEXT NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 32),
  accepted_at_ms INTEGER NOT NULL CHECK (accepted_at_ms > 0),
  over_18_confirmed INTEGER NOT NULL CHECK (over_18_confirmed = 1)
);

CREATE TRIGGER health_consent_acceptance_immutable BEFORE UPDATE ON health_consent_acceptances
BEGIN SELECT RAISE(ABORT, 'initial-consent-immutable'); END;
