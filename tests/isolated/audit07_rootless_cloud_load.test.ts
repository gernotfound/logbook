import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { beforeEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    auth: { currentUser: { uid: 'a' } as { uid: string } | null, signOut: vi.fn() },
    root: vi.fn(),
    cacheRoot: vi.fn(),
    page: vi.fn(),
    historyWindow: vi.fn(),
    nutritionWindow: vi.fn(),
    catalogSync: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => ({
    auth: harness.auth,
    getDb: () => ({}),
    ensureAppCheck: async () => {},
    waitForPendingWrites: async () => {},
}));
vi.mock('../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: async () => ({ exercises: [], foods: [] }),
    syncGlobalCatalog: harness.catalogSync,
}));
vi.mock('../../src/lib/db/db_training', () => ({ loadHistoryMonths: harness.historyWindow }));
vi.mock('../../src/lib/db/db_nutrition', () => ({ loadNutritionMonths: harness.nutritionWindow }));
vi.mock('../../src/lib/telemetryHub', () => ({
    telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...path: string[]) => path.join('/'),
    collection: (_db: unknown, ...path: string[]) => path.join('/'),
    getDoc: harness.cacheRoot,
    getDocFromServer: harness.root,
    getDocsFromServer: harness.page,
    documentId: () => 'id',
    orderBy: () => ({}),
    limit: (count: number) => ({ count }),
    startAfter: (item: { id: string }) => ({ after: item.id }),
    query: (path: string, ...parts: object[]) => Object.assign({ path }, ...parts),
    runTransaction: vi.fn(),
}));

import { DB } from '../../src/lib/db';
import { sealCloudDocument, CloudCiphertextError } from '../../src/lib/sync/cloudDocumentCipher';
import type { SyncMeta } from '../../src/lib/sync/semanticProjection/contracts';



beforeEach(async () => {
    await clear();
    vi.resetAllMocks();
    harness.catalogSync.mockResolvedValue({ catalog: { exercises: [], foods: [] }, updated: false });
    harness.auth.currentUser = { uid: 'a' };
    harness.root.mockResolvedValue({ exists: () => false });
    harness.cacheRoot.mockResolvedValue({ exists: () => false });
    harness.page.mockResolvedValue({ size: 0, docs: [] });
});


it('hydrates encrypted root and full history+nutrition scans, refusing a missing or wrong ADK', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const sync: SyncMeta = {
        protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's00', replicaId: 'root-cloud-test', generation: 1, seq: 0 },
    };
    const root = sealCloudDocument(key, 'a', '', { profile: { height: '179' } }, sync);
    const month = sealCloudDocument(key, 'a', 'history_months/2026-10',
        { w1: { id: 'w1', date: '2026-10-24', exercises: [] } }, sync);
    const nutrition = sealCloudDocument(key, 'a', 'nutrition_months/2026-10',
        { '2026-10-24': { date: '2026-10-24', weight: 79 } }, sync);
    harness.root.mockImplementation(async (path: string) => path.endsWith('/sync_control/state')
        ? { exists: () => true, data: () => ({ protocolVersion: 3, replicas: {} }) }
        : { exists: () => true, data: () => root });
    harness.page.mockImplementation(async ({ path }: { path: string }) => ({
        size: 1, docs: [{ id: '2026-10',
            data: () => path.endsWith('/history_months') ? month : nutrition }],
    }));
    const payload = await DB.loadCloudPayload({ allMonths: true, cloudKey: key });
    expect(payload?.data.profile?.height).toBe('179');
    expect(payload?.data.history?.map(w => w.id)).toEqual(['w1']);
    expect(payload?.data.nutrition?.['2026-10-24']?.weight).toBe(79);
    expect(payload?.cloudDocuments.get('')).not.toHaveProperty('_sealed');
    expect(payload?.cloudDocuments.get('history_months/2026-10')).not.toHaveProperty('_sealed');
    const silentConsole = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await expect(DB.loadCloudPayload({ allMonths: true }))
            .rejects.toBeInstanceOf(CloudCiphertextError);
        await expect(DB.loadCloudPayload({ allMonths: true, cloudKey: crypto.getRandomValues(new Uint8Array(32)) }))
            .rejects.toBeInstanceOf(CloudCiphertextError);
    } finally { silentConsole.mockRestore(); }
});

it('requires a server-confirmed root even when the memory cache reports a miss', async () => {
    harness.cacheRoot.mockResolvedValue({ exists: () => false });
    harness.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            profile: { height: '180' },
            _schemaVersion: 1,
            _sync: { protocolVersion: 3, clock: {}, fields: {},
                writer: { slot: 's00', replicaId: 'remote-root', generation: 1, seq: 0 } },
        }),
    });

    const payload = await DB.loadCloudPayload();
    expect(payload?.data.profile?.height).toBe('180');
    expect(payload?.cloudDocuments.get('')?._sync).toBeDefined();
    expect(harness.root).toHaveBeenCalledTimes(3);
    expect(harness.cacheRoot).not.toHaveBeenCalled();
});

it('rejects an unavailable authoritative root instead of treating a cached miss as deletion', async () => {
    harness.cacheRoot.mockResolvedValue({ exists: () => false });
    harness.root.mockRejectedValueOnce(new Error('Firestore server unavailable'));
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await expect(DB.loadCloudPayload()).rejects.toThrow('Firestore server unavailable');
        expect(harness.historyWindow).not.toHaveBeenCalled();
        expect(harness.nutritionWindow).not.toHaveBeenCalled();
        expect(harness.cacheRoot).not.toHaveBeenCalled();
    } finally {
        warning.mockRestore();
    }
});

it('continues window hydration when the root document is absent', async () => {
    harness.historyWindow.mockImplementation(async (_user, months: string[], state: any) => {
        state.history.push({ id: 'window-workout', date: months[0] + '-01' });
    });
    harness.nutritionWindow.mockImplementation(async (_user, months: string[], state: any) => {
        state.nutrition[months[0] + '-01'] = { date: months[0] + '-01', weight: 75 };
    });

    const payload = await DB.loadCloudPayload();

    expect(payload).not.toBeNull();
    expect(harness.historyWindow).toHaveBeenCalledOnce();
    expect(harness.nutritionWindow).toHaveBeenCalledOnce();
    expect(payload?.completeMonths).toHaveLength(3);
    expect(payload?.data.history?.map(item => item.id)).toContain('window-workout');
    expect(Object.keys(payload?.data.nutrition ?? {})).toContain(payload?.completeMonths[0] + '-01');
});

it('performs the exhaustive monthly scan when the root document is absent', async () => {
    harness.page.mockImplementation(async ({ path }: { path: string }) => {
        if (path.endsWith('history_months')) {
            return {
                size: 1,
                docs: [{ id: '2024-01', data: () => ({
                    'rootless-workout': { id: 'rootless-workout', date: '2024-01-10' },
                    _schemaVersion: 1,
                    _sync: {
                        protocolVersion: 3,
                        clock: {},
                        fields: {},
                        writer: { slot: 's00', replicaId: 'rootless-seed', generation: 1, seq: 0 },
                    },
                }) }],
            };
        }
        return {
            size: 1,
            docs: [{ id: '2023-12', data: () => ({
                '2023-12-05': { date: '2023-12-05', weight: 70 },
                _schemaVersion: 1,
                _sync: {
                    protocolVersion: 3,
                    clock: {},
                    fields: {},
                    writer: { slot: 's00', replicaId: 'rootless-seed', generation: 1, seq: 0 },
                },
            }) }],
        };
    });

    const payload = await DB.loadCloudPayload({ allMonths: true });

    expect(payload?.data.history?.map(item => item.id)).toEqual(['rootless-workout']);
    expect(payload?.data.nutrition?.['2023-12-05']?.weight).toBe(70);
    expect(payload?.completeMonths.sort()).toEqual(['2023-12', '2024-01']);
    expect(harness.page).toHaveBeenCalledTimes(2);
    expect(harness.historyWindow).not.toHaveBeenCalled();
    expect(harness.nutritionWindow).not.toHaveBeenCalled();
});


it('fails closed on incomplete full-month snapshots and recovers only after all damaged entries are repaired', async () => {
    const metadata = {
        protocolVersion: 3,
        clock: {},
        fields: {},
        writer: { slot: 's00', replicaId: 'rootless-seed', generation: 1, seq: 0 },
    };
    let damagedHistory = true;
    let damagedNutrition = true;
    harness.page.mockImplementation(async ({ path }: { path: string }) => path.endsWith('history_months')
        ? { size: 1, docs: [{
            id: '2024-01',
            data: () => ({
                good: { id: 'good', date: '2024-01-10', exercises: [] },
                ...(damagedHistory ? { wrongMonth: { id: 'wrongMonth', date: '2024-02-10', exercises: [] } } : {}),
                _schemaVersion: 1, _sync: metadata,
            }),
        }] }
        : { size: 1, docs: [{
            id: '2024-01',
            data: () => ({
                '2024-01-11': { date: '2024-01-11', weight: 72 },
                ...(damagedNutrition ? { '2024-01-12': { date: '2024-01-13', weight: 74 } } : {}),
                _schemaVersion: 1, _sync: metadata,
            }),
        }] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await expect(DB.loadCloudPayload({ allMonths: true })).rejects.toThrow('Shard storico 2024-01 non integro');
        damagedHistory = false;
        await expect(DB.loadCloudPayload({ allMonths: true })).rejects.toThrow('Shard nutrizione 2024-01 non integro');
        damagedNutrition = false;
        const payload = await DB.loadCloudPayload({ allMonths: true });
        expect(payload?.completeMonths).toEqual(['2024-01']);
        expect(payload?.data.history?.map(record => record.id)).toEqual(['good']);
        expect(payload?.data.nutrition?.['2024-01-11']?.weight).toBe(72);
        expect(payload?.cloudDocuments.get('history_months/2024-01')).toMatchObject({
            good: { id: 'good' }, _sync: metadata,
        });
        expect(payload?.cloudDocuments.get('nutrition_months/2024-01')).toMatchObject({
            '2024-01-11': { date: '2024-01-11' }, _sync: metadata,
        });
        expect(harness.page).toHaveBeenCalledTimes(5);
    } finally {
        consoleError.mockRestore();
    }
});

it('blocks lossy full-month normalizations but permits safe numeric conversions', async () => {
    const metadata = { protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's00', replicaId: 'rootless-seed', generation: 1, seq: 0 } };
    let weight = 'not-a-number';
    harness.page.mockImplementation(async ({ path }: { path: string }) => path.endsWith('history_months')
        ? { size: 0, docs: [] }
        : { size: 1, docs: [{
            id: '2024-01',
            data: () => ({ '2024-01-11': { date: '2024-01-11', weight },
                _schemaVersion: 1, _sync: metadata }),
        }] });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await expect(DB.loadCloudPayload({ allMonths: true }))
            .rejects.toThrow('Dati cloud non validi in Firestore nutrition_months/2024-01');
        weight = '72.5';
        const recovered = await DB.loadCloudPayload({ allMonths: true });
        expect(recovered?.data.nutrition?.['2024-01-11']?.weight).toBe(72.5);
    } finally {
        consoleError.mockRestore();
    }
});

it('rejects malformed root collections without publishing sanitized partial user data', async () => {
    const metadata = { protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's00', replicaId: 'root-seed', generation: 1, seq: 0 } };
    let routines = [{ id: '', name: 'Discarded routine', exercises: [] }];
    harness.root.mockImplementation(async () => ({
        exists: () => true,
        data: () => ({ profile: { height: '175' }, routines,
            _schemaVersion: 1, _sync: metadata }),
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await expect(DB.loadCloudPayload()).rejects.toThrow('Dati cloud non validi in Firestore root (routines)');
        routines = [{ id: 'routine-1', name: 'Valid routine', exercises: [] }];
        const result = await DB.loadCloudPayload();
        expect(result?.data.routines?.map(routine => routine.id)).toEqual(['routine-1']);
    } finally {
        consoleError.mockRestore();
    }
});

it('preserves an explicitly absent legacy nutrition plan during root integrity validation', async () => {
    harness.root.mockResolvedValue({
        exists: () => true,
        data: () => ({
            profile: { height: '178' },
            routines: [],
            nutritionPlanning: null,
            _schemaVersion: 1,
            _sync: { protocolVersion: 3, clock: {}, fields: {},
                writer: { slot: 's00', replicaId: 'root-seed', generation: 1, seq: 0 } },
        }),
    });
    const payload = await DB.loadCloudPayload();
    expect(payload?.data.profile?.height).toBe('178');
    expect(payload?.data.nutritionPlanning).toBeNull();
});

it('does not silently clear a remote active workout with an invalid identity', async () => {
    const metadata = { protocolVersion: 3, clock: {}, fields: {},
        writer: { slot: 's00', replicaId: 'root-seed', generation: 1, seq: 0 } };
    harness.root.mockResolvedValue({
        exists: () => true,
        data: () => ({ activeWorkout: { id: '', date: '2024-01-11', exercises: [] },
            _schemaVersion: 1, _sync: metadata }),
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
        await expect(DB.loadCloudPayload()).rejects.toThrow('Dati cloud non validi in Firestore root (activeWorkout)');
    } finally {
        consoleError.mockRestore();
    }
});

it('loads history and nutrition month windows concurrently', async () => {
    let finishHistory: (() => void) | undefined;
    let finishNutrition: (() => void) | undefined;
    harness.historyWindow.mockImplementation(() => new Promise<void>(resolve => { finishHistory = resolve; }));
    harness.nutritionWindow.mockImplementation(() => new Promise<void>(resolve => { finishNutrition = resolve; }));
    const loading = DB.loadCloudPayload();
    try {
        await vi.waitFor(() => {
            expect(harness.historyWindow).toHaveBeenCalledOnce();
            expect(harness.nutritionWindow).toHaveBeenCalledOnce();
        });
    } finally {
        finishHistory?.();
        finishNutrition?.();
    }
    expect(await loading).not.toBeNull();
});


it('publishes the freshly downloaded catalog instead of the stale initial cache', async () => {
    let releaseCatalog: ((value: unknown) => void) | undefined;
    harness.catalogSync.mockImplementation(() => new Promise(resolve => { releaseCatalog = resolve; }));
    const loading = DB.loadCloudPayload();
    await vi.waitFor(() => {
        expect(harness.root).toHaveBeenCalledTimes(2);
        expect(harness.catalogSync).toHaveBeenCalledOnce();
    });
    releaseCatalog?.({
        updated: true, persisted: true,
        catalog: {
            exercises: [{ id: 'new-exercise', name: 'Catalog exercise', trackingType: 'weight_reps' }],
            foods: [{ id: 'new-food', name: 'Catalog food', kcal: 100, carbs: 20, pro: 5, fat: 0 }],
        },
    });
    const payload = await loading;
    expect(payload?.data.library?.some(item => item.id === 'new-exercise' && item.isDefault)).toBe(true);
    expect(payload?.data.customFoods?.some(item => item.id === 'new-food' && item.isCustom === false)).toBe(true);
});

it('retries a mixed full read, publishing only the stable server epoch', async () => {
    let controlReads = 0;
    let pages = 0;
    harness.root.mockImplementation(async (path: string) => {
        if (path.endsWith('sync_control/state')) {
            controlReads += 1;
            // Document snapshots hold immutable data from their read instant.
            const epoch = controlReads === 1 ? 1 : 2;
            return { exists: () => true, data: () => ({ epoch }) };
        }
        return { exists: () => false };
    });
    harness.page.mockImplementation(async ({ path }: { path: string }) => {
        if (path.endsWith('nutrition_months')) return { size: 0, docs: [] };
        pages += 1;
        return { size: 1, docs: [{
            id: '2024-01', data: () => ({
                ['w' + pages]: { id: 'w' + pages, date: '2024-01-01', exercises: [] },
                _schemaVersion: 1,
                _sync: { protocolVersion: 3, clock: {}, fields: {}, writer: {
                    slot: 's00', replicaId: 'test-reader', generation: 1, seq: 0,
                } },
            }),
        }] };
    });
    const snapshot = await DB.loadCloudPayload({ allMonths: true });
    expect(controlReads).toBe(4);
    expect(pages).toBe(2);
    expect(snapshot?.data.history?.map(item => item.id)).toEqual(['w2']);
});

it('fails closed when the cloud changes throughout both full-read attempts', async () => {
    let epoch = 0;
    harness.root.mockImplementation(async (path: string) => path.endsWith('sync_control/state')
        ? { exists: () => true, data: () => ({ epoch: ++epoch }) }
        : { exists: () => false });
    await expect(DB.loadCloudPayload({ allMonths: true })).rejects.toMatchObject({
        code: 'concurrent-cloud-read',
    });
    expect(harness.page).toHaveBeenCalledTimes(4);
});

it('retains the offline cached catalog when the remote catalog update rejects', async () => {
    harness.catalogSync.mockRejectedValueOnce(new Error('offline'));
    const payload = await DB.loadCloudPayload();
    expect(payload).not.toBeNull();
    expect(payload?.data.library).toEqual([]);
    expect(payload?.data.customFoods).toEqual([]);
});
