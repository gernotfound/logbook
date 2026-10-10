import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { adminDb } from './accountDeletion/firebaseAdmin.js';

const TELEMETRY_COLLECTIONS = [
  'telemetry_errors',
  'telemetry_events',
  'telemetry_anomalies',
] as const;

// Scan expired documents, not every user. Collection-group queries include
// telemetry beneath missing parent documents and consume bounded memory.
const TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE = 400;
const TELEMETRY_RETENTION_SAFETY_BUFFER_MS = 5_000;

export interface TelemetryRetentionSweepResult {
  /** Distinct owners with expired documents encountered in this invocation. */
  usersScanned: number;
  documentsDeleted: number;
  completedCycle: boolean;
}

function hasBudget(deadlineMs: number): boolean {
  return Date.now() + TELEMETRY_RETENTION_SAFETY_BUFFER_MS < deadlineMs;
}

export async function purgeExpiredTelemetry(
  deadlineMs: number,
  now = Timestamp.now(),
): Promise<TelemetryRetentionSweepResult> {
  const db: Firestore = adminDb();
  const scannedOwners = new Set<string>();
  let documentsDeleted = 0;

  for (const collectionName of TELEMETRY_COLLECTIONS) {
    while (hasBudget(deadlineMs)) {
      const snapshot = await db.collectionGroup(collectionName)
        .where('expireAt', '<=', now)
        .limit(TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE)
        .get();

      if (snapshot.empty) break;

      // Collection-group queries include any identically named collection:
      // never delete a document outside the intended private user paths.
      for (const doc of snapshot.docs) {
        const path = doc.ref.path.split('/');
        if (path.length !== 4 || path[0] !== 'users' || !path[1] ||
          path[2] !== collectionName || !path[3]) {
          throw new Error('Unexpected telemetry retention document location');
        }
      }

      const batch = db.batch();
      for (const doc of snapshot.docs) {
        scannedOwners.add(doc.ref.path.split('/')[1]);
        batch.delete(doc.ref);
      }
      await batch.commit();
      documentsDeleted += snapshot.size;

      // An exactly full page can have additional expired documents.
      if (snapshot.size < TELEMETRY_RETENTION_DOCUMENT_PAGE_SIZE) break;
    }

    if (!hasBudget(deadlineMs)) {
      return { usersScanned: scannedOwners.size, documentsDeleted, completedCycle: false };
    }
  }

  return { usersScanned: scannedOwners.size, documentsDeleted, completedCycle: true };
}
