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
const identity = vi.hoisted(() => ({ owner: 'user:a', epoch: 1 }));

vi.mock('../src/lib/healthConsent', () => consent);
vi.mock('../src/lib/sync/localRepository', () => journal);
vi.mock('../src/lib/db/backupSnapshot', () => snapshot);
vi.mock('../src/lib/catalog/catalogService', () => ({
  getCachedCatalog: vi.fn(async () => ({ exercises: [], foods: [] })),
}));
vi.mock('../src/lib/sync/session', () => ({
  captureSession: () => ({ ...identity }),
  isCurrentSession: (captured: { owner: string; epoch: number }) =>
    captured.owner === identity.owner && captured.epoch === identity.epoch,
}));
import { recoverOldLocalEditsAfterConsent } from '../src/lib/healthConsentRecovery';

describe('consent recovery after deliberate data erasure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity.owner = 'user:a';
    identity.epoch = 1;
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

  it('rejects a new erasure floor recorded during the full cloud scan before rebasing', async () => {
    consent.readActiveHealthConsentRevision
      .mockResolvedValueOnce({ revision: 5 })
      .mockResolvedValueOnce({ revision: 7, erasedBeforeRevision: 5 });
    snapshot.collectBackupSnapshot.mockResolvedValue({
      coverage: { scope: 'cloud-and-device' },
      recovery: { cloudDocuments: {} },
      data: {},
    });

    await expect(recoverOldLocalEditsAfterConsent({ uid: 'a' } as User))
      .rejects.toThrow('eliminati su richiesta');
    expect(consent.readActiveHealthConsentRevision).toHaveBeenCalledTimes(2);
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).not.toHaveBeenCalled();
    expect(consent.finishHealthConsentReacceptance).not.toHaveBeenCalled();
  });

  it('rejects a newer remote consent epoch even without a new erasure floor', async () => {
    consent.readActiveHealthConsentRevision
      .mockResolvedValueOnce({ revision: 5 })
      .mockResolvedValueOnce({ revision: 7 });
    snapshot.collectBackupSnapshot.mockResolvedValue({
      coverage: { scope: 'cloud-and-device' },
      recovery: { cloudDocuments: {} },
      data: {},
    });

    await expect(recoverOldLocalEditsAfterConsent({ uid: 'a' } as User))
      .rejects.toThrow('consenso sul server è cambiato');
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).not.toHaveBeenCalled();
    expect(consent.finishHealthConsentReacceptance).not.toHaveBeenCalled();
  });

  it('rebases only when the complete scan and the second trusted consent check agree', async () => {
    consent.readActiveHealthConsentRevision.mockResolvedValue({ revision: 5 });
    snapshot.collectBackupSnapshot.mockResolvedValue({
      coverage: { scope: 'cloud-and-device' },
      recovery: { cloudDocuments: {} },
      data: {},
    });
    consent.refreshHealthConsent.mockResolvedValue('active');

    await recoverOldLocalEditsAfterConsent({ uid: 'a' } as User);
    expect(consent.readActiveHealthConsentRevision).toHaveBeenCalledTimes(2);
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).toHaveBeenCalledOnce();
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).toHaveBeenCalledWith(
      'user:a', 5, 17, expect.anything(), expect.anything(), expect.any(Map), expect.any(Function),
    );
    expect(consent.finishHealthConsentReacceptance).toHaveBeenCalledOnce();
  });

  it('does not publish reactivation for account A if ownership changes during the final refresh', async () => {
    consent.readActiveHealthConsentRevision.mockResolvedValue({ revision: 5 });
    snapshot.collectBackupSnapshot.mockResolvedValue({
      coverage: { scope: 'cloud-and-device' },
      recovery: { cloudDocuments: {} },
      data: {},
    });
    consent.refreshHealthConsent.mockImplementationOnce(async () => {
      identity.owner = 'user:b';
      identity.epoch = 2;
      return 'active';
    });

    await expect(recoverOldLocalEditsAfterConsent({ uid: 'a' } as User))
      .rejects.toThrow('sessione è cambiata');
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).toHaveBeenCalledOnce();
    expect(consent.finishHealthConsentReacceptance).not.toHaveBeenCalled();
  });

  it('preserves the old journal when a second trusted consent check fails', async () => {
    consent.readActiveHealthConsentRevision
      .mockResolvedValueOnce({ revision: 5 })
      .mockRejectedValueOnce(new Error('verifica server indisponibile'));
    snapshot.collectBackupSnapshot.mockResolvedValue({
      coverage: { scope: 'cloud-and-device' },
      recovery: { cloudDocuments: {} },
      data: {},
    });
    await expect(recoverOldLocalEditsAfterConsent({ uid: 'a' } as User))
      .rejects.toThrow('verifica server indisponibile');
    expect(journal.rebaseConsentRecoveryWithExplicitChoice).not.toHaveBeenCalled();
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
