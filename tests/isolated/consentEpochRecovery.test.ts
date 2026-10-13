import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/catalog/catalogService', () => ({
  getCachedCatalog: async () => ({ exercises: [], foods: [] }),
}));

import { UserDataSchema } from '../../src/lib/schema';
import type { UserData } from '../../src/types';
import {
  commitLocal, initializeLocal, readLocal,
  rebaseConsentRecoveryWithExplicitChoice,
} from '../../src/lib/sync/localRepository';
import { purgeAllLocalUserData } from '../../src/lib/db/db_account';

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
  await clear();
  localStorage.clear();
  await initializeLocal(owner, state('170'));
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
    )).rejects.toThrow('I dati locali sono cambiati');
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
