import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { beforeEach, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
    auth: { currentUser: { uid: 'a' } as { uid: string } | null, signOut: vi.fn() },
    root: vi.fn(),
    page: vi.fn(),
    historyWindow: vi.fn(),
    nutritionWindow: vi.fn(),
}));

vi.mock('../../src/lib/firebase', () => ({
    auth: harness.auth,
    getDb: () => ({}),
    ensureAppCheck: async () => {},
    waitForPendingWrites: async () => {},
}));
vi.mock('../../src/lib/catalog/catalogService', () => ({
    getCachedCatalog: async () => ({ exercises: [], foods: [] }),
    syncGlobalCatalog: () => Promise.resolve(),
}));
vi.mock('../../src/lib/db/db_training', () => ({ loadHistoryMonths: harness.historyWindow }));
vi.mock('../../src/lib/db/db_nutrition', () => ({ loadNutritionMonths: harness.nutritionWindow }));
vi.mock('../../src/lib/telemetryHub', () => ({
    telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() },
}));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...path: string[]) => path.join('/'),
    collection: (_db: unknown, ...path: string[]) => path.join('/'),
    getDoc: harness.root,
    getDocsFromServer: harness.page,
    documentId: () => 'id',
    orderBy: () => ({}),
    limit: (count: number) => ({ count }),
    startAfter: (item: { id: string }) => ({ after: item.id }),
    query: (path: string, ...parts: object[]) => Object.assign({ path }, ...parts),
    runTransaction: vi.fn(),
}));

import { DB } from '../../src/lib/db';

const currentCloudDoc = (business: Record<string, unknown>) => ({
    ...business,
    _schemaVersion: 1,
    _sync: {
        protocolVersion: 3,
        clock: {},
        fields: {},
        writer: { slot: 's00', replicaId: 'rootless-fixture', generation: 1, seq: 0 },
    },
});

beforeEach(async () => {
    await clear();
    vi.resetAllMocks();
    harness.auth.currentUser = { uid: 'a' };
    harness.root.mockResolvedValue({ exists: () => false });
    harness.page.mockResolvedValue({ size: 0, docs: [] });
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
