import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/catalog/catalogService', () => ({
  getCachedCatalog: async () => ({ exercises: [], foods: [] }),
}));

import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import {
  commitLocal, initializeLocal, readLocal,
  rebaseConsentRecoveryWithExplicitChoice, StaleLocalRevisionError,
} from '../../src/lib/sync/localRepository';
import { purgeAllLocalUserData } from '../../src/lib/db/db_account';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import { updateArchiveRecord } from '../../src/lib/sync/secureArchiveRepository';
import type { LocalEnvelope } from '../../src/lib/sync/localEnvelopeValidation';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../src/lib/sync/session';

const owner = 'user:consent-recovery-user';
function state(height: string, acceptedAt?: string): UserData {
  return UserDataSchema.parse({
    profile: { height },
    ...(acceptedAt ? { legalConsent: {
      hasAcceptedHealthData: true, hasAcceptedTerms: true, acceptedAt,
      privacyVersion: '1.3.4', termsVersion: '1.2.1',
    } } : {}),
  }) as unknown as UserData;
}
beforeEach(async () => {
  lockAllVaults();
  localStorage.clear();
  await clear();
  vi.stubGlobal('navigator', { locks: {
    request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
  } });
  await createAndMigrateVault(owner);
  await initializeLocal(owner, state('170'));
});
afterEach(() => {
  lockAllVaults();
  vi.unstubAllGlobals();
});

describe('explicit consent-epoch journal recovery', () => {
  it('preserves unsynced local edits after confirmed withdrawal until explicit deletion', async () => {
    await commitLocal(owner, state('180'), state('170'));
    const original = (await readLocal(owner))!;
    localStorage.setItem(`logbook:v2:${owner}:health-consent-withdrawal`, 'withdrawn');
    await expect(purgeAllLocalUserData(owner)).rejects.toThrow('non è ancora riconciliata');
    expect(await readLocal(owner)).toEqual(original);
  });

  it('refuses ordinary local purge when old pending edits require consent recovery', async () => {
    await commitLocal(owner, state('180'), state('170'));
    const original = (await readLocal(owner))!;
    localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '2');
    await expect(purgeAllLocalUserData(owner)).rejects.toThrow('non è ancora riconciliata');
    expect(await readLocal(owner)).toEqual(original);
  });

  it('rebases only after explicit action, retaining complete original journal and legal consent from cloud', async () => {
    await commitLocal(owner, state('180'), state('170'));
    const original = (await readLocal(owner))!;
    expect(original.pending.length).toBeGreaterThan(0);
    const currentCloud = state('175', '2026-10-12T05:00:00.000Z');
    const chosen = state('180', '2026-10-01T05:00:00.000Z');
    await rebaseConsentRecoveryWithExplicitChoice(
      owner, 2, original.revision, currentCloud, chosen, new Map(), () => true,
    );
    const result = (await readLocal(owner))!;
    expect(result.consentRevision).toBe(2);
    expect(result.replica).toBeNull();
    expect(result.baseline.profile?.height).toBe('175');
    expect(result.data.profile?.height).toBe('180');
    expect(result.data.legalConsent).toEqual(currentCloud.legalConsent);
    expect(result.pending.length).toBeGreaterThan(0);
    expect(result.pending.every(op => op.actorId === result.actorId)).toBe(true);
    expect(result.actorId).not.toBe(original.actorId);
    expect(result.archivedConsentJournals).toHaveLength(1);
    expect(result.archivedConsentJournals?.[0].pending).toEqual(original.pending);
    expect(result.archivedConsentJournals?.[0].data).toEqual(original.data);
    expect(result.archivedConsentJournals?.[0].baseline).toEqual(original.baseline);
  });

  it('rejects cross-owner guest recovery while preserving the guest journal', async () => {
    const guestSessionId = 'consent-recovery-guest-session';
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, guestSessionId);
    activateGuestSession(guestSessionId);
    await createAndMigrateVault('guest');
    await initializeLocal('guest', state('170'));
    await commitLocal('guest', state('180'), state('170'));
    const before = await readLocal('guest');

    await expect(rebaseConsentRecoveryWithExplicitChoice(
      'guest', 2, before!.revision, state('175'), state('180'), new Map(), () => true,
    )).rejects.toThrow('Nuovo consenso non valido');
    expect(await readLocal('guest')).toEqual(before);
  });

  it('does not overwrite an archive with 32 preserved consent journals', async () => {
    await commitLocal(owner, state('180'), state('170'));
    const current = (await readLocal(owner))!;
    const original = {
      sourceConsentRevision: current.consentRevision ?? 0,
      capturedAt: '2026-10-27T00:00:00.000Z',
      data: structuredClone(current.data),
      baseline: structuredClone(current.baseline),
      pending: structuredClone(current.pending),
    };
    const key = `logbook:v2:${owner}`;
    await updateArchiveRecord<LocalEnvelope>(owner, () => ({
      ...current, archivedConsentJournals: Array.from({ length: 32 }, () => structuredClone(original)),
    }));
    const encrypted = await get(key);
    expect(encrypted).toMatch(/^tlb-sealed:v1:/);
    const fullArchive = await readLocal(owner);
    expect(fullArchive?.archivedConsentJournals).toHaveLength(32);

    await expect(rebaseConsentRecoveryWithExplicitChoice(
      owner, 2, fullArchive!.revision, state('175'), state('180'), new Map(), () => true,
    )).rejects.toThrow('Archivio recupero pieno');
    expect(await get(key)).toEqual(encrypted);
    expect(await readLocal(owner)).toEqual(fullArchive);
  });

  it('does not touch durable data on a concurrent session invalidation', async () => {
    await commitLocal(owner, state('180'), state('170'));
    const original = (await readLocal(owner))!;
    await expect(rebaseConsentRecoveryWithExplicitChoice(
      owner, 2, original.revision, state('175'), state('180'), new Map(), () => false,
    )).rejects.toThrow('Sessione cambiata');
    expect(await readLocal(owner)).toEqual(original);
  });

  it('refuses a stale local revision and preserves newly added operations', async () => {
    await commitLocal(owner, state('180'), state('170'));
    const original = (await readLocal(owner))!;
    await commitLocal(owner, state('185'), state('180'));
    const concurrent = (await readLocal(owner))!;
    await expect(rebaseConsentRecoveryWithExplicitChoice(
      owner, 2, original.revision, state('175'), state('180'), new Map(), () => true,
    )).rejects.toBeInstanceOf(StaleLocalRevisionError);
    expect(await readLocal(owner)).toEqual(concurrent);
  });

  it('cannot silently reauthorize a journal already stamped for the new epoch', async () => {
    await commitLocal(owner, state('180'), state('170'));
    const original = (await readLocal(owner))!;
    await rebaseConsentRecoveryWithExplicitChoice(owner, 2, original.revision, state('175'), state('180'), new Map(), () => true);
    const ready = (await readLocal(owner))!;
    await expect(rebaseConsentRecoveryWithExplicitChoice(
      owner, 2, ready.revision, state('175'), state('180'), new Map(), () => true,
    )).rejects.toThrow('precedente generazione');
    expect(await readLocal(owner)).toEqual(ready);
  });
});
