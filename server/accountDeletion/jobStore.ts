import { createHash, timingSafeEqual } from 'node:crypto';
import { FieldPath, FieldValue, Timestamp, type QueryDocumentSnapshot, type Transaction } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebaseAdmin.js';
import { completedDeletionPurgeAfter } from './retention.js';
import {
  PRIVATE_ACCOUNT_COLLECTIONS,
  type AccountDeletionCursor,
  type AccountDeletionJob,
  type AccountDeletionPublicStatus,
  type AccountDeletionStatus,
  type PrivateAccountCollection,
} from './types.js';

const PAGE_SIZE = 400;
const RECEIPT_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const RECEIPT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_ACCEPTED_RECEIPTS = 16;
const JOB_COLLECTION = 'account_deletions';

export class NonRetryableDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableDeletionError';
  }
}

function jobRef(uid: string) {
  return adminDb().collection(JOB_COLLECTION).doc(uid);
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (value && typeof value === 'object' && 'toMillis' in value
    && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    try { return (value as { toMillis: () => number }).toMillis(); }
    catch { return null; }
  }
  return null;
}

function timestampIso(value: unknown): string | undefined {
  const millis = timestampMillis(value);
  return millis === null ? undefined : new Date(millis).toISOString();
}

function isAuthUserNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error
    && String((error as { code?: unknown }).code) === 'auth/user-not-found');
}

export function validateReceipt(receipt: unknown): string {
  if (typeof receipt !== 'string' || !RECEIPT_PATTERN.test(receipt)) {
    throw new Error('Ricevuta di cancellazione non valida.');
  }
  return receipt;
}

export function validateUid(uid: unknown): string {
  if (typeof uid !== 'string' || uid.length < 1 || uid.length > 128 || uid.includes('/')) {
    throw new Error('Identificativo account non valido.');
  }
  return uid;
}

export function hashReceipt(receipt: string): string {
  return createHash('sha256').update(receipt, 'utf8').digest('hex');
}

function receiptMatches(receipt: string, expectedHash: unknown): boolean {
  if (typeof expectedHash !== 'string' || !RECEIPT_HASH_PATTERN.test(expectedHash)) return false;
  const actual = Buffer.from(hashReceipt(receipt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function acceptedReceiptHashes(job: Pick<AccountDeletionJob, 'receiptHash' | 'receiptHashes'>): string[] {
  const primary = typeof job.receiptHash === 'string' && RECEIPT_HASH_PATTERN.test(job.receiptHash)
    ? job.receiptHash
    : null;
  const additional = Array.isArray(job.receiptHashes)
    ? job.receiptHashes.filter((value): value is string => typeof value === 'string' && RECEIPT_HASH_PATTERN.test(value))
    : [];
  return [...new Set([...(primary ? [primary] : []), ...additional])].slice(0, MAX_ACCEPTED_RECEIPTS);
}

function appendAcceptedReceipt(job: Pick<AccountDeletionJob, 'receiptHash' | 'receiptHashes'>, nextHash: string): {
  receiptHash: string;
  receiptHashes: string[];
} {
  const current = acceptedReceiptHashes(job);
  const primary = current[0] ?? nextHash;
  const additional = [...current.slice(1).filter(hash => hash !== nextHash), ...(nextHash === primary ? [] : [nextHash])];
  return {
    receiptHash: primary,
    receiptHashes: additional.slice(-(MAX_ACCEPTED_RECEIPTS - 1)),
  };
}

function receiptMatchesJob(receipt: string, job: Pick<AccountDeletionJob, 'receiptHash' | 'receiptHashes'>): boolean {
  return acceptedReceiptHashes(job).some(hash => receiptMatches(receipt, hash));
}

export async function createOrRefreshDeletionJob(uidValue: string, receiptValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  const receiptHash = hashReceipt(validateReceipt(receiptValue));
  const ref = jobRef(uid);

  await adminDb().runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Timestamp.now();
    if (!snapshot.exists) {
      const job: AccountDeletionJob = {
        uid,
        requestedAt: now,
        updatedAt: now,
        status: 'requested',
        cursor: { phase: 'requested' },
        attempts: 0,
        receiptHash,
        receiptHashes: [],
      };
      transaction.create(ref, job);
      return;
    }

    const existing = snapshot.data() as AccountDeletionJob;
    const acceptedReceipts = appendAcceptedReceipt(existing, receiptHash);
    if (existing.status === 'failed' && existing.retryable !== false) {
      transaction.update(ref, {
        ...acceptedReceipts,
        updatedAt: now,
        status: 'requested',
        cursor: { phase: 'requested' },
        retryable: FieldValue.delete(),
        lastError: FieldValue.delete(),
        leaseOwner: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
      });
      return;
    }

    transaction.update(ref, { ...acceptedReceipts, updatedAt: now });
  });
}

export async function readAuthorizedDeletionJob(uidValue: string, receiptValue: string): Promise<AccountDeletionJob | null> {
  const uid = validateUid(uidValue);
  const receipt = validateReceipt(receiptValue);
  const snapshot = await jobRef(uid).get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as AccountDeletionJob;
  return receiptMatchesJob(receipt, job) ? job : null;
}

export async function acquireDeletionLease(uidValue: string, leaseOwner: string, deadlineMs: number): Promise<boolean> {
  const uid = validateUid(uidValue);
  const ref = jobRef(uid);
  return adminDb().runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const current = snapshot.data() as AccountDeletionJob;
    if (current.status === 'complete' || (current.status === 'failed' && current.retryable === false)) return false;

    const nowMs = Date.now();
    const currentLeaseUntil = timestampMillis(current.leaseUntil) ?? 0;
    if (currentLeaseUntil > nowMs && current.leaseOwner && current.leaseOwner !== leaseOwner) return false;

    transaction.update(ref, {
      status: current.status === 'verifying' ? 'verifying' : 'deleting',
      attempts: Math.max(0, Number(current.attempts) || 0) + 1,
      updatedAt: Timestamp.now(),
      leaseOwner,
      leaseUntil: Timestamp.fromMillis(Math.max(nowMs + 15_000, deadlineMs + 5_000)),
      retryable: FieldValue.delete(),
      lastError: FieldValue.delete(),
    });
    return true;
  });
}

export async function parkDeletion(
  uidValue: string,
  status: Extract<AccountDeletionStatus, 'deleting' | 'verifying'>,
  cursor: AccountDeletionCursor,
): Promise<void> {
  const uid = validateUid(uidValue);
  const ref = jobRef(uid);
  await adminDb().runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const current = snapshot.data() as AccountDeletionJob;
    if (current.status === 'complete') return;
    transaction.update(ref, {
      status,
      cursor,
      updatedAt: Timestamp.now(),
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
    });
  });
}

export async function revokeAccountAccess(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  try {
    await adminAuth().revokeRefreshTokens(uid);
  } catch (error) {
    if (!isAuthUserNotFound(error)) throw error;
  }
}

export async function deletePrivateCollectionPage(
  uidValue: string,
  name: PrivateAccountCollection,
  deletedBatches: number,
): Promise<number> {
  const uid = validateUid(uidValue);
  if (!PRIVATE_ACCOUNT_COLLECTIONS.includes(name)) throw new Error(`Unknown private collection: ${name}`);
  const db = adminDb();
  const page = await db.collection('users').doc(uid).collection(name).limit(PAGE_SIZE).select().get();
  if (page.empty) return 0;

  const batch = db.batch();
  for (const item of page.docs) batch.delete(item.ref);
  batch.update(jobRef(uid), {
    status: 'deleting',
    cursor: { phase: 'collection', collection: name, deletedBatches },
    updatedAt: Timestamp.now(),
  });
  await batch.commit();
  return page.size;
}

export async function deleteUserRoot(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  await adminDb().collection('users').doc(uid).delete();
  await jobRef(uid).update({
    status: 'deleting',
    cursor: { phase: 'root' },
    updatedAt: Timestamp.now(),
  });
}

export async function markVerifying(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  await jobRef(uid).update({
    status: 'verifying',
    cursor: { phase: 'verifying' },
    updatedAt: Timestamp.now(),
  });
}

export async function verifyNoAccountResidue(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  const users = adminDb().collection('users');
  const root = users.doc(uid);
  const rootSnapshot = await users.where(FieldPath.documentId(), '==', uid).select().limit(1).get();
  if (!rootSnapshot.empty) throw new Error('User root document still exists after deletion.');

  for (const name of PRIVATE_ACCOUNT_COLLECTIONS) {
    const residual = await root.collection(name).limit(1).select().get();
    if (!residual.empty) throw new Error(`Residual documents remain in ${name}.`);
  }

  const known = new Set<string>(PRIVATE_ACCOUNT_COLLECTIONS);
  const collections = await root.listCollections();
  for (const collection of collections) {
    if (known.has(collection.id)) continue;
    const residual = await collection.limit(1).select().get();
    if (!residual.empty) {
      throw new NonRetryableDeletionError(`Unexpected residual collection: ${collection.id}.`);
    }
  }
}

export async function deleteAuthUserLast(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  await jobRef(uid).update({
    status: 'verifying',
    cursor: { phase: 'auth' },
    updatedAt: Timestamp.now(),
  });
  try {
    await adminAuth().deleteUser(uid);
  } catch (error) {
    if (!isAuthUserNotFound(error)) throw error;
  }
}

export async function markDeletionComplete(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  const now = Timestamp.now();
  await jobRef(uid).update({
    status: 'complete',
    cursor: { phase: 'complete' },
    updatedAt: now,
    purgeAfter: completedDeletionPurgeAfter(now),
    retryable: FieldValue.delete(),
    lastError: FieldValue.delete(),
    leaseOwner: FieldValue.delete(),
    leaseUntil: FieldValue.delete(),
  });
}

export async function markDeletionFailed(
  uidValue: string,
  phase: string,
  error: unknown,
  retryable: boolean,
): Promise<void> {
  const uid = validateUid(uidValue);
  const message = error instanceof Error ? error.message : String(error);
  const ref = jobRef(uid);
  await adminDb().runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return;
    const current = snapshot.data() as AccountDeletionJob;
    if (current.status === 'complete') return;
    transaction.update(ref, {
      status: 'failed',
      retryable,
      updatedAt: Timestamp.now(),
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      lastError: {
        phase: phase.slice(0, 64),
        message: message.slice(0, 300),
      },
    });
  });
}

function publicStatus(job: AccountDeletionJob): AccountDeletionPublicStatus {
  return {
    uid: job.uid,
    status: job.status,
    attempts: Math.max(0, Number(job.attempts) || 0),
    cursor: job.cursor,
    requestedAt: timestampIso(job.requestedAt),
    updatedAt: timestampIso(job.updatedAt),
    retryable: job.status === 'failed' ? job.retryable !== false : undefined,
    error: job.status === 'failed'
      ? 'Cancellazione cloud incompleta. Alcuni dati potrebbero essere già stati eliminati; riprova dalle impostazioni.'
      : undefined,
  };
}

export async function readDeletionStatusForUid(uidValue: string): Promise<AccountDeletionPublicStatus | null> {
  const uid = validateUid(uidValue);
  const snapshot = await jobRef(uid).get();
  return snapshot.exists ? publicStatus(snapshot.data() as AccountDeletionJob) : null;
}

export async function readDeletionStatus(uidValue: string, receiptValue: string): Promise<AccountDeletionPublicStatus | null> {
  const uid = validateUid(uidValue);
  const receipt = validateReceipt(receiptValue);
  const snapshot = await jobRef(uid).get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as AccountDeletionJob;
  if (!receiptMatchesJob(receipt, job)) return null;

  return publicStatus(job);
}

export async function listRecoverableDeletionJobs(limitCount = 20): Promise<AccountDeletionJob[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limitCount)));
  const collection = adminDb().collection(JOB_COLLECTION);
  const [active, retryableFailed] = await Promise.all([
    collection.where('status', 'in', ['requested', 'deleting', 'verifying']).limit(boundedLimit).get(),
    collection.where('status', '==', 'failed').where('retryable', '==', true).limit(boundedLimit).get(),
  ]);

  const unique = new Map<string, AccountDeletionJob>();
  for (const item of [...active.docs, ...retryableFailed.docs] as QueryDocumentSnapshot[]) {
    unique.set(item.id, item.data() as AccountDeletionJob);
  }
  return [...unique.values()]
    .sort((left, right) => (timestampMillis(left.updatedAt) ?? 0) - (timestampMillis(right.updatedAt) ?? 0))
    .slice(0, boundedLimit);
}
