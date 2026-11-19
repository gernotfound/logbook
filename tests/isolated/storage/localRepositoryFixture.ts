import { clear } from 'idb-keyval';
import { afterEach, beforeEach, vi } from 'vitest';
import { UserDataSchema } from '../../../src/lib/schema';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../../src/lib/sync/session';
import type { UserData } from '../../../src/types';

export const data = (height: number) => UserDataSchema.parse({ profile: { height: String(height) } }) as unknown as UserData;
// Current-release journal fixtures use the real owner vault; the adversarial
// corrupt/legacy envelopes and guest lifecycle cases remain explicit.
export const prepareOwnerVault = (owner = 'user:a') => createAndMigrateVault(owner);
export const prepareGuestVault = async () => {
    const guestSessionId = 'current-guest-fixture';
    localStorage.setItem('logbook_is_guest', 'true');
    localStorage.setItem(GUEST_SESSION_KEY, guestSessionId);
    activateGuestSession(guestSessionId);
    await prepareOwnerVault('guest');
};

export function installLocalRepositoryFixture() {
    beforeEach(async () => {
        await clear();
        lockAllVaults();
        localStorage.clear();
        vi.stubGlobal('navigator', { locks: {
            request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
        } });
    });
    afterEach(() => {
        lockAllVaults();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
}
