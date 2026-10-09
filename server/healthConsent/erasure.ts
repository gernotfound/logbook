import { randomUUID } from 'node:crypto';
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';
import { PRIVATE_ACCOUNT_COLLECTIONS } from '../accountDeletion/types.js';

const PAGE_SIZE = 200;
const SAFETY_BUFFER_MS = 1_000;
type ErasureStatus = 'requested' | 'deleting' | 'complete' | 'failed' | 'blocked';
export type ErasureOutcome = 'complete' | 'pending' | 'busy';

type ErasureMarker = {
  eraseStatus?: ErasureStatus;
  eraseLeaseOwner?: string;
  eraseLeaseUntil?: Timestamp;
};
const markerRef = (uid: string) => adminDb().collection('health_consent_revocations').doc(uid);
const deletionRef = (uid: string) => adminDb().collection('account_deletions').doc(uid);

class UnexpectedHealthCollection extends Error {
  constructor(collection: string) { super('Unexpected private collection requires reviewed erasure: ' + collection); }
}

class ErasureLeaseLost extends Error {
  constructor() { super('Health erasure lease no longer valid.'); }
}

async function withLease(
  uid: string,
  owner: string,
  edit: (tx: Transaction) => void,
): Promise<void> {
  const db = adminDb();
  await db.runTransaction(async tx => {
    const [marker, deletion] = await Promise.all([
      tx.get(markerRef(uid)),
      tx.get(deletionRef(uid)),
    ]);
    const value = marker.data() as ErasureMarker | undefined;
    if (!value || deletion.exists || value.eraseLeaseOwner !== owner
      || !(value.eraseLeaseUntil instanceof Timestamp)
      || value.eraseLeaseUntil.toMillis() <= Date.now()
      || value.eraseStatus === 'complete') throw new ErasureLeaseLost();
    edit(tx);
  });
}

async function acquireLease(uid: string, owner: string, deadlineMs: number): Promise<boolean> {
  const db = adminDb();
  return db.runTransaction(async tx => {
    const [marker, deletion] = await Promise.all([
      tx.get(markerRef(uid)), tx.get(deletionRef(uid)),
    ]);
    if (!marker.exists || deletion.exists) return false;
    const state = marker.data() as ErasureMarker;
    if (state.eraseStatus === 'complete' || state.eraseStatus === 'blocked') return false;
    if (state.eraseLeaseOwner && state.eraseLeaseOwner !== owner
      && state.eraseLeaseUntil instanceof Timestamp
      && state.eraseLeaseUntil.toMillis() > Date.now()) return false;
    tx.update(markerRef(uid), {
      eraseStatus: 'deleting',
      eraseLeaseOwner: owner,
      eraseLeaseUntil: Timestamp.fromMillis(Math.max(deadlineMs + 5_000, Date.now() + 15_000)),
      eraseUpdatedAt: Timestamp.now(),
    });
    return true;
  });
}

async function deletePrivatePage(uid: string, owner: string, name: typeof PRIVATE_ACCOUNT_COLLECTIONS[number]): Promise<number> {
  const db = adminDb();
  const page = await db.collection('users').doc(uid).collection(name).limit(PAGE_SIZE).select().get();
  await withLease(uid, owner, tx => {
    for (const item of page.docs) tx.delete(item.ref);
    tx.update(markerRef(uid), { erasePhase: name, eraseUpdatedAt: Timestamp.now() });
  });
  return page.size;
}

/** Remove all business root fields, preserving only minimised legal consent. */
async function emptyRoot(uid: string, owner: string): Promise<void> {
  const db = adminDb();
  await db.runTransaction(async tx => {
    const [marker, deleting, original] = await Promise.all([
      tx.get(markerRef(uid)), tx.get(deletionRef(uid)), tx.get(db.collection('users').doc(uid)),
    ]);
    const state = marker.data() as ErasureMarker | undefined;
    if (!state || deleting.exists || state.eraseLeaseOwner !== owner
      || !(state.eraseLeaseUntil instanceof Timestamp) || state.eraseLeaseUntil.toMillis() <= Date.now()) {
      throw new ErasureLeaseLost();
    }
    const consent = original.data()?.legalConsent as Record<string, unknown> | undefined;
    const minimalConsent = {
      hasAcceptedTerms: consent?.hasAcceptedTerms === true,
      hasAcceptedHealthData: false,
      termsVersion: typeof consent?.termsVersion === 'string' ? consent.termsVersion : '',
      privacyVersion: typeof consent?.privacyVersion === 'string' ? consent.privacyVersion : '',
    };
    // The document itself stays: the user account remains and Rules still fence writes.
    tx.set(db.collection('users').doc(uid), { _schemaVersion: 1, legalConsent: minimalConsent });
    tx.update(markerRef(uid), { erasePhase: 'verify', eraseUpdatedAt: Timestamp.now() });
  });
}

async function verifyEmpty(uid: string): Promise<void> {
  const db = adminDb();
  const root = db.collection('users').doc(uid);
  const rootSnapshot = await root.get();
  if (!rootSnapshot.exists) throw new Error('Account root absent during health erasure.');
  const remaining = Object.keys(rootSnapshot.data() ?? {}).filter(key => !['_schemaVersion', 'legalConsent'].includes(key));
  if (remaining.length) throw new Error('Unexpected business data retained in account root.');
  if ((rootSnapshot.data()?.legalConsent as { hasAcceptedHealthData?: unknown } | undefined)?.hasAcceptedHealthData !== false) {
    throw new Error('Consent was not invalidated in account root.');
  }
  for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
    const collection = root.collection(name);
    if (!(await collection.limit(1).select().get()).empty) {
      throw new Error('Private documents still present in ' + name);
    }
    // Queries omit missing parent documents even when nested private data remains.
    // listDocuments includes those references, so an orphan must block completion.
    if ((await collection.listDocuments()).length > 0) {
      throw new UnexpectedHealthCollection(name + ' (nested orphan)');
    }
  }
  const known = new Set<string>(PRIVATE_ACCOUNT_COLLECTIONS);
  for (const collection of await root.listCollections()) {
    if (known.has(collection.id)) continue;
    if ((await collection.listDocuments()).length > 0) throw new UnexpectedHealthCollection(collection.id);
  }
}

async function finalize(uid: string, owner: string): Promise<void> {
  await withLease(uid, owner, tx => {
    tx.update(markerRef(uid), {
      eraseStatus: 'complete',
      erasePhase: 'complete',
      eraseUpdatedAt: Timestamp.now(),
      eraseCompletedAt: Timestamp.now(),
      eraseLeaseOwner: null,
      eraseLeaseUntil: null,
    });
  });
}

async function release(uid: string, owner: string, status: 'requested' | 'failed' | 'blocked'): Promise<void> {
  try {
    await withLease(uid, owner, tx => tx.update(markerRef(uid), {
      eraseStatus: status, eraseLeaseOwner: null, eraseLeaseUntil: null, eraseUpdatedAt: Timestamp.now(),
    }));
  } catch { /* Another worker or account deletion may have taken over. */ }
}

export async function processHealthErasure(uid: string, deadlineMs: number): Promise<ErasureOutcome> {
  if (!uid || uid.includes('/')) throw new Error('Invalid UID.');
  const owner = randomUUID();
  if (Date.now() + SAFETY_BUFFER_MS >= deadlineMs) return 'pending';
  if (!(await acquireLease(uid, owner, deadlineMs))) return 'busy';
  try {
    for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
      for (;;) {
        if (Date.now() + SAFETY_BUFFER_MS >= deadlineMs) {
          await release(uid, owner, 'requested');
          return 'pending';
        }
        const count = await deletePrivatePage(uid, owner, name);
        if (!count) break;
      }
    }
    if (Date.now() + SAFETY_BUFFER_MS >= deadlineMs) {
      await release(uid, owner, 'requested');
      return 'pending';
    }
    await emptyRoot(uid, owner);
    await verifyEmpty(uid);
    await finalize(uid, owner);
    return 'complete';
  } catch (error) {
    await release(uid, owner, error instanceof UnexpectedHealthCollection ? 'blocked' : 'failed');
    if (error instanceof ErasureLeaseLost) return 'busy';
    throw error;
  }
}

export async function listPendingHealthErasures(limit = 25): Promise<string[]> {
  const docs = await adminDb().collection('health_consent_revocations')
    .where('eraseStatus', 'in', ['requested', 'deleting', 'failed'])
    // Oldest attempted job first. Failed jobs receive a fresh eraseUpdatedAt
    // on release, so repeated failures cannot monopolise the first page.
    .orderBy('eraseUpdatedAt', 'asc')
    .limit(limit).select().get();
  return docs.docs.map(item => item.id);
}

/** Presence-only check: never emit user IDs or error contents in cron logs. */
export async function hasBlockedHealthErasures(): Promise<boolean> {
  const docs = await adminDb().collection('health_consent_revocations')
    .where('eraseStatus', '==', 'blocked').limit(1).select().get();
  return !docs.empty;
}
