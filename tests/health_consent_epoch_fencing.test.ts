import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../src/lib/sync/secureArchiveSession';
import { UserDataSchema } from '../src/lib/schema';
import { captureSessionForOwner, isCurrentSession } from '../src/lib/sync/session';
import { advanceLocalConsentRevisionIfClean, initializeLocal, commitLocal, readLocal } from '../src/lib/sync/localRepository';
import type { UserData } from '../src/types';

const initialData = () => UserDataSchema.parse({ profile: { height: '175' } }) as unknown as UserData;
const owner = 'user:test-user-id';

beforeEach(() => {
  lockAllVaults();
  localStorage.clear();
  vi.stubGlobal('navigator', { locks: {
    request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
  } });
});
afterEach(() => {
  lockAllVaults();
  vi.unstubAllGlobals();
});

describe('consent generation is a durable local and cross-tab write fence', () => {
  it('invalidates an in-flight session when another tab records withdrawal', () => {
    const old = captureSessionForOwner(owner);
    expect(isCurrentSession(old)).toBe(true);
    localStorage.setItem('logbook:v2:' + owner + ':health-consent-withdrawal', 'pending');
    expect(isCurrentSession(old)).toBe(false);
  });

  it('invalidates an in-flight session on reacceptance epoch change', () => {
    const old = captureSessionForOwner(owner);
    expect(isCurrentSession(old)).toBe(true);
    localStorage.setItem('logbook:v2:' + owner + ':health-consent-generation', '2');
    expect(isCurrentSession(old)).toBe(false);
  });

  it('does not reclassify a previous-generation pending journal or erase progress', async () => {
    await createAndMigrateVault(owner);
    const base = initialData();
    await initializeLocal(owner, base);
    const desired = { ...base, profile: { ...base.profile, height: '180' } };
    await commitLocal(owner, desired, base);
    const pending = await readLocal(owner);
    expect(pending?.pending.length).toBeGreaterThan(0);
    expect(await advanceLocalConsentRevisionIfClean(owner, 2)).toBe(false);
    const preserved = await readLocal(owner);
    expect(preserved?.pending).toEqual(pending?.pending);
    expect(preserved?.data.profile?.height).toBe('180');
    expect(preserved?.consentRevision).toBeUndefined();
  });

  it('aborts consent epoch adoption inside IndexedDB if the session guard fails', async () => {
    await createAndMigrateVault(owner);
    const base = initialData();
    await initializeLocal(owner, base);
    const before = await readLocal(owner);
    await expect(advanceLocalConsentRevisionIfClean(owner, 2, () => false))
      .rejects.toThrow('Sessione cambiata');
    expect(await readLocal(owner)).toEqual(before);
  });

  it('does not restamp an ACKed local archive belonging to an erased consent epoch', async () => {
    const older = 'user:erased-' + crypto.randomUUID();
    await createAndMigrateVault(older);
    await initializeLocal(older, initialData());
    const original = await readLocal(older);
    expect(original?.pending).toEqual([]);

    expect(await advanceLocalConsentRevisionIfClean(older, 4, undefined, 2)).toBe('erased');
    expect(await readLocal(older)).toEqual(original);

    // Later archives outside the erasure floor may safely adopt a new epoch.
    expect(await advanceLocalConsentRevisionIfClean(older, 2)).toBe(true);
    expect(await advanceLocalConsentRevisionIfClean(older, 4, undefined, 1)).toBe(true);
    expect((await readLocal(older))?.consentRevision).toBe(4);
  });

  it('does not create a replacement envelope for a fresh device after erasure', async () => {
    const fresh = 'user:erased-fresh-' + crypto.randomUUID();
    await createAndMigrateVault(fresh);
    expect(await advanceLocalConsentRevisionIfClean(fresh, 4, undefined, 2)).toBe(true);
    expect(await readLocal(fresh)).toBeUndefined();
  });

  it('can adopt the new epoch atomically when no old pending operations exist', async () => {
    await createAndMigrateVault(owner);
    const base = initialData();
    await initializeLocal(owner, base);
    expect(await advanceLocalConsentRevisionIfClean(owner, 2)).toBe(true);
    expect((await readLocal(owner))?.consentRevision).toBe(2);
    expect((await readLocal(owner))?.pending).toEqual([]);
    expect(await advanceLocalConsentRevisionIfClean(owner, 2)).toBe(true);
    await expect(advanceLocalConsentRevisionIfClean(owner, 1)).rejects.toThrow('più recente');
  });
});
