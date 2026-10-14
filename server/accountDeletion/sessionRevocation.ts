import { Timestamp, type Transaction } from 'firebase-admin/firestore';
import { adminAuth, adminDb } from './firebaseAdmin.js';

const COLLECTION = 'session_revocations';

function sessionMarker(uid: string) {
  return adminDb().collection(COLLECTION).doc(uid);
}

function validSeconds(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Invalid existing session revocation barrier.');
  }
  return value;
}

/**
 * Place the Firestore barrier BEFORE revoking refresh tokens, so an ambiguous
 * failure cannot leave previously issued ID tokens authorized for another hour.
 * Both updates are monotonic. A failed/partial request can be retried after
 * reauthentication, without ever restoring an older session.
 */
async function advanceBarrier(uid: string, seconds: number): Promise<number> {
  const marker = sessionMarker(uid);
  return adminDb().runTransaction(async (transaction: Transaction) => {
    const old = await transaction.get(marker);
    const previous = old.exists ? validSeconds(old.data()?.revokedAfterSeconds) : 0;
    const next = Math.max(previous, validSeconds(seconds));
    transaction.set(marker, {
      revokedAfterSeconds: next,
      updatedAt: Timestamp.now(),
    });
    return next;
  });
}

export async function revokeAllUserSessions(uid: string): Promise<void> {
  // UID is obtained exclusively from an authenticated, recent Firebase token.
  await advanceBarrier(uid, Math.floor(Date.now() / 1000));
  await adminAuth().revokeRefreshTokens(uid);

  // Firebase's actual token-valid-after time is the authoritative threshold.
  // An error here must not remove the first Firestore barrier.
  const record = await adminAuth().getUser(uid);
  const actualTime = Date.parse(record.tokensValidAfterTime ?? '');
  if (!Number.isFinite(actualTime)) {
    throw new Error('Firebase did not return a valid token revocation timestamp.');
  }
  await advanceBarrier(uid, Math.floor(actualTime / 1000));
}
