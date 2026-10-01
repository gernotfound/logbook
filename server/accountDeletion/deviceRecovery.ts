import { createHash, timingSafeEqual } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { adminDb } from './firebaseAdmin.js';
import { validateUid } from './jobStore.js';

const COLLECTION = 'account_deletion_devices';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function validateToken(value: unknown): string {
  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) throw new Error('Credenziale device non valida.');
  return value;
}
function hashToken(token: string): string { return createHash('sha256').update(token, 'utf8').digest('hex'); }
function matches(token: string, hash: string): boolean {
  const actual=Buffer.from(hashToken(token),'hex'); const expected=Buffer.from(hash,'hex');
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export async function registerDeletionRecoveryDevice(uidValue: string, tokenValue: unknown): Promise<void> {
  const uid=validateUid(uidValue); const token=validateToken(tokenValue); const hash=hashToken(token);
  await adminDb().collection(COLLECTION).doc(hash).set({ uid, tokenHash: hash, registeredAt: Timestamp.now(), updatedAt: Timestamp.now() });
}
export async function verifyDeletionRecoveryDevice(uidValue: string, tokenValue: unknown): Promise<boolean> {
  const uid=validateUid(uidValue); const token=validateToken(tokenValue); const hash=hashToken(token);
  const snap=await adminDb().collection(COLLECTION).doc(hash).get();
  if(!snap.exists) return false;
  const data=snap.data() as {uid?:unknown;tokenHash?:unknown};
  return data.uid===uid && typeof data.tokenHash==='string' && matches(token,data.tokenHash);
}
