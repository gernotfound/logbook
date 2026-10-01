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
const MAX_AUTHORIZED_RECEIPTS = 32;
const JOB_COLLECTION = 'account_deletions';
const RECOVERY_COLLECTION = 'account_deletion_recovery';
const RECOVERY_RETRY_BASE_MS = 5 * 60 * 1000;
const RECOVERY_RETRY_MAX_MS = 24 * 60 * 60 * 1000;

export class NonRetryableDeletionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableDeletionError';
  }
}

function jobRef(uid: string) {
  return adminDb().collection(JOB_COLLECTION).doc(uid);
}
function recoveryRef(uid: string) {
  return adminDb().collection(RECOVERY_COLLECTION).doc(uid);
}
function retryDelayMs(attempts: number): number {
  const exponent = Math.max(0, Math.min(8, Math.floor(attempts) - 1));
  return Math.min(RECOVERY_RETRY_MAX_MS, RECOVERY_RETRY_BASE_MS * (2 ** exponent));
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
export function validateRecoveryCredential(value: unknown): string {
  if (typeof value !== 'string' || !RECEIPT_PATTERN.test(value)) {
    throw new Error('Credenziale di recovery non valida.');
  }
  return value;
}
export function hashReceipt(receipt: string): string {
  return createHash('sha256').update(receipt, 'utf8').digest('hex');
}
function validReceiptHashes(job: Pick<AccountDeletionJob, 'receiptHash' | 'receiptHashes'>): string[] {
  const hashes = [
    job.receiptHash,
    ...(Array.isArray(job.receiptHashes) ? job.receiptHashes : []),
  ].filter((value): value is string => typeof value === 'string' && RECEIPT_HASH_PATTERN.test(value));
  return [...new Set(hashes)];
}
function validRecoveryHashes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (item): item is string => typeof item === 'string' && RECEIPT_HASH_PATTERN.test(item),
  ))].slice(0, MAX_AUTHORIZED_RECEIPTS);
}
function hashMatches(value: string, hashes: string[]): boolean {
  const actual = Buffer.from(hashReceipt(value), 'hex');
  return hashes.some(expectedHash => {
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
function receiptMatches(receipt: string, job: Pick<AccountDeletionJob, 'receiptHash' | 'receiptHashes'>): boolean {
  return hashMatches(receipt, validReceiptHashes(job));
}
function recoveryCredentialMatches(
  credential: string,
  job: Pick<AccountDeletionJob, 'recoveryCredentialHashes'>,
): boolean {
  return hashMatches(credential, validRecoveryHashes(job.recoveryCredentialHashes));
}
function withAuthorizedReceipt(
  job: Pick<AccountDeletionJob, 'receiptHash' | 'receiptHashes'>,
  receiptHash: string,
): { receiptHash: string; receiptHashes?: string[] } {
  const existing = validReceiptHashes(job);
  const primary = existing[0] ?? receiptHash;
  if (!existing.includes(receiptHash) && existing.length >= MAX_AUTHORIZED_RECEIPTS) {
    throw new Error('Numero massimo di dispositivi di recovery raggiunto. Le ricevute già autorizzate restano valide.');
  }
  const all = existing.includes(receiptHash) ? existing : [...existing, receiptHash];
  return all.length > 1 ? { receiptHash: primary, receiptHashes: all } : { receiptHash: primary };
}
function mergeRecoveryHashes(...values: unknown[]): string[] {
  const merged = [...new Set(values.flatMap(value => validRecoveryHashes(value)))];
  if (merged.length > MAX_AUTHORIZED_RECEIPTS) {
    throw new Error('Numero massimo di dispositivi di recovery raggiunto.');
  }
  return merged;
}

export async function registerDeletionRecoveryCredential(uidValue: string, credentialValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  const credentialHash = hashReceipt(validateRecoveryCredential(credentialValue));
  const registration = recoveryRef(uid);
  const deletion = jobRef(uid);

  await adminDb().runTransaction(async (transaction: Transaction) => {
    const registrationSnapshot = await transaction.get(registration);
    const deletionSnapshot = await transaction.get(deletion);
    const job = deletionSnapshot.exists ? deletionSnapshot.data() as AccountDeletionJob : null;
    if (job?.status === 'complete') return;

    const existingRegistration = registrationSnapshot.exists
      ? registrationSnapshot.data() as { credentialHashes?: unknown }
      : {};
    const existingHashes = validRecoveryHashes(existingRegistration.credentialHashes);
    if (!existingHashes.includes(credentialHash) && existingHashes.length >= MAX_AUTHORIZED_RECEIPTS) {
      throw new Error('Numero massimo di dispositivi di recovery raggiunto.');
    }
    const credentialHashes = existingHashes.includes(credentialHash)
      ? existingHashes
      : [...existingHashes, credentialHash];
    const now = Timestamp.now();

    if (registrationSnapshot.exists) {
      transaction.update(registration, { uid, credentialHashes, updatedAt: now });
    } else {
      transaction.create(registration, { uid, credentialHashes, createdAt: now, updatedAt: now });
    }

    if (!job) return;
    transaction.update(deletion, {
      recoveryCredentialHashes: mergeRecoveryHashes(job.recoveryCredentialHashes, credentialHashes),
      updatedAt: now,
    });
  });
}

export async function createOrRefreshDeletionJob(uidValue: string, receiptValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  const receiptHash = hashReceipt(validateReceipt(receiptValue));
  const ref = jobRef(uid);

  await adminDb().runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);
    const registrationSnapshot = await transaction.get(recoveryRef(uid));
    const registeredRecoveryHashes = registrationSnapshot.exists
      ? validRecoveryHashes((registrationSnapshot.data() as { credentialHashes?: unknown }).credentialHashes)
      : [];
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
        recoveryCredentialHashes: registeredRecoveryHashes.length ? registeredRecoveryHashes : undefined,
        nextAttemptAt: now,
      };
      transaction.create(ref, job);
      return;
    }

    const existing = snapshot.data() as AccountDeletionJob;
    const authorizedReceipts = withAuthorizedReceipt(existing, receiptHash);
    const recoveryCredentialHashes = mergeRecoveryHashes(existing.recoveryCredentialHashes, registeredRecoveryHashes);
    if (existing.status === 'failed' && existing.retryable !== false) {
      transaction.update(ref, {
        ...authorizedReceipts,
        recoveryCredentialHashes: recoveryCredentialHashes.length ? recoveryCredentialHashes : FieldValue.delete(),
        updatedAt: now,
        status: 'requested',
        cursor: { phase: 'requested' },
        nextAttemptAt: now,
        retryable: FieldValue.delete(),
        lastError: FieldValue.delete(),
        leaseOwner: FieldValue.delete(),
        leaseUntil: FieldValue.delete(),
      });
      return;
    }

    transaction.update(ref, {
      ...authorizedReceipts,
      recoveryCredentialHashes: recoveryCredentialHashes.length ? recoveryCredentialHashes : FieldValue.delete(),
      updatedAt: now,
    });
  });
}

export async function readAuthorizedDeletionJob(uidValue: string, receiptValue: string): Promise<AccountDeletionJob | null> {
  const uid = validateUid(uidValue);
  const receipt = validateReceipt(receiptValue);
  const snapshot = await jobRef(uid).get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as AccountDeletionJob;
  return receiptMatches(receipt, job) ? job : null;
}

export async function acquireDeletionLease(uidValue: string, leaseOwner: string, deadlineMs: number): Promise<boolean> {
  const uid = validateUid(uidValue);
  const ref = jobRef(uid);
  return adminDb().runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) return false;
    const current = snapshot.data() as AccountDeletionJob;
    if (current.status === 'complete' || (current.status === 'failed' && current.retryable === false)) {
      if (current.nextAttemptAt !== undefined) transaction.update(ref, { nextAttemptAt: FieldValue.delete() });
      return false;
    }

    const nowMs = Date.now();
    const currentLeaseUntil = timestampMillis(current.leaseUntil) ?? 0;
    if (currentLeaseUntil > nowMs && current.leaseOwner && current.leaseOwner !== leaseOwner) return false;

    const leaseUntil = Timestamp.fromMillis(Math.max(nowMs + 15_000, deadlineMs + 5_000));
    transaction.update(ref, {
      status: current.status === 'verifying' ? 'verifying' : 'deleting',
      attempts: Math.max(0, Number(current.attempts) || 0) + 1,
      updatedAt: Timestamp.now(),
      leaseOwner,
      leaseUntil,
      nextAttemptAt: leaseUntil,
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
    const now = Timestamp.now();
    transaction.update(ref, {
      status,
      cursor,
      updatedAt: now,
      nextAttemptAt: Timestamp.fromMillis(now.toMillis() + RECOVERY_RETRY_BASE_MS),
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
  await jobRef(uid).update({ status: 'deleting', cursor: { phase: 'root' }, updatedAt: Timestamp.now() });
}
export async function markVerifying(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  await jobRef(uid).update({ status: 'verifying', cursor: { phase: 'verifying' }, updatedAt: Timestamp.now() });
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
    if (!residual.empty) throw new NonRetryableDeletionError(`Unexpected residual collection: ${collection.id}.`);
  }
}
export async function deleteAuthUserLast(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  await jobRef(uid).update({ status: 'verifying', cursor: { phase: 'auth' }, updatedAt: Timestamp.now() });
  try {
    await adminAuth().deleteUser(uid);
  } catch (error) {
    if (!isAuthUserNotFound(error)) throw error;
  }
}

export async function markDeletionComplete(uidValue: string): Promise<void> {
  const uid = validateUid(uidValue);
  const now = Timestamp.now();
  const purgeAfter = completedDeletionPurgeAfter(now);
  await adminDb().runTransaction(async (transaction: Transaction) => {
    transaction.update(jobRef(uid), {
      status: 'complete',
      cursor: { phase: 'complete' },
      updatedAt: now,
      purgeAfter,
      purgeEligibleAt: purgeAfter,
      nextAttemptAt: FieldValue.delete(),
      retryable: FieldValue.delete(),
      lastError: FieldValue.delete(),
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
    });
    transaction.delete(recoveryRef(uid));
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
    const now = Timestamp.now();
    const attempts = Math.max(1, Number(current.attempts) || 1);
    transaction.update(ref, {
      status: 'failed',
      retryable,
      updatedAt: now,
      nextAttemptAt: retryable ? Timestamp.fromMillis(now.toMillis() + retryDelayMs(attempts)) : FieldValue.delete(),
      leaseOwner: FieldValue.delete(),
      leaseUntil: FieldValue.delete(),
      lastError: { phase: phase.slice(0, 64), message: message.slice(0, 300) },
    });
  });
}

function publicStatus(uid: string, job: AccountDeletionJob): AccountDeletionPublicStatus {
  return {
    uid,
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
export async function readDeletionStatus(uidValue: string, receiptValue: string): Promise<AccountDeletionPublicStatus | null> {
  const uid = validateUid(uidValue);
  const receipt = validateReceipt(receiptValue);
  const snapshot = await jobRef(uid).get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as AccountDeletionJob;
  return receiptMatches(receipt, job) ? publicStatus(uid, job) : null;
}
export async function readDeletionStatusWithRecoveryCredential(
  uidValue: string,
  credentialValue: string,
): Promise<AccountDeletionPublicStatus | null> {
  const uid = validateUid(uidValue);
  const credential = validateRecoveryCredential(credentialValue);
  const snapshot = await jobRef(uid).get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as AccountDeletionJob;
  return recoveryCredentialMatches(credential, job) ? publicStatus(uid, job) : null;
}
export async function listRecoverableDeletionJobs(
  limitCount = 20,
  now = Timestamp.now(),
): Promise<AccountDeletionJob[]> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limitCount)));
  const snapshot = await adminDb().collection(JOB_COLLECTION)
    .where('nextAttemptAt', '<=', now)
    .orderBy('nextAttemptAt', 'asc')
    .limit(boundedLimit)
    .get();
  return snapshot.docs.map((item: QueryDocumentSnapshot) => item.data() as AccountDeletionJob);
}
