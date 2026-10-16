import { randomUUID } from 'node:crypto';
import { Timestamp, FieldValue, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';
import { PRIVATE_ACCOUNT_COLLECTIONS } from '../accountDeletion/types.js';

const JOB_COLLECTION = 'health_data_erasures';
const CONSENT_COLLECTION = 'health_consent_withdrawals';
const PAGE_SIZE = 100;
const SAFETY_BUFFER_MS = 1000;
const LEASE_GRACE_MS = 10000;

type HealthDataErasureStatus = 'requested' | 'deleting' | 'verifying' | 'complete' | 'failed';
type Job = {
  uid: string;
  consentRevision: number;
  status: HealthDataErasureStatus;
  attempts: number;
  updatedAt: Timestamp;
  requestedAt: Timestamp;
  leaseOwner?: string;
  leaseUntil?: Timestamp;
  retryable?: boolean;
  error?: string;
  completedRevision?: number;
  completedAt?: Timestamp;
};

export type PublicErasureStatus = {
  status: HealthDataErasureStatus;
  complete: boolean;
  retryable?: boolean;
  error?: string;
};

export class HealthDataErasureConflict extends Error {
  constructor(message = 'La revoca deve essere confermata prima della cancellazione dei dati.') {
    super(message);
    this.name = 'HealthDataErasureConflict';
  }
}
class HealthDataErasureUnexpectedResidue extends Error {
  constructor() { super('Sono presenti dati non riconosciuti che impediscono la verifica finale.'); this.name = 'HealthDataErasureUnexpectedResidue'; }
}
class ErasureLeaseLost extends Error {
  constructor() { super('Il lavoro di cancellazione è stato acquisito da un altro processo.'); this.name = 'ErasureLeaseLost'; }
}

const jobRef = (uid: string) => adminDb().collection(JOB_COLLECTION).doc(uid);
const consentRef = (uid: string) => adminDb().collection(CONSENT_COLLECTION).doc(uid);
const validUid = (uid: string) => {
  if (!uid || uid.includes('/') || uid.length > 128) throw new Error('Account non valido.');
  return uid;
};
const isPositiveRevision = (revision: unknown): revision is number =>
  Number.isSafeInteger(revision) && typeof revision === 'number' && revision >= 1;

export async function readHealthDataErasureStatus(uid: string): Promise<PublicErasureStatus | null> {
  const snap = await jobRef(validUid(uid)).get();
  if (!snap.exists) return null;
  const job = snap.data() as Job;
  if (job.uid !== uid || !isPositiveRevision(job.consentRevision)
      || !['requested', 'deleting', 'verifying', 'complete', 'failed'].includes(job.status)) {
    throw new Error('Stato cancellazione non verificabile.');
  }
  return {
    status: job.status,
    complete: job.status === 'complete',
    ...(job.status === 'failed' ? { retryable: job.retryable === true, error: 'Cancellazione incompleta. Alcuni dati potrebbero essere già stati eliminati.' } : {}),
  };
}

export async function createHealthDataErasureJob(uid: string): Promise<void> {
  validUid(uid);
  const db = adminDb();
  const ref = jobRef(uid);
  await db.runTransaction(async tx => {
    const deletion = db.collection('account_deletions').doc(uid);
    const [consent, job, accountDeletion] = await Promise.all([
      tx.get(consentRef(uid)), tx.get(ref), tx.get(deletion),
    ]);
    if (accountDeletion.exists) throw new HealthDataErasureConflict('Cancellazione account già in corso.');
    const state = consent.data();
    if (!state || state.status !== 'withdrawn' || !isPositiveRevision(state.revision)) {
      throw new HealthDataErasureConflict();
    }
    const previous = job.data() as Job | undefined;
    if (previous && (!isPositiveRevision(previous.consentRevision) || previous.uid !== uid)) {
      throw new Error('Stato cancellazione precedente non verificabile.');
    }
    if (previous && (previous.consentRevision === state.revision
        || (previous.status === 'complete' && previous.completedRevision === state.revision))) {
      if (previous.status === 'failed' && previous.retryable === false) {
        throw new HealthDataErasureConflict('Cancellazione interrotta per dati non riconosciuti: è necessario un controllo.');
      }
      // The completion itself advances the withdrawn consent revision once.
      // Repeated POSTs at that revision cannot start another erasure.
      return;
    }
    if (previous && previous.status !== 'complete') {
      throw new HealthDataErasureConflict('Completa la cancellazione precedente prima di iniziarne una nuova.');
    }
    const now = Timestamp.now();
    const next: Job = {
      uid, consentRevision: state.revision,
      status: 'requested', attempts: 0, requestedAt: now, updatedAt: now,
    };
    tx.set(ref, next);
  });
}

function requireLease(job: Job | undefined, leaseOwner: string): Job {
  if (!job || job.status === 'complete' || job.leaseOwner !== leaseOwner
      || !(job.leaseUntil instanceof Timestamp) || job.leaseUntil.toMillis() <= Date.now()) {
    throw new ErasureLeaseLost();
  }
  return job;
}

async function acquireLease(uid: string, leaseOwner: string, deadlineMs: number): Promise<boolean> {
  return adminDb().runTransaction(async tx => {
    const ref = jobRef(uid);
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const job = snap.data() as Job;
    if (job.uid !== uid || !isPositiveRevision(job.consentRevision)) throw new Error('Job cancellazione non valido.');
    if (job.status === 'complete' || (job.status === 'failed' && job.retryable === false)) return false;
    if (job.leaseOwner && job.leaseUntil instanceof Timestamp && job.leaseUntil.toMillis() > Date.now()) return false;
    tx.update(ref, {
      status: 'deleting', attempts: (job.attempts || 0) + 1,
      leaseOwner, leaseUntil: Timestamp.fromMillis(Math.max(Date.now() + 15000, deadlineMs + LEASE_GRACE_MS)),
      updatedAt: Timestamp.now(), retryable: FieldValue.delete(), error: FieldValue.delete(),
    });
    return true;
  });
}

async function updateUnderLease(uid: string, leaseOwner: string, update: Record<string, unknown>,
  mutate?: (tx: Transaction) => void): Promise<void> {
  const db = adminDb();
  const ref = jobRef(uid);
  await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    requireLease(snap.exists ? snap.data() as Job : undefined, leaseOwner);
    mutate?.(tx);
    tx.update(ref, { ...update, updatedAt: Timestamp.now() });
  });
}

async function deleteCollectionPage(uid: string, name: typeof PRIVATE_ACCOUNT_COLLECTIONS[number], leaseOwner: string): Promise<number> {
  const db = adminDb();
  const page = await db.collection('users').doc(uid).collection(name).limit(PAGE_SIZE).select().get();
  await updateUnderLease(uid, leaseOwner, { status: 'deleting' }, tx => {
    for (const item of page.docs) tx.delete(item.ref);
  });
  return page.size;
}

async function verifyEmpty(uid: string): Promise<void> {
  const root = adminDb().collection('users').doc(uid);
  const rootSnap = await root.get();
  if (rootSnap.exists) throw new Error('Dati del profilo ancora presenti.');
  for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
    if (!(await root.collection(name).limit(1).select().get()).empty) {
      throw new Error('Cancellazione cloud incompleta: ' + name);
    }
  }
  const known = new Set<string>(PRIVATE_ACCOUNT_COLLECTIONS);
  const unknown = await root.listCollections();
  for (const collection of unknown) {
    if (!known.has(collection.id) && !(await collection.limit(1).select().get()).empty) {
      throw new HealthDataErasureUnexpectedResidue();
    }
  }
}

async function completeErasure(uid: string, leaseOwner: string): Promise<void> {
  const db = adminDb();
  await db.runTransaction(async tx => {
    const [jobSnap, consentSnap] = await Promise.all([tx.get(jobRef(uid)), tx.get(consentRef(uid))]);
    const job = requireLease(jobSnap.exists ? jobSnap.data() as Job : undefined, leaseOwner);
    const state = consentSnap.data();
    if (!state || state.status !== 'withdrawn' || state.revision !== job.consentRevision) {
      throw new HealthDataErasureConflict('Il consenso è cambiato durante la cancellazione.');
    }
    const nextRevision = job.consentRevision + 1;
    if (!Number.isSafeInteger(nextRevision)) throw new Error('Revisione consenso non rappresentabile.');
    const now = Timestamp.now();
    tx.update(consentRef(uid), {
      revision: nextRevision, status: 'withdrawn', updatedAt: now,
      erasedBeforeRevision: job.consentRevision,
    });
    tx.update(jobRef(uid), {
      status: 'complete', completedRevision: nextRevision, completedAt: now, updatedAt: now,
      leaseOwner: FieldValue.delete(), leaseUntil: FieldValue.delete(),
      retryable: FieldValue.delete(), error: FieldValue.delete(),
    });
  });
}

/** Idempotent, budgeted server-only worker. Never deletes Firebase Auth or consent evidence. */
export async function processHealthDataErasure(uid: string, deadlineMs: number): Promise<'complete' | 'pending' | 'busy' | 'failed'> {
  validUid(uid);
  if (Date.now() + SAFETY_BUFFER_MS >= deadlineMs) return 'pending';
  const leaseOwner = randomUUID();
  if (!await acquireLease(uid, leaseOwner, deadlineMs)) {
    const status = await readHealthDataErasureStatus(uid);
    return status?.complete ? 'complete' : 'busy';
  }
  let phase = 'starting';
  try {
    for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
      phase = name;
      for (;;) {
        if (Date.now() + SAFETY_BUFFER_MS >= deadlineMs) {
          await updateUnderLease(uid, leaseOwner, {
            leaseOwner: FieldValue.delete(), leaseUntil: FieldValue.delete(), status: 'deleting',
          });
          return 'pending';
        }
        const count = await deleteCollectionPage(uid, name, leaseOwner);
        if (!count) break;
      }
    }
    phase = 'root';
    await updateUnderLease(uid, leaseOwner, { status: 'verifying' }, tx => {
      tx.delete(adminDb().collection('users').doc(uid));
    });
    phase = 'verification';
    await verifyEmpty(uid);
    phase = 'completion';
    await completeErasure(uid, leaseOwner);
    return 'complete';
  } catch (error) {
    if (error instanceof ErasureLeaseLost) return 'busy';
    try {
      await updateUnderLease(uid, leaseOwner, {
        status: 'failed',
        retryable: !(error instanceof HealthDataErasureUnexpectedResidue || error instanceof HealthDataErasureConflict),
        error: phase,
        leaseOwner: FieldValue.delete(), leaseUntil: FieldValue.delete(),
      });
    } catch { /* Preserve lease and original failure for recovery. */ }
    return 'failed';
  }
}

export async function listRecoverableHealthErasures(limitCount = 12): Promise<string[]> {
  const db = adminDb().collection(JOB_COLLECTION);
  const snapshot = await db.where('status', 'in', ['requested', 'deleting', 'verifying']).limit(limitCount).get();
  const failed = await db.where('status', '==', 'failed').where('retryable', '==', true).limit(limitCount).get();
  const ids = new Set([...snapshot.docs, ...failed.docs].map(item => item.id));
  return [...ids].slice(0, limitCount);
}
