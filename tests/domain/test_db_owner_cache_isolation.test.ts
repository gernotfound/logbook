import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/sync/localRepository', async importOriginal => ({
  ...(await importOriginal<typeof import('../../src/lib/sync/localRepository')>()),
  // An absent durable envelope forces the transport fixture's fallback path.
  readLocal: vi.fn(async () => undefined),
  commitLocal: vi.fn(async () => []),
  adoptReplicaCheckpoint: vi.fn(async () => undefined),
}));

import { commitLocal } from '../../src/lib/sync/localRepository';
import { mockFirebaseAuth } from '../setup';
import { TestDB } from '../testUtils';

describe('test DB fallback state ownership', () => {
  it('uses a separate previous snapshot for each authenticated owner', async () => {
    const originalUser = mockFirebaseAuth.currentUser;
    if (!originalUser) throw new Error('Expected synthetic authenticated test owner');

    const first = { profile: { height: '171' } };
    const second = { profile: { height: '182' } };

    TestDB.resetCache();
    vi.mocked(commitLocal).mockClear();

    try {
      mockFirebaseAuth.currentUser = { ...originalUser, uid: 'fixture-first-owner' };
      await TestDB.saveUserData(first);

      mockFirebaseAuth.currentUser = { ...originalUser, uid: 'fixture-second-owner' };
      await TestDB.saveUserData(second);

      mockFirebaseAuth.currentUser = { ...originalUser, uid: 'fixture-first-owner' };
      await TestDB.saveUserData({ profile: { height: '173' } });

      expect(vi.mocked(commitLocal).mock.calls.map(([owner, , base]) => [owner, base])).toEqual([
        ['user:fixture-first-owner', {}],
        ['user:fixture-second-owner', {}],
        ['user:fixture-first-owner', first],
      ]);
    } finally {
      mockFirebaseAuth.currentUser = originalUser;
      TestDB.resetCache();
    }
  });
});
