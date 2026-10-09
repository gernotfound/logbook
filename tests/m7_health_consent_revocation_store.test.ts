import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  documents: new Map<string, unknown>(),
  creations: [] as string[],
}));

vi.mock('../server/accountDeletion/firebaseAdmin', () => ({
  adminDb: () => ({
    collection(name: string) {
      return {
        doc(id: string) {
          return { path: name + '/' + id };
        },
      };
    },
    async runTransaction<T>(work: (transaction: {
      get: (ref: { path: string }) => Promise<{ exists: boolean }>;
      create: (ref: { path: string }, value: unknown) => void;
    }) => Promise<T>): Promise<T> {
      const queued: Array<{ path: string; value: unknown }> = [];
      const result = await work({
        get: async ref => ({ exists: state.documents.has(ref.path) }),
        create: (ref, value) => queued.push({ path: ref.path, value }),
      });
      for (const item of queued) {
        if (state.documents.has(item.path)) throw new Error('Document already exists');
        state.documents.set(item.path, item.value);
        state.creations.push(item.path);
      }
      return result;
    },
  }),
}));

import {
  recordHealthConsentRevocation,
  RevocationAccountDeletingError,
} from '../server/healthConsent/revocation';

describe('health consent revocation server state', () => {
  beforeEach(() => {
    state.documents.clear();
    state.creations.length = 0;
  });

  it('creates one immutable per-owner marker, and retry does not reset the timestamp', async () => {
    await recordHealthConsentRevocation('owner-a');
    const original = state.documents.get('health_consent_revocations/owner-a');
    expect(original).toMatchObject({ schemaVersion: 1, revokedAt: expect.anything() });

    await recordHealthConsentRevocation('owner-a');
    expect(state.documents.get('health_consent_revocations/owner-a')).toBe(original);
    expect(state.creations).toEqual(['health_consent_revocations/owner-a']);
    expect(state.documents.has('health_consent_revocations/owner-b')).toBe(false);
  });

  it('cannot create a marker after account deletion has begun', async () => {
    state.documents.set('account_deletions/owner-a', { status: 'requested' });
    await expect(recordHealthConsentRevocation('owner-a')).rejects.toBeInstanceOf(RevocationAccountDeletingError);
    expect(state.documents.has('health_consent_revocations/owner-a')).toBe(false);
  });

  it.each(['', 'one/two'])('rejects invalid account identities', async uid => {
    await expect(recordHealthConsentRevocation(uid)).rejects.toThrow('Invalid authenticated UID');
    expect(state.creations).toHaveLength(0);
  });
});
