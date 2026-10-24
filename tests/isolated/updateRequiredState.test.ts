import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';
import { FutureVersionError } from '../../src/lib/schemaEvolution';
import { captureSession } from '../../src/lib/sync/session';

describe('update-required application state', () => {
    beforeEach(() => {
        useAppStore.setState({
            userData: null,
            compatibilityStatus: 'ok',
            compatibilityError: null,
            saveError: null,
            syncing: false,
            syncHealth: 'synced',
        });
    });

    it('remains active in the store and blocks subsequent local/store writes', async () => {
        const original = { profile: { name: 'before' } } as any;
        const owner = captureSession().owner;
        useAppStore.setState({ userData: original, dataOwner: owner });
        expect(useAppStore.getState().dataOwner).toBe(owner);

        const error = new FutureVersionError('Firestore root data schema', 2, 1);
        useAppStore.getState().setUpdateRequired(error);

        expect(useAppStore.getState().compatibilityStatus).toBe('update-required');
        expect(useAppStore.getState().compatibilityError).toContain('aggiorna TheLogBook');

        useAppStore.getState().setUserData({ profile: { name: 'after' } } as any);
        expect(useAppStore.getState().userData).toBe(original);

        const result = await useAppStore.getState().saveUserData({ profile: { name: 'after' } } as any);
        expect(result.ok).toBe(false);
        expect(result.status).toBe('failed');
        expect(useAppStore.getState().userData).toBe(original);
    });
});
