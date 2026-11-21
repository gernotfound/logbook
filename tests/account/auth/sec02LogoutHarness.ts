import { vi } from 'vitest';
vi.unmock('../../../src/lib/db');
import { TestDB as DB } from '../../testUtils';
import * as idb from 'idb-keyval';
import { useAppStore } from '../../../src/store/useAppStore';
import { storageOwner } from '../../../src/lib/sync/session';
import { isLocalPurgeIncomplete, isLocalPurgePending } from '../../../src/lib/sync/localPurgeFence';
import * as localRepository from '../../../src/lib/sync/localRepository';
import { idbStore, localStorageMock, mockFirebaseAuth } from '../../setup';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../../src/lib/schema';
import { markAccountDeletion, isAccountDeletionPending } from '../../../src/lib/sync/accountGate';
import { beginGuestMigrationIntent } from '../../../src/lib/auth/guestMigrationIntent';

// Mock firebase auth
vi.mock('../../../src/lib/firebase', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/firebase')>('../../../src/lib/firebase');
    return {
        ...actual,
        // Share the exact Auth instance already used by session.ts. An
        // independently fabricated Auth would bypass the production UID fence.
        auth: Object.assign(actual.auth, { signOut: vi.fn() }),
        ensureAppCheck: vi.fn(),
        getDb: vi.fn()
    };
});

// vi.clearAllMocks does not restore mockImplementation. Reset functions changed by
// concurrency tests so their instrumentation cannot leak across test cases.
const originalStorageKey = localStorageMock.key.getMockImplementation()!;
const originalStorageRemove = localStorageMock.removeItem.getMockImplementation()!;
// The common fixture models real owner-scoped IndexedDB keys, including atomic update.
const originalIdbGet = vi.mocked(idb.get).getMockImplementation()!;
const originalIdbDel = vi.mocked(idb.del).getMockImplementation()!;


export {
  DB, idb, useAppStore, storageOwner, isLocalPurgeIncomplete,
  isLocalPurgePending, localRepository, idbStore, localStorageMock,
  mockFirebaseAuth, initializeLocal, UserDataSchema, markAccountDeletion,
  isAccountDeletionPending, beginGuestMigrationIntent,
  originalIdbGet, originalIdbDel,
};

export async function resetLogoutFixture(): Promise<void> {
    vi.clearAllMocks();
    localStorageMock.key.mockImplementation(originalStorageKey);
    localStorageMock.removeItem.mockImplementation(originalStorageRemove);
    localStorage.removeItem = localStorageMock.removeItem;
    vi.mocked(idb.get).mockImplementation(originalIdbGet);
    vi.mocked(idb.del).mockImplementation(originalIdbDel);
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, _options: unknown, action: () => Promise<unknown>) => action() } });
    localStorage.clear();
    await prepareUnlockedTestArchive('user:test-user-id');
    vi.clearAllMocks();
});
}

export function restoreLogoutFixture(): void {
    localStorageMock.key.mockImplementation(originalStorageKey);
    localStorageMock.removeItem.mockImplementation(originalStorageRemove);
    localStorage.removeItem = localStorageMock.removeItem;
});
}
