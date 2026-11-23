import { describe, expect, it } from 'vitest';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { makeHealthErasureAdminMock } from './healthErasureJobFixture';

describe('health erasure Firestore Admin fixture query ordering', () => {
  it('uses the requested timestamp field rather than always sorting by purgeAfter', async () => {
    const fixture = {
      records: new Map<string, Record<string, unknown>>([
        ['health_data_erasures/a', { status: 'requested', updatedAt: Timestamp.fromMillis(20), purgeAfter: Timestamp.fromMillis(1) }],
        ['health_data_erasures/b', { status: 'requested', updatedAt: Timestamp.fromMillis(10), purgeAfter: Timestamp.fromMillis(30) }],
        ['health_data_erasures/c', { status: 'requested', updatedAt: Timestamp.fromMillis(30), purgeAfter: Timestamp.fromMillis(15) }],
      ]),
      failQueryOnce: '',
      pauseQuery: null,
      transactionCount: 0,
    };
    const collection = makeHealthErasureAdminMock(fixture).adminDb().collection('health_data_erasures');

    const byUpdate = await collection.where('status', 'in', ['requested']).orderBy('updatedAt', 'asc').get();
    expect(byUpdate.docs.map(doc => doc.id)).toEqual(['b', 'a', 'c']);

    // Without an explicit orderBy, Firestore enumerates by document name.
    const byName = await collection.where('status', 'in', ['requested']).get();
    expect(byName.docs.map(doc => doc.id)).toEqual(['a', 'b', 'c']);

    const byExpiry = collection.where('status', 'in', ['requested'])
      .orderBy('purgeAfter').orderBy(FieldPath.documentId());
    const first = await byExpiry.limit(2).get();
    expect(first.docs.map(doc => doc.id)).toEqual(['a', 'c']);
    const second = await byExpiry.startAfter(first.docs[1]).limit(2).get();
    expect(second.docs.map(doc => doc.id)).toEqual(['b']);
  });

  it('uses Firestore bytewise document IDs as a stable tie-breaker across pages', async () => {
    const expired = Timestamp.fromMillis(1_700_000_000_000);
    const records = new Map<string, Record<string, unknown>>([
      ['health_data_erasures/a', { status: 'complete', purgeAfter: expired }],
      ['health_data_erasures/missing', { status: 'complete' }],
      ['health_data_erasures/B', { status: 'complete', purgeAfter: expired }],
      ['health_data_erasures/A', { status: 'complete', purgeAfter: expired }],
    ]);
    const collection = makeHealthErasureAdminMock({
      records, failQueryOnce: '', pauseQuery: null, transactionCount: 0,
    }).adminDb().collection('health_data_erasures');

    // Locale collation places lowercase 'a' before uppercase 'B', unlike Firestore.
    expect((await collection.get()).docs.map(doc => doc.id))
      .toEqual(['A', 'B', 'a', 'missing']);
    const ordered = collection.where('status', '==', 'complete')
      .orderBy('purgeAfter').orderBy(FieldPath.documentId());
    const first = await ordered.limit(2).get();
    expect(first.docs.map(doc => doc.id)).toEqual(['A', 'B']);

    const second = await ordered.startAfter(first.docs[1]).limit(2).get();
    expect(second.docs.map(doc => doc.id)).toEqual(['a']);
    expect((await ordered.startAfter(second.docs[0]).limit(2).get()).docs)
      .toHaveLength(0);
  });
});
