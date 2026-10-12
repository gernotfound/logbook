import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'idb-keyval';
import { idbStore } from './setup';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { createAndMigrateVault } from '../src/lib/sync/secureArchiveMigration';
import { deviceVaultKeyId, LocalUnlockError } from '../src/lib/sync/secureArchiveKeys';
import { readVaultControl, vaultControlKey } from '../src/lib/sync/secureArchiveSession';
import { initializeLocal } from '../src/lib/sync/localRepository';
import { UserDataSchema } from '../src/lib/schema';

const owner = 'user:fixture-isolation';

beforeEach(() => { localStorage.clear(); });

describe('encrypted UI fixture isolation from asynchronous prior test cleanup', () => {
  it('reprovisions an orphan control only when the mocked IndexedDB has no user ciphertext', async () => {
    await createAndMigrateVault(owner);
    const oldEpoch = readVaultControl(owner)?.epoch;
    expect(oldEpoch).toBeTruthy();
    // Mock IndexedDB was reset after a background callback had written
    // localStorage metadata. Real user archives must NOT take this path.
    delete idbStore[deviceVaultKeyId(owner)];
    expect(await get('logbook:v2:' + owner)).toBeUndefined();

    await prepareUnlockedTestArchive(owner);
    expect(readVaultControl(owner)?.epoch).not.toBe(oldEpoch);
    expect(await get(deviceVaultKeyId(owner))).toBeDefined();
  });

  it('never destroys an orphan control if an encrypted user envelope exists', async () => {
    await createAndMigrateVault(owner);
    await initializeLocal(owner, UserDataSchema.parse({}));
    const ciphertext = await get('logbook:v2:' + owner);
    const control = localStorage.getItem(vaultControlKey(owner));
    expect(typeof ciphertext).toBe('string');
    delete idbStore[deviceVaultKeyId(owner)];

    await expect(prepareUnlockedTestArchive(owner)).rejects.toBeInstanceOf(LocalUnlockError);
    expect(localStorage.getItem(vaultControlKey(owner))).toBe(control);
    expect(await get('logbook:v2:' + owner)).toBe(ciphertext);
  });
});
