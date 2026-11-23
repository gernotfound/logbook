import { describe, expect, it } from 'vitest';
import { doc, getDoc, getDocFromServer, getFirestore, runTransaction } from 'firebase/firestore';
import { firestoreMockStore } from '../setup';

describe('shared Firestore UI fixture snapshot isolation', () => {
  it.each([
    { name: 'cached read', read: getDoc },
    { name: 'server read', read: getDocFromServer },
  ])('keeps a $name immutable after data() mutations and later writes', async ({ read }) => {
    const ref = doc(getFirestore(), 'users', 'fixture-snapshot');
    const initial = { profile: { height: '170' } };
    firestoreMockStore[ref.path] = structuredClone(initial);

    const captured = await read(ref);
    expect(captured.exists()).toBe(true);
    captured.data()!.profile.height = '999';

    expect(firestoreMockStore[ref.path]).toEqual(initial);
    expect(captured.data()).toEqual(initial);

    firestoreMockStore[ref.path].profile.height = '180';
    expect(captured.data()).toEqual(initial);
    expect((await read(ref)).data()).toEqual({ profile: { height: '180' } });
  });

  it('does not persist an in-place mutation from a transaction read without set()', async () => {
    const ref = doc(getFirestore(), 'users', 'fixture-tx');
    const initial = { profile: { height: '170' } };
    firestoreMockStore[ref.path] = structuredClone(initial);

    await runTransaction(getFirestore(), async transaction => {
      const current = await transaction.get(ref);
      current.data()!.profile.height = '999';
      expect(current.data()).toEqual(initial);
      return { conflicts: [] };
    });

    expect(firestoreMockStore[ref.path]).toEqual(initial);
    expect((await getDoc(ref)).data()).toEqual(initial);
  });
});
