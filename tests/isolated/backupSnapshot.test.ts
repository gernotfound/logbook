import 'fake-indexeddb/auto';
import { clear } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ auth: { currentUser: { uid: 'a' } }, root: vi.fn(), page: vi.fn() }));
vi.mock('../../src/lib/firebase', () => ({ auth: sdk.auth, getDb: () => ({}), ensureAppCheck: async () => {} }));
vi.mock('../../src/lib/catalog/catalogService', () => ({ getCachedCatalog: async () => ({ exercises: [], foods: [] }) }));
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
vi.mock('firebase/firestore', () => ({
    doc: (_db: unknown, ...path: string[]) => path.join('/'), collection: (_db: unknown, ...path: string[]) => path.join('/'),
    documentId: () => 'id', orderBy: () => ({}), limit: (count: number) => ({ count }), startAfter: (item: { id: string }) => ({ after: item.id }),
    query: (path: string, ...parts: object[]) => Object.assign({ path }, ...parts), getDocFromServer: sdk.root, getDocsFromServer: sdk.page,
}));
import { collectBackupSnapshot } from '../../src/lib/db/backupSnapshot';
import { initializeLocal, commitLocal } from '../../src/lib/sync/localRepository';
import { UserDataSchema } from '../../src/lib/schema';
import { invalidateSession } from '../../src/lib/sync/session';
import type { UserData } from '../../src/types';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
beforeEach(async () => {
    await clear(); vi.resetAllMocks(); invalidateSession(); sdk.auth.currentUser = { uid: 'a' };
    vi.stubGlobal('localStorage', { length: 0, getItem: () => null });
    sdk.root.mockResolvedValue({ exists: () => true, data: () => ({ profile: { height: '170', gender: 'M' } }) });
    sdk.page.mockResolvedValue({ size: 0, docs: [] });
});
afterEach(() => vi.unstubAllGlobals());
it('collects every page of historical documents beyond the 3-month view and retains a concurrent local edit', async () => {
    const base = parse({ profile: { height: '170', gender: 'M' } });
    await initializeLocal('user:a', base);
    const months = Array.from({ length: 105 }, (_, index) => (2017 + Math.floor(index / 12)) + '-' + String(index % 12 + 1).padStart(2, '0'));
    sdk.page.mockImplementation(async ({ path, after, count }) => {
        if (path.endsWith('nutrition_months')) return { size: 0, docs: [] };
        const ids = months.filter(id => !after || id > after).slice(0, count);
        if (after) await commitLocal('user:a', parse({ profile: { height: '175', gender: 'M' } }), base);
        return { size: ids.length, docs: ids.map(id => ({ id, data: () => ({ ['h' + id]: { id: 'h' + id, date: id + '-01' } }) })) };
    });
    const backup = await collectBackupSnapshot(base, true);
    expect(backup.data.history).toHaveLength(105);
    expect(backup.data.profile.height).toBe('175');
    expect(backup.coverage).toMatchObject({ scope: 'cloud-and-device', months });
    expect(sdk.page).toHaveBeenCalledTimes(4);
    expect(backup.recovery.envelope?.pending.length).toBeGreaterThan(0);
});
it('never labels a failed cloud scan complete; explicit device export still works', async () => {
    const data = parse({ profile: { height: '171' } });
    await initializeLocal('user:a', data);
    sdk.page.mockRejectedValue(new Error('offline'));
    await expect(collectBackupSnapshot(data, true)).rejects.toThrow('offline');
    expect((await collectBackupSnapshot(data, false)).coverage.scope).toBe('device');
});
it('aborts if the account changes between pages', async () => {
    sdk.page.mockImplementation(async () => { sdk.auth.currentUser = { uid: 'b' }; invalidateSession(); return { size: 0, docs: [] }; });
    await expect(collectBackupSnapshot(parse({}), true)).rejects.toThrow('Sessione cambiata');
});
