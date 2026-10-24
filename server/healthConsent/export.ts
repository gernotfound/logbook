import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';
import { readHealthConsentState } from './withdrawal.js';

const HEALTH_EXPORT_PAGE_SIZE = 2;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export type HealthExportCollection = 'root' | 'history_months' | 'nutrition_months' | 'checkpoint';
type HealthExportItem = { path: string; data: Record<string, unknown> };
export type HealthExportPage = { documents: HealthExportItem[]; nextCursor: string | null; consentRevision: number };

// There is no transaction covering the multi-request export. The server must
// fence each page against a concurrent destructive job, and the client must
// check the generation once again after its final page.
async function exportCheckpoint(uid: string): Promise<number> {
  const state = await readHealthConsentState(uid);
  if (state.status !== 'withdrawn') throw new Error('Export endpoint available only during withdrawal');
  const snap = await adminDb().collection('health_data_erasures').doc(uid).get();
  const job = snap.data();
  if (snap.exists && (!job || job.uid !== uid || job.status !== 'complete')) {
    throw new Error('Export suspended by an in-progress data erasure');
  }
  return state.revision;
}

/** Server-only, owner-authenticated export. Never exposes internal consent/deletion jobs. */
export async function readWithdrawnHealthExportPage(
  uid: string, name: HealthExportCollection, after: string | null,
): Promise<HealthExportPage> {
  if (!uid || uid.includes('/') || uid.length > 128) throw new Error('Invalid uid');
  if (!['root', 'history_months', 'nutrition_months', 'checkpoint'].includes(name)) throw new Error('Invalid export collection');
  if (after !== null && (!MONTH_RE.test(after) || name === 'root' || name === 'checkpoint')) throw new Error('Invalid cursor');
  const revision = await exportCheckpoint(uid);
  if (name === 'checkpoint') return { documents: [], nextCursor: null, consentRevision: revision };
  const root = adminDb().collection('users').doc(uid);
  if (name === 'root') {
    const snap = await root.get();
    if (await exportCheckpoint(uid) !== revision) throw new Error('Consent generation changed during export');
    return { documents: snap.exists ? [{ path: '', data: snap.data() ?? {} }] : [], nextCursor: null, consentRevision: revision };
  }
  let query = root.collection(name).orderBy(FieldPath.documentId());
  if (after !== null) query = query.startAfter(after);
  const snapshots = await query.limit(HEALTH_EXPORT_PAGE_SIZE).get();
  const documents = snapshots.docs.map(doc => ({ path: name + '/' + doc.id, data: doc.data() }));
  const last = snapshots.docs.at(-1);
  if (await exportCheckpoint(uid) !== revision) throw new Error('Consent generation changed during export');
  return { documents, nextCursor: snapshots.docs.length === HEALTH_EXPORT_PAGE_SIZE && last ? last.id : null, consentRevision: revision };
}
