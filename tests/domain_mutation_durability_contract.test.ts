import { describe, expect, it, vi } from 'vitest';
import { dispatchDurableOperation } from '../src/lib/sync/dispatchDurableOperation';
import type { SyncResult } from '../src/types';

const operation = { type: 'active-pains.set' as const, pains: [] };

describe('domain mutation durability boundary', () => {
    it('allows confirmed sync to release a draft', async () => {
        const dispatch = vi.fn().mockResolvedValue({ ok: true, status: 'synced' } satisfies SyncResult);
        await expect(dispatchDurableOperation(dispatch, operation)).resolves.toBeUndefined();
        expect(dispatch).toHaveBeenCalledWith(operation);
    });
    it('accepts verified local journal persistence while offline', async () => {
        const dispatch = vi.fn().mockResolvedValue({ ok: false, status: 'local-pending', error: new Error('offline') } satisfies SyncResult);
        await expect(dispatchDurableOperation(dispatch, operation)).resolves.toBeUndefined();
    });
    it.each(['failed', 'rejected'] as const)('rejects %s outcomes instead of reporting success', async status => {
        const error = new Error('not durable');
        const dispatch = vi.fn().mockResolvedValue({ ok: false, status, error } satisfies SyncResult);
        await expect(dispatchDurableOperation(dispatch, operation)).rejects.toBe(error);
    });
    it('rejects non-Error failure payloads', async () => {
        const dispatch = vi.fn().mockResolvedValue({ ok: false, status: 'failed', error: { code: 'conflict' } } satisfies SyncResult);
        await expect(dispatchDurableOperation(dispatch, operation)).rejects.toThrow('non confermato');
    });
    it('preserves rejected persistence promises', async () => {
        const error = new Error('IndexedDB unavailable');
        await expect(dispatchDurableOperation(vi.fn().mockRejectedValue(error), operation)).rejects.toBe(error);
    });
});
