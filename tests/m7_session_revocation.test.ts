import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  seconds: null as number | string | null,
  deletionJobExists: false,
  revoke: vi.fn(),
  getUser: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminAuth: () => ({ revokeRefreshTokens: state.revoke, getUser: state.getUser }),
  adminDb: () => ({
    collection: (name: string) => ({
      doc: (uid: string) => ({ path: name + '/' + uid }),
    }),
    runTransaction: state.transaction,
  }),
}));

import { revokeAllUserSessions } from '../server/accountDeletion/sessionRevocation';

describe('trusted all-device Firebase session revocation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.seconds = null;
    state.deletionJobExists = false;
    state.revoke.mockResolvedValue(undefined);
    state.getUser.mockResolvedValue({ tokensValidAfterTime: '1970-01-01T00:02:01.000Z' });
    state.transaction.mockImplementation(async (callback: (transaction: any) => Promise<number>) => {
      let staged: number | undefined;
      const result = await callback({
        get: async (ref: { path: string }) => ref.path.startsWith('account_deletions/')
          ? { exists: state.deletionJobExists, data: () => ({}) }
          : { exists: state.seconds !== null, data: () => ({ revokedAfterSeconds: state.seconds }) },
        set: (_ref: unknown, data: { revokedAfterSeconds: number }) => {
          staged = data.revokedAfterSeconds;
        },
      });
      if (staged !== undefined) state.seconds = staged;
      return result;
    });
  });

  it('persists the Firestore barrier before revoking tokens and advances to the Firebase time', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(120_000);
    const observed: number[] = [];
    state.revoke.mockImplementation(async () => {
      observed.push(state.seconds as number);
    });
    try {
      await revokeAllUserSessions('owner');
      expect(observed).toEqual([120]);
      expect(state.revoke).toHaveBeenCalledWith('owner');
      expect(state.getUser).toHaveBeenCalledWith('owner');
      expect(state.seconds).toBe(121);
    } finally {
      now.mockRestore();
    }
  });

  it('rejects a concurrent account deletion before touching Auth or creating an orphan', async () => {
    state.deletionJobExists = true;
    await expect(revokeAllUserSessions('owner')).rejects.toThrow('Account deletion in progress.');
    expect(state.seconds).toBeNull();
    expect(state.revoke).not.toHaveBeenCalled();
  });

  it('does not erase an existing stronger barrier on retry', async () => {
    state.seconds = 5_000;
    await revokeAllUserSessions('owner');
    expect(state.seconds).toBe(5_000);
  });

  it('preserves the barrier when Firebase revocation fails', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(120_000);
    try {
      state.revoke.mockRejectedValueOnce(new Error('Firebase temporarily unavailable'));
      await expect(revokeAllUserSessions('owner')).rejects.toThrow('Firebase temporarily unavailable');
      expect(state.seconds).toBe(120);
      expect(state.getUser).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('never revokes tokens if the Firestore barrier cannot be committed', async () => {
    state.transaction.mockRejectedValueOnce(new Error('Firestore unavailable'));
    await expect(revokeAllUserSessions('owner')).rejects.toThrow('Firestore unavailable');
    expect(state.revoke).not.toHaveBeenCalled();
  });

  it('fails closed for corrupted stored barriers', async () => {
    state.seconds = 'invalid';
    await expect(revokeAllUserSessions('owner')).rejects.toThrow('Invalid existing session revocation barrier.');
    expect(state.revoke).not.toHaveBeenCalled();
  });

  it('keeps the first fence after Firebase revokes but the read-back fails', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(120_000);
    try {
      state.getUser.mockRejectedValueOnce(new Error('Read back unavailable'));
      await expect(revokeAllUserSessions('owner')).rejects.toThrow('Read back unavailable');
      expect(state.seconds).toBe(120);
      expect(state.revoke).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });
});
