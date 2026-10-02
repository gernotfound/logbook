import { createHash, timingSafeEqual } from 'node:crypto';
import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { validateUid } from './jobStore.js';

const COLLECTION = 'account_deletion_devices';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
export const MAX_DELETION_RECOVERY_DEVICES = 12;

type RecoveryRegistry = {
  uid: string;
  tokenHashes: string[];
  registeredAt: Timestamp;
  updatedAt: Timestamp;
};

export class DeletionRecoveryInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DeletionRecoveryInputError';
  }
}

function validateToken(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    throw new DeletionRecoveryInputError('Credenziale device non valida.');
  }
  return value;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function matches(token: string, hash: string): boolean {
  if (!HASH_PATTERN.test(hash)) return false;
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseHashes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_DELETION_RECOVERY_DEVICES) {
    throw new Error('Registro recovery device non valido.');
  }
  const hashes = value.filter((item): item is string => typeof item === 'string' && HASH_PATTERN.test(item));
  if (hashes.length !== value.length || new Set(hashes).size !== hashes.length) {
    throw new Error('Registro recovery device non valido.');
  }
  return hashes;
}

function registryRef(uid: string) {
  return adminDb().collection(COLLECTION).doc(uid);
}

export async function registerDeletionRecoveryDevice(uidValue: string, tokenValue: unknown): Promise<void> {
  const uid = validateUid(uidValue);
  const token = validateToken(tokenValue);
  const tokenHash = hashToken(token);
  const ref = registryRef(uid);

  await adminDb().runTransaction(async (transaction: Transaction) => {
    const snapshot = await transaction.get(ref);
    const now = Timestamp.now();

    if (!snapshot.exists) {
      const registry: RecoveryRegistry = {
        uid,
        tokenHashes: [tokenHash],
        registeredAt: now,
        updatedAt: now,
      };
      transaction.create(ref, registry);
      return;
    }

    const current = snapshot.data() as Partial<RecoveryRegistry>;
    if (current.uid !== uid) throw new Error('Registro recovery device non coerente.');
    const hashes = parseHashes(current.tokenHashes);
    if (hashes.includes(tokenHash)) {
      transaction.update(ref, {
        tokenHashes: [...hashes.filter(hash => hash !== tokenHash), tokenHash],
        updatedAt: now,
      });
      return;
    }
    const nextHashes = hashes.length >= MAX_DELETION_RECOVERY_DEVICES
      ? [...hashes.slice(1), tokenHash]
      : [...hashes, tokenHash];

    transaction.update(ref, {
      tokenHashes: nextHashes,
      updatedAt: now,
    });
  });
}

export async function verifyDeletionRecoveryDevice(uidValue: unknown, tokenValue: unknown): Promise<boolean> {
  let uid: string;
  let token: string;
  try {
    uid = validateUid(uidValue);
    token = validateToken(tokenValue);
  } catch {
    return false;
  }

  const snapshot = await registryRef(uid).get();
  if (!snapshot.exists) return false;
  const data = snapshot.data() as Partial<RecoveryRegistry>;
  if (data.uid !== uid) return false;

  let hashes: string[];
  try {
    hashes = parseHashes(data.tokenHashes);
  } catch {
    return false;
  }
  return hashes.some(hash => matches(token, hash));
}

export async function purgeDeletionRecoveryDevices(uidValue: string): Promise<number> {
  const uid = validateUid(uidValue);
  const ref = registryRef(uid);
  const snapshot = await ref.get();
  if (!snapshot.exists) return 0;
  await ref.delete();
  return 1;
}
