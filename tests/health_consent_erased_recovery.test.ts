import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from 'firebase/auth';

const consent = vi.hoisted(() => ({
  currentHealthConsentStatus: vi.fn(() => 'recovery-required'),
  readActiveHealthConsentRevision: vi.fn(),
  refreshHealthConsent: vi.fn(),
  finishHealthConsentReacceptance: vi.fn(),
}));
const journal = vi.hoisted(() => ({
  readLocal: vi.fn(),
  rebaseConsentRecoveryWithExplicitChoice: vi.fn(),
}));
const snapshot = vi.hoisted(() => ({ collectBackupSnapshot: vi.fn() }));

vi.mock('../src/lib/healthConsent', () => consent);
vi.mock('../src/lib/sync/localRepository', () => journal);
vi.mock('../src/lib/db/backupSnapshot', () => snapshot);
vi.mock('../src/lib/sync/session', () => ({
  captureSession: () => ({ owner: 'user:a', epoch: 1 }),
  isCurrentSession: () => true,
}));
import { recoverOldLocalEditsAfterConsent } from '../src/lib/healthConsentRecovery';

describe('consent recovery after deliberate data erasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consent.currentHealthConsentStatus.mockReturnValue('recovery-required');
    journal.readLocal.mockResolvedValue({
      consentRevision: 3, revision: 17,
      pending: [{ seq: 1 }], data: { history: [] },
    });
    consent.readActiveHealthConsentRevision.mockResolvedValue({
      revision: 5, erasedBeforeRevision: 3,
    });
  });

  it('refuses a rebased journal from an erased epoch without touching its encrypted original', async () => {
    await expect(recoverOldLocalEditsAfterConsent({ uid: 'a' } as User))
      .rejects.toThrow('eliminati su richiesta');
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).not.toHaveBeenCalled();
    expect(snapshot.collectBackupSnapshot).not.toHaveBeenCalled();
    expect(consent.finishHealthConsentReacceptance).not.toHaveBeenCalled();
  });

  it('fails closed on unversioned legacy pending journals after confirmed erasure', async () => {
    journal.readLocal.mockResolvedValueOnce({
      revision: 9, pending: [{ seq: 2 }], data: {},
    });
    await expect(recoverOldLocalEditsAfterConsent({ uid: 'a' } as User))
      .rejects.toThrow('eliminati su richiesta');
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).not.toHaveBeenCalled();
  });
});
