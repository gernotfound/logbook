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
});
