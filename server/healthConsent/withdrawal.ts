import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';
import { LEGAL_VERSIONS } from '../../src/lib/legalVersions.js';

const CONSENT_COLLECTION = 'health_consent_withdrawals';

export class HealthConsentRevisionConflictError extends Error {
  constructor() { super('Una scelta più recente ha sostituito questa revoca. Serve una nuova conferma.'); this.name = 'HealthConsentRevisionConflictError'; }
}

export type HealthConsentState = {
  status: 'active' | 'withdrawn';
  revision: number;
  acceptedAt?: string;
};

function validUid(uid: string): void {
  if (!uid || uid.length > 128 || uid.includes('/')) {
    throw new Error('Identificativo account non valido.');
  }
}

function consentRef(uid: string) {
  return adminDb().collection(CONSENT_COLLECTION).doc(uid);
}

export async function readHealthConsentState(uid: string): Promise<HealthConsentState> {
  validUid(uid);
  const snap = await consentRef(uid).get();
  if (!snap.exists) return { status: 'active', revision: 0 };
  const data = snap.data();
  if (!data || (data.status !== 'active' && data.status !== 'withdrawn')
    || !Number.isSafeInteger(data.revision) || data.revision < 1) {
    throw new Error('Stato consenso server non valido.');
  }
  return {
    status: data.status,
    revision: data.revision,
    ...(data.status === 'active' && typeof data.acceptedAt === 'string'
      ? { acceptedAt: data.acceptedAt } : {}),
  };
}

/** Durable server-only revocation. Never modify or delete fitness data here. */
export async function recordHealthConsentWithdrawal(uid: string, expectedRevision: number): Promise<HealthConsentState> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('Revisione consenso richiesta non valida.');
  validUid(uid);
  const db = adminDb();
  return db.runTransaction(async tx => {
    const deletion = db.collection('account_deletions').doc(uid);
    const state = consentRef(uid);
    const [job, existing] = await Promise.all([tx.get(deletion), tx.get(state)]);
    if (job.exists) throw new Error('Cancellazione account in corso.');
    const previous = existing.data();
    if (existing.exists && previous?.status === 'withdrawn') {
      // A retry is idempotent only for its own transition. Older requests
      // cannot acknowledge a different withdrawal after reacceptance.
      if (!Number.isSafeInteger(previous.revision) || previous.revision < 1
        || previous.revision !== expectedRevision + 1) {
        throw new HealthConsentRevisionConflictError();
      }
      return { status: 'withdrawn', revision: previous.revision };
    }
    const actual = existing.exists ? Number(previous?.revision) : 0;
    if (!Number.isSafeInteger(actual) || actual !== expectedRevision || (existing.exists && previous?.status !== 'active')) {
      throw new HealthConsentRevisionConflictError();
    }
    const revision = actual + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('Revision consenso non valida.');
    const now = Timestamp.now();
    const update = {
      uid, status: 'withdrawn', revision, withdrawnAt: now, updatedAt: now,
    };
    if (existing.exists) tx.update(state, update);
    else tx.create(state, update);
    return { status: 'withdrawn', revision };
  });
}

export type ExplicitConsentAcceptance = {
  acceptedTerms: true;
  acceptedHealthData: true;
  privacyVersion: string;
  termsVersion: string;
};

export function validateExplicitAcceptance(value: unknown): asserts value is ExplicitConsentAcceptance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Consenso esplicito mancante.');
  const input = value as Record<string, unknown>;
  if (input.acceptedTerms !== true || input.acceptedHealthData !== true
    || input.privacyVersion !== LEGAL_VERSIONS.privacy
    || input.termsVersion !== LEGAL_VERSIONS.terms) {
    throw new Error('Accettazione esplicita e versioni legali correnti obbligatorie.');
  }
}

/** Re-consent is explicit, server-authenticated and monotonic; no client may edit the marker. */
export async function recordHealthConsentReacceptance(
  uid: string, acceptance: ExplicitConsentAcceptance, expectedRevision: number,
): Promise<HealthConsentState> {
  validUid(uid);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error('Revisione attesa del consenso non valida.');
  validateExplicitAcceptance(acceptance);
  const db = adminDb();
  return db.runTransaction(async tx => {
    const deletion = db.collection('account_deletions').doc(uid);
    const state = consentRef(uid);
    const root = db.collection('users').doc(uid);
    const [job, previousSnap, userRoot] = await Promise.all([tx.get(deletion), tx.get(state), tx.get(root)]);
    if (job.exists) throw new Error('Cancellazione account in corso.');
    const previous = previousSnap.data();
    // Idempotent retry must prove it belongs to THIS transition and uses
    // the same legal versions; it must not resurrect a superseded acceptance.
    if (previousSnap.exists && previous?.status === 'active'
      && previous.revision === expectedRevision + 1
      && previous.privacyVersion === acceptance.privacyVersion
      && previous.termsVersion === acceptance.termsVersion
      && typeof previous.acceptedAt === 'string') {
      return { status: 'active', revision: previous.revision, acceptedAt: previous.acceptedAt };
    }
    if (!previousSnap.exists || previous?.status !== 'withdrawn' || previous.revision !== expectedRevision) {
      throw new HealthConsentRevisionConflictError();
    }
    const revision = Number(previous.revision) + 1;
    if (!Number.isSafeInteger(revision)) throw new Error('Revision consenso non valida.');
    const now = Timestamp.now();
    const acceptedAt = now.toDate().toISOString();
    if (userRoot.exists) {
      tx.update(root, { legalConsent: {
        hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt,
        privacyVersion: acceptance.privacyVersion,
        termsVersion: acceptance.termsVersion,
      } });
    }
    tx.update(state, {
      status: 'active', revision, acceptedAt, updatedAt: now,
      privacyVersion: acceptance.privacyVersion,
      termsVersion: acceptance.termsVersion,
    });
    return { status: 'active', revision, acceptedAt };
  });
}

/** Called by the existing deletion worker; never used by user-side revocation. */
export async function removeHealthConsentStateForDeletedAccount(uid: string): Promise<void> {
  validUid(uid);
  await consentRef(uid).delete();
}
