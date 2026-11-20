import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, vi } from 'vitest';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } }, root: vi.fn(), control: vi.fn(), page: vi.fn() }));
vi.mock('../../../src/lib/firebase', () => ({ auth: sdk.auth, getDb: () => ({}), ensureAppCheck: async () => {} }));
vi.mock('../../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => ({ exercises: [], foods: [] }) }));
// Cloud backups require a verified active session and the online account key.
// Supply those trusted boundaries explicitly; device recovery and AEAD parsing remain real.
vi.mock('../../../src/lib/healthConsent', async () => ({
    ...await vi.importActual<typeof import('../../../src/lib/healthConsent')>('../../../src/lib/healthConsent'),
    currentHealthConsentStatus: () => 'active',
    requireHealthConsentWritable: () => undefined,
    getVerifiedHealthConsentRevision: () => 0,
}));
const issuedCloudKeys = vi.hoisted(() => [] as Uint8Array[]);
vi.mock('../../../src/lib/sync/cloudAccountKeyAccess', () => ({
    requireCloudAccountDataKey: async () => {
        const key = new Uint8Array(32).fill(18);
        issuedCloudKeys.push(key);
        return key;
    },
    requireRightsExportAccountDataKey: async () => {
        const key = new Uint8Array(32).fill(18);
        issuedCloudKeys.push(key);
        return key;
    },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...path: string[]) => path.join('/'), collection: (_db: unknown, ...path: string[]) => path.join('/'),
    documentId: () => 'id', orderBy: () => ({}), limit: (count: number) => ({ count }), startAfter: (item: { id: string }) => ({ after: item.id }),
    query: (path: string, ...parts: object[]) => Object.assign({ path }, ...parts),
    getDocFromServer: (path: string) => path.endsWith('/sync_control/state') ? sdk.control(path) : sdk.root(path),
    getDocsFromServer: sdk.page,
}));
import { initializeLocal } from '../../../src/lib/sync/localRepository';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { UserDataSchema } from '../../../src/lib/schema';
import { CURRENT_SYNC_PROTOCOL } from '../../../src/lib/schemaEvolution';
import { invalidateSession } from '../../../src/lib/sync/session';
import type { UserData } from '../../../src/types';
import { sealCloudDocument } from '../../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../../src/lib/sync/semanticProjection/contracts';
export const backupSnapshotMocks = { sdk, issuedCloudKeys };

export const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
export const emptySync = { protocolVersion: CURRENT_SYNC_PROTOCOL, clock: {}, fields: {}, writer: { slot: 's00', replicaId: 'backup-seed', generation: 1, seq: 0 } };
export const testKey = new Uint8Array(32).fill(18);
export const currentCloudDoc = (business: Record<string, unknown>, sync: SyncMeta = emptySync, path = '') =>
    sealCloudDocument(testKey, 'a', path, business, sync);

export const initializeSealedLocal = async (data: UserData) => {
    await createAndMigrateVault('user:a');
    await initializeLocal('user:a', data);
};

// Carry the real vault control and sealed records into a controllable storage
// snapshot; race injections must not accidentally simulate a missing DEK.
export function copyDeviceStorage(): Map<string, string> {
    const values = new Map<string, string>();
    for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key === null) throw new Error('Incomplete device fixture inventory');
        const value = localStorage.getItem(key);
        if (value === null) throw new Error('Missing device fixture value');
        values.set(key, value);
    }
    return values;
}

export function stubConcurrentStorage(values: Map<string, string>, overrides: Partial<Pick<Storage, 'key' | 'getItem'>> = {}): void {
    vi.stubGlobal('localStorage', {
        get length() { return values.size; },
        key: (index: number) => [...values.keys()][index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, String(value)); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => { values.clear(); },
        ...overrides,
    });
}

beforeEach(() => authenticatedIdentitySource.install(() => sdk.auth.currentUser));
beforeEach(async () => {
    lockAllVaults();
    issuedCloudKeys.length = 0;
    await clear(); vi.resetAllMocks(); invalidateSession(); sdk.auth.currentUser = { uid: 'a' };
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        get length() { return storage.size; },
        key: (index: number) => [...storage.keys()][index] ?? null,
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)); },
        removeItem: (key: string) => { storage.delete(key); },
        clear: () => { storage.clear(); },
    });
    vi.stubGlobal('navigator', {
        locks: { request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run() },
    });
    sdk.root.mockResolvedValue({ exists: () => true, data: () => currentCloudDoc({ profile: { height: '170', gender: 'M' } }) });
    sdk.control.mockResolvedValue({ exists: () => true, data: () => ({ protocolVersion: 3, replicas: { s00: { lastSeq: 1 } } }) });
    sdk.page.mockResolvedValue({ size: 0, docs: [] });
});
afterEach(() => { lockAllVaults(); vi.unstubAllGlobals(); });

