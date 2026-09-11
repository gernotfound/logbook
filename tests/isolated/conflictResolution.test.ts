import 'fake-indexeddb/auto';
import { clear, get, set } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
import { UserDataSchema } from '../../src/lib/schema';
import { initializeLocal, readLocal, resolveLocalConflicts, acknowledgeThrough } from '../../src/lib/sync/localRepository';
import { applyConflictChoice } from '../../src/lib/sync/conflictResolution';
import { reconcile } from '../../src/lib/sync/reconcile';
import type { UserData } from '../../src/types';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const conflict = { path: ['profile', 'height'], base: '170', local: '171', remote: '172' };
beforeEach(async () => {
    await clear(); await initializeLocal('user:a', parse({ profile: { height: '171', gender: 'M' } }));
    const envelope = (await readLocal('user:a'))!;
    await set('logbook:v2:user:a', { ...envelope, conflicts: [conflict] });
});
afterEach(() => vi.restoreAllMocks());
it('records a deliberate local choice relative to the observed remote value and preserves alternatives after acknowledgement', async () => {
    const saved = await resolveLocalConflicts('user:a', 0, [conflict], ['local'], () => true);
    expect(saved.data.profile.height).toBe('171'); expect(saved.baseline.profile.height).toBe('172');
    expect(saved.conflicts).toEqual([]); expect(saved.pending).toHaveLength(1);
    expect(reconcile(saved.baseline, saved.data, parse({ ...saved.baseline, profile: { ...saved.baseline.profile, gender: 'F' } })).conflicts).toEqual([]);
    await acknowledgeThrough('user:a', saved.revision, saved.data);
    await initializeLocal('user:a', saved.data);
    expect((await readLocal('user:a'))?.resolvedConflicts?.[0]).toEqual({ conflict, choice: 'local', revision: 1 });
});
it('applies a remote choice without replacing independent fields', async () => {
    const saved = await resolveLocalConflicts('user:a', 0, [conflict], ['remote'], () => true);
    expect(saved.data.profile).toMatchObject({ height: '172', gender: 'M' });
});
it('refuses stale revisions, changed conflicts and expired sessions without losing alternatives', async () => {
    const before = await get('logbook:v2:user:a');
    await expect(resolveLocalConflicts('user:a', 1, [conflict], ['local'], () => true)).rejects.toThrow('cambiati');
    await expect(resolveLocalConflicts('user:a', 0, [{ ...conflict, remote: '180' }], ['local'], () => true)).rejects.toThrow('cambiati');
    await expect(resolveLocalConflicts('user:a', 0, [conflict], ['local'], () => false)).rejects.toThrow('Sessione');
    expect(await get('logbook:v2:user:a')).toEqual(before);
});
it('rolls back the entire resolution when IndexedDB rejects the commit', async () => {
    const before = await get('logbook:v2:user:a');
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new Error('quota'); });
    await expect(resolveLocalConflicts('user:a', 0, [conflict], ['local'], () => true)).rejects.toThrow('quota');
    expect(await get('logbook:v2:user:a')).toEqual(before);
});
it('maps monthly document conflicts to UserData and resolves array elements by ID', () => {
    const data = { nutrition: { '2026-09-01': { meals: [{ id: 'meal', kcal: 100 }, { id: 'other', kcal: 200 }] } } };
    const collision = { path: ['nutrition_months', '2026-09', '2026-09-01', 'meals', 'meal', 'kcal'], base: 50, local: 0, remote: 100 };
    expect(applyConflictChoice(data, collision, 'local')).toEqual({ nutrition: { '2026-09-01': { meals: [{ id: 'meal', kcal: 0 }, { id: 'other', kcal: 200 }] } } });
    expect(data.nutrition['2026-09-01'].meals[0].kcal).toBe(100);
});
it('distinguishes deletion from null/false and can restore a deleted workout', () => {
    const collision = { path: ['history_months', '2026-09', 'a'], base: {}, local: { id: 'a', date: '2026-09-01' }, remote: undefined };
    expect(applyConflictChoice({ history: [{ id: 'a' }, { id: 'b' }] }, collision, 'remote')).toEqual({ history: [{ id: 'b' }] });
    expect(applyConflictChoice({ history: [] }, collision, 'local')).toEqual({ history: [collision.local] });
    expect(applyConflictChoice({ flag: true }, { path: ['flag'], base: true, local: false, remote: null }, 'local')).toEqual({ flag: false });
});
