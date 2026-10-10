import { FieldPath, Timestamp, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { adminDb } from './accountDeletion/firebaseAdmin.js';

const USER_COLLECTION = 'users';
const TELEMETRY_COLLECTIONS = [
  'telemetry_errors',
  'telemetry_events',
  'telemetry_anomalies',
] as const;

const TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE = 400;
const TELEMETRY_RETENTION_SAFETY_BUFFER_MS = 5_000;
const EXPECTED_TELEMETRY_PATH_SEGMENTS = 4;

type TelemetryCollectionName = typeof TELEMETRY_COLLECTIONS[number];

export interface TelemetryRetentionSweepResult {
  documentsScanned: number;
  documentsDeleted: number;
  unexpectedDocuments: number;
  completedCycle: boolean;
}

function hasBudget(deadlineMs: number): boolean {
  return Date.now() + TELEMETRY_RETENTION_SAFETY_BUFFER_MS < deadlineMs;
}

function isExpectedTelemetryPath(path: string, collectionName: TelemetryCollectionName): boolean {
  const segments = path.split('/');
  return segments.length === EXPECTED_TELEMETRY_PATH_SEGMENTS
    && segments[0] === USER_COLLECTION
    && segments[1].length > 0
    && segments[2] === collectionName
    && segments[3].length > 0;
}

async function purgeTelemetryCollectionGroup(
  db: Firestore,
  collectionName: TelemetryCollectionName,
  now: Timestamp,
  deadlineMs: number,
) {
  let scanned = 0;
  let deleted = 0;
  let unexpected = 0;
  let cursor: QueryDocumentSnapshot | null = null;

  while (hasBudget(deadlineMs)) {
    let query = db.collectionGroup(collectionName)
      .where('expireAt', '<=', now)
      .orderBy('expireAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();

    if (snapshot.empty) return { scanned, deleted, unexpected, complete: true };

    scanned += snapshot.size;

    const batch = db.batch();
    let pageDeleted = 0;
    for (const item of snapshot.docs) {
      if (!isExpectedTelemetryPath(item.ref.path, collectionName)) {
        unexpected += 1;
        continue;
      }
      batch.delete(item.ref);
      pageDeleted += 1;
    }
    if (pageDeleted > 0) {
      await batch.commit();
      deleted += pageDeleted;
    }

    cursor = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.size < TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE) {
      return { scanned, deleted, unexpected, complete: true };
    }
  }

  return { scanned, deleted, unexpected, complete: false };
}

export async function purgeExpiredTelemetry(
  deadlineMs: number,
  now = Timestamp.now(),
): Promise<TelemetryRetentionSweepResult> {
  const db = adminDb();
  let documentsScanned = 0;
  let documentsDeleted = 0;
  let unexpectedDocuments = 0;

  for (const collectionName of TELEMETRY_COLLECTIONS) {
    if (!hasBudget(deadlineMs)) {
      return { documentsScanned, documentsDeleted, unexpectedDocuments, completedCycle: false };
    }
    const result = await purgeTelemetryCollectionGroup(db, collectionName, now, deadlineMs);
    documentsScanned += result.scanned;
    documentsDeleted += result.deleted;
    unexpectedDocuments += result.unexpected;
    if (!result.complete) {
      return { documentsScanned, documentsDeleted, unexpectedDocuments, completedCycle: false };
    }
  }

  return { documentsScanned, documentsDeleted, unexpectedDocuments, completedCycle: true };
}
