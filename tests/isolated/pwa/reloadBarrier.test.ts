import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, vi } from 'vitest';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { registerReloadArchiveCases } from './reloadBarrierArchiveCases';
import { registerReloadTabCases } from './reloadBarrierTabCases';
import { registerReloadUpdateCases } from './reloadBarrierUpdateCases';
import { registerReloadConsentCases } from './reloadBarrierConsentCases';
const app = vi.hoisted(() => ({ state: { userData: null as any, localWorkout: null as any, dataOwner: 'user:a' as string | null }, flush: vi.fn(), auth: { currentUser: { uid: 'a' } }, suspendedConsent: null as null | 'erasure-required' }));
vi.mock('../../../src/store/useAppStore', () => ({ useAppStore: {
    getState: () => ({ ...app.state, flushPendingSyncs: app.flush }),
    setState: (patch: any) => { app.state = { ...app.state, ...(typeof patch === 'function' ? patch(app.state) : patch) }; },
} }));
vi.mock('../../../src/lib/firebase', () => ({ auth: app.auth }));
// Reload tests provision the current consent epoch for an authenticated owner.
// Consent epoch and revocation fences also have dedicated suites.
vi.mock('../../../src/lib/healthConsent', async () => {
    const actual = await vi.importActual<typeof import('../../../src/lib/healthConsent')>('../../../src/lib/healthConsent');
    const writable = (owner: string) => owner.startsWith('user:')
        ? owner === 'user:' + app.auth.currentUser?.uid
        : actual.isHealthConsentWritable(owner);
    return {
        ...actual,
        currentHealthConsentStatus: (uid: string) => app.suspendedConsent ?? actual.currentHealthConsentStatus(uid),
        isHealthConsentWritable: writable,
        isHealthConsentCloudWritable: writable,
        requireHealthConsentWritable: (owner: string) => {
            if (!writable(owner)) throw new Error('Utente non autorizzato dal consenso');
        },
        getVerifiedHealthConsentRevision: () => 1,
    };
});
import { isReloadSessionCurrent, prepareForReload, UnverifiedTabSnapshotError } from '../../../src/lib/sync/reloadBarrier';
import { requiredUpdateHardReload, safeHardReload } from '../../../src/lib/sync/safeReload';
import { commitLocal, initializeLocal, readLocal } from '../../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../../src/lib/schema';
import { activateGuestSession, captureSession, GUEST_SESSION_KEY, invalidateSession, isCurrentSession } from '../../../src/lib/sync/session';
import { markTabSnapshotClean, markTabSnapshotDirty, readTabSnapshotState } from '../../../src/lib/sync/tabSnapshotCausality';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import { BrowserStorageError } from '../../../src/lib/sync/browserStorage';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { lockAllVaults, lockVault, requireUnlockedLocalKey, LocalVaultLockedError } from '../../../src/lib/sync/secureArchiveSession';
import { LocalCiphertextError, openLocalJson, sealLocalJson } from '../../../src/lib/sync/secureArchiveCipher';
import type { UserData } from '../../../src/types';
const parse = (height: number) => UserDataSchema.parse({ profile: { height } }) as unknown as UserData;
let disk: Map<string, string>;
let releaseIdentity = () => {};
beforeEach(() => { releaseIdentity = authenticatedIdentitySource.install(() => app.auth.currentUser); });
beforeEach(async () => {
    lockAllVaults();
    await clear(); invalidateSession(); vi.resetAllMocks(); app.auth.currentUser = { uid: 'a' }; app.suspendedConsent = null;
    disk = new Map();
    vi.stubGlobal('localStorage', { get length() { return disk.size; }, key: (index: number) => Array.from(disk.keys())[index] ?? null, getItem: (key: string) => disk.get(key) ?? null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) });
    vi.stubGlobal('navigator', { locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() } });
    // Authenticated hydration requires both the real vault and the current consent epoch.
    disk.set('logbook:v2:user:a:health-consent-generation', '1');
    await createAndMigrateVault('user:a');
    app.state = { userData: parse(170), localWorkout: { id: 'active', exercises: [] }, dataOwner: 'user:a' };
    await initializeLocal('user:a', app.state.userData);
    markTabSnapshotClean(captureSession(), app.state.userData);
});
afterEach(() => { releaseIdentity(); lockAllVaults(); vi.unstubAllGlobals(); });

// Reuse the existing hoisted mocks and IndexedDB setup. beforeEach recreates
// the fake browser storage, so the tests must resolve the current disk lazily.
function createReloadSuiteContext() {
    return {
        app, parse, get disk() { return disk; },
        releaseIdentity: () => releaseIdentity(),
        clear, get, set, prepareForReload, isReloadSessionCurrent,
        UnverifiedTabSnapshotError, safeHardReload, requiredUpdateHardReload,
        commitLocal, initializeLocal, readLocal, UserDataSchema,
        activateGuestSession, captureSession, GUEST_SESSION_KEY, invalidateSession,
        isCurrentSession, markTabSnapshotClean, markTabSnapshotDirty,
        readTabSnapshotState, draftRegistry, BrowserStorageError,
        createAndMigrateVault, deviceKey, protectedDeviceKey,
        readDeviceValueStrict, writeDeviceValue, lockAllVaults, lockVault,
        requireUnlockedLocalKey, LocalVaultLockedError, LocalCiphertextError,
        openLocalJson, sealLocalJson,
    };
}

export type ReloadSuiteContext = ReturnType<typeof createReloadSuiteContext>;

const reloadContext = createReloadSuiteContext();
registerReloadArchiveCases(reloadContext);
registerReloadTabCases(reloadContext);
registerReloadUpdateCases(reloadContext);
registerReloadConsentCases(reloadContext);
