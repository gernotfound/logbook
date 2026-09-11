import { expect, it } from 'vitest';
import { reconcile } from '../../src/lib/sync/reconcile';

it('retains all 31 remote days when adding a day from a partial snapshot', () => {
    const remote = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`2026-05-${String(i + 1).padStart(2, '0')}`, { weight: 80 }]));
    const result = reconcile({}, { '2026-05-01': { sleep: '07:30' } }, remote);
    expect(Object.keys(result.value as object)).toHaveLength(31);
    expect((result.value as Record<string, unknown>)['2026-05-01']).toEqual({ weight: 80, sleep: '07:30' });
    expect(result.conflicts).toEqual([]);
});
it('converges independent edits and retries an already committed write idempotently', () => {
    const base = { profile: { height: 170, weight: 80 } };
    const local = { profile: { height: 171, weight: 80 } };
    const remote = { profile: { height: 170, weight: 81 } };
    const first = reconcile(base, local, remote);
    expect(first.value).toEqual({ profile: { height: 171, weight: 81 } });
    expect(reconcile(base, local, first.value)).toEqual(first);
});
it('merges per ID, preserving independent additions and deletions', () => {
    const result = reconcile([{ id: 'a', kg: 1 }, { id: 'b', kg: 2 }], [{ id: 'b', kg: 3 }], [{ id: 'a', kg: 1 }, { id: 'b', kg: 2 }, { id: 'c', kg: 4 }]);
    expect(result.value).toEqual([{ id: 'b', kg: 3 }, { id: 'c', kg: 4 }]);
    expect(result.conflicts).toEqual([]);
});
it('keeps both alternatives for edit/delete and same-field collisions', () => {
    const result = reconcile({ a: { kg: 1 } }, {}, { a: { kg: 2 } });
    expect(result.conflicts).toEqual([{ path: ['a'], base: { kg: 1 }, local: undefined, remote: { kg: 2 } }]);
    expect(reconcile(1, 2, 3).conflicts).toHaveLength(1);
});
it('does not resurrect a remote deletion when the local value is unchanged', () => {
    expect(reconcile({ a: 1 }, { a: 1 }, {}).value).toEqual({});
});
