import { afterEach, beforeEach, vi } from 'vitest';
import { emptyUserData } from '../../setup';
import type { UserData } from '../../../src/types';

const authState = vi.hoisted(() => ({
    currentUser: { uid: 'user-a' } as { uid: string } | null,
}));

const dbState = vi.hoisted(() => ({
    loadCloudPayload: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
    current: { userData: { profile: { height: '170' } } as UserData | null, localWorkout: null as any, localPersistenceBlocked: false },
}));

vi.mock('../../../src/lib/firebase', () => ({
    auth: authState,
    getDb: vi.fn(() => ({})),
}));

vi.mock('../../../src/lib/db', () => ({
    DB: {
        loadCloudPayload: dbState.loadCloudPayload,
    },
}));

vi.mock('../../../src/lib/sync/replicaProtocol', async importOriginal => {
    const actual = await importOriginal<typeof import('../../../src/lib/sync/replicaProtocol')>();
    return { ...actual, needsReplicaCheckpoint: vi.fn(() => false) };
});

vi.mock('../../../src/store/useAppStore', () => ({
    useAppStore: {
        getState: () => storeState.current,
        setState: (patch: any) => {
            storeState.current = {
                ...storeState.current,
                ...(typeof patch === 'function' ? patch(storeState.current) : patch),
            };
        },
    },
}));

// Vitest hoists these mock declarations; expose their instances via a non-hoisted facade.
export const mockControls = { authState, dbState, storeState };

export function data(height: string): UserData {
    return {
        ...structuredClone(emptyUserData),
        profile: { ...emptyUserData.profile, height },
    };
}

export function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(res => { resolve = res; });
    return { promise, resolve };
}

export function payload(height: string) {
    return {
        data: data(height),
        completeMonths: [],
        cloudDocuments: new Map(),
    };
}

export async function loadModules() {
    vi.resetModules();
    // Importing the mocked Firebase module cannot register a real identity
    // provider. Bind this synthetic realm before authenticated hydration and
    // storage modules capture their first owner-specific session.
    const { authenticatedIdentitySource } =
        await import('../../../src/lib/sync/authenticatedIdentitySource');
    authenticatedIdentitySource.install(() => authState.currentUser);
    const [{ loadAuthenticatedData }, { readLocal, initializeLocal, commitDomainOperations }, { invalidateSession }, { createAndMigrateVault }] = await Promise.all([
        import('../../../src/contexts/auth/loadAuthenticatedData'),
        import('../../../src/lib/sync/localRepository'),
        import('../../../src/lib/sync/session'),
        import('../../../src/lib/sync/secureArchiveMigration'),
    ]);
    // Each resetModules() starts a new authenticated realm. Seed only its
    // current owner's real AEAD vault; an empty envelope is still allowed.
    await createAndMigrateVault('user:user-a');
    return { loadAuthenticatedData, readLocal, initializeLocal, commitDomainOperations, invalidateSession };
}

export function installAuthenticatedHydrationFixture() {
    beforeEach(() => {
        localStorage.clear();
        authState.currentUser = { uid: 'user-a' };
        storeState.current = {
            userData: { profile: { height: '170' } } as UserData,
            localWorkout: null,
            localPersistenceBlocked: false,
        };
        dbState.loadCloudPayload.mockReset();
    });
    afterEach(async () => {
        const { lockAllVaults } = await import('../../../src/lib/sync/secureArchiveSession');
        lockAllVaults();
    });

}
