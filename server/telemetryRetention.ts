import { FieldPath, Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { adminDb } from './accountDeletion/firebaseAdmin.js';

const USER_COLLECTION = 'users';
const STATE_COLLECTION = 'maintenance';
const STATE_DOCUMENT = 'telemetry_retention';
const TELEMETRY_COLLECTIONS = [
  'telemetry_errors',
  'telemetry_events',
  'telemetry_anomalies',
] as const;

export const TELEMETRY_RETENTION_USER_PAGE_SIZE = 50;
export const TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE = 400;
const TELEMETRY_RETENTION_SAFETY_BUFFER_MS = 5_000;

type TelemetryCollectionName = typeof TELEMETRY_COLLECTIONS[number];

export interface TelemetryRetentionSweepResult {
  usersScanned: number;
  documentsDeleted: number;
  completedCycle: boolean;
}

interface RetentionState {
  lastCompletedUserId?: unknown;
}

function hasBudget(deadlineMs: number): boolean {
  return Date.now() + TELEMETRY_RETENTION_SAFETY_BUFFER_MS < deadlineMs;
}

async function readCursor(db: Firestore): Promise<string | null> {
  const snapshot = await db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT).get();
  if (!snapshot.exists) return null;
  const value = (snapshot.data() as RetentionState | undefined)?.lastCompletedUserId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

async function writeCursor(db: Firestore, lastCompletedUserId: string | null): Promise<void> {
  await db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT).set({
    lastCompletedUserId,
    updatedAt: Timestamp.now(),
  }, { merge: true });
}

async function purgeUserTelemetryCollection(
  db: Firestore,
  userRef: DocumentReference,
  collectionName: TelemetryCollectionName,
  now: Timestamp,
  deadlineMs: number,
): Promise<{ deleted: number; complete: boolean }> {
  let deleted = 0;

  while (hasBudget(deadlineMs)) {
    const snapshot = await userRef.collection(collectionName)
      .where('expireAt', '<=', now)
      .limit(TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE)
      .get();

    if (snapshot.empty) return { deleted, complete: true };

    const batch = db.batch();
    for (const item of snapshot.docs) batch.delete(item.ref);
    await batch.commit();
    deleted += snapshot.size;

    if (snapshot.size < TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE) {
      return { deleted, complete: true };
    }
  }

  return { deleted, complete: false };
}

async function purgeUserTelemetry(
  db: Firestore,
  userRef: DocumentReference,
  now: Timestamp,
  deadlineMs: number,
): Promise<{ deleted: number; complete: boolean }> {
  let deleted = 0;

  for (const collectionName of TELEMETRY_COLLECTIONS) {
    if (!hasBudget(deadlineMs)) return { deleted, complete: false };
    const result = await purgeUserTelemetryCollection(db, userRef, collectionName, now, deadlineMs);
    deleted += result.deleted;
    if (!result.complete) return { deleted, complete: false };
  }

  return { deleted, complete: true };
}

export async function purgeExpiredTelemetry(
  deadlineMs: number,
  now = Timestamp.now(),
): Promise<TelemetryRetentionSweepResult> {
  const db = adminDb();
  let cursor = await readCursor(db);
  let usersScanned = 0;
  let documentsDeleted = 0;

  while (hasBudget(deadlineMs)) {
    let query = db.collection(USER_COLLECTION)
      .orderBy(FieldPath.documentId())
      .limit(TELEMETRY_RETENTION_USER_PAGE_SIZE);

    if (cursor) query = query.startAfter(cursor);

    const users = await query.get();

    if (users.empty) {
      await writeCursor(db, null);
      return { usersScanned, documentsDeleted, completedCycle: true };
    }

    for (const user of users.docs) {
      if (!hasBudget(deadlineMs)) {
        await writeCursor(db, cursor);
        return { usersScanned, documentsDeleted, completedCycle: false };
      }

      const result = await purgeUserTelemetry(db, user.ref, now, deadlineMs);
      documentsDeleted += result.deleted;

      if (!result.complete) {
        await writeCursor(db, cursor);
        return { usersScanned, documentsDeleted, completedCycle: false };
      }

      cursor = user.id;
      usersScanned += 1;
    }

    if (users.size < TELEMETRY_RETENTION_USER_PAGE_SIZE) {
      await writeCursor(db, null);
      return { usersScanned, documentsDeleted, completedCycle: true };
    }
  }

  await writeCursor(db, cursor);
  return { usersScanned, documentsDeleted, completedCycle: false };
}
