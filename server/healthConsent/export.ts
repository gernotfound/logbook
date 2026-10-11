import { FieldPath } from 'firebase-admin/firestore';
import { adminDb } from '../accountDeletion/firebaseAdmin.js';
import { readHealthConsentState } from './withdrawal.js';

const HEALTH_EXPORT_PAGE_SIZE = 2;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export type HealthExportCollection = 'root' | 'history_months' | 'nutrition_months';
type HealthExportItem = { path: string; data: Record<string, unknown> };
export type HealthExportPage = { documents: HealthExportItem[]; nextCursor: string | null };

/** Server-only, owner-authenticated export. Never exposes internal consent/deletion jobs. */
export async function readWithdrawnHealthExportPage(
  uid: string, name: HealthExportCollection, after: string | null,
): Promise<HealthExportPage> {
  if (!uid || uid.includes('/') || uid.length > 128) throw new Error('Invalid uid');
  if (!['root', 'history_months', 'nutrition_months'].includes(name)) throw new Error('Invalid export collection');
  if (after !== null && (!MONTH_RE.test(after) || name === 'root')) throw new Error('Invalid cursor');
  const state = await readHealthConsentState(uid);
  if (state.status !== 'withdrawn') throw new Error('Export endpoint available only during withdrawal');
  const root = adminDb().collection('users').doc(uid);
  if (name === 'root') {
    const snap = await root.get();
    return { documents: snap.exists ? [{ path: '', data: snap.data() ?? {} }] : [], nextCursor: null };
  }
  let query = root.collection(name).orderBy(FieldPath.documentId());
  if (after !== null) query = query.startAfter(after);
  const snapshots = await query.limit(HEALTH_EXPORT_PAGE_SIZE).get();
  const documents = snapshots.docs.map(doc => ({ path: name + '/' + doc.id, data: doc.data() }));
  const last = snapshots.docs.at(-1);
  return { documents, nextCursor: snapshots.docs.length === HEALTH_EXPORT_PAGE_SIZE && last ? last.id : null };
}
