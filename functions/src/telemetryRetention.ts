import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
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

  // listDocuments() deliberately includes missing parent documents that still
  // have subcollections. Querying only existing /users/{uid} documents would
  // orphan telemetry written before the user's root document exists.
  const userRefs = (await db.collection(USER_COLLECTION).listDocuments())
    .sort((a, b) => a.id.localeCompare(b.id));
  const cursorId = cursor;
  let index = cursorId
    ? userRefs.findIndex(ref => ref.id > cursorId)
    : 0;
  if (index < 0) index = userRefs.length;

  while (index < userRefs.length && hasBudget(deadlineMs)) {
    const page = userRefs.slice(index, index + TELEMETRY_RETENTION_USER_PAGE_SIZE);

    for (const userRef of page) {
      if (!hasBudget(deadlineMs)) {
        await writeCursor(db, cursor);
        return { usersScanned, documentsDeleted, completedCycle: false };
      }

      const result = await purgeUserTelemetry(db, userRef, now, deadlineMs);
      documentsDeleted += result.deleted;

      if (!result.complete) {
        await writeCursor(db, cursor);
        return { usersScanned, documentsDeleted, completedCycle: false };
      }

      cursor = userRef.id;
      usersScanned += 1;
      index += 1;
    }
  }

  if (index >= userRefs.length) {
    await writeCursor(db, null);
    return { usersScanned, documentsDeleted, completedCycle: true };
  }

  await writeCursor(db, cursor);
  return { usersScanned, documentsDeleted, completedCycle: false };
}
