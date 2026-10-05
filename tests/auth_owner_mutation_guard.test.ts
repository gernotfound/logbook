import { beforeEach, describe, expect, it } from 'vitest';
import { emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { rememberAuthenticatedOwner } from '../src/lib/sync/authOwnerHint';

describe('authenticated owner mutation guard', () => {
    beforeEach(() => {
        localStorage.clear();
        useAppStore.getState().resetStore({ force: true });
    });

    it('rejects a mutation when in-memory data belongs to a different authenticated owner', async () => {
        rememberAuthenticatedOwner('account-b');
        useAppStore.setState({
            userData: structuredClone(emptyUserData),
            dataOwner: 'user:account-a',
            localPersistenceBlocked: false,
        });

        await expect(
            useAppStore.getState().dispatchDomainOperation({
                type: 'profile.patch',
                patch: { height: '180' },
            }),
        ).rejects.toThrow('Dati locali non allineati');

        expect(useAppStore.getState().dataOwner).toBe('user:account-a');
    });
});
