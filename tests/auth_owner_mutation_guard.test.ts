import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emptyUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { rememberAuthenticatedOwner } from '../src/lib/sync/authOwnerHint';
import { auth } from '../src/lib/firebase';
import { storageOwner } from '../src/lib/sync/session';

describe('authenticated owner mutation guard', () => {
    let initialUser: typeof auth.currentUser;
    beforeEach(() => {
        initialUser = auth.currentUser;
        localStorage.clear();
        (auth as any).currentUser = { ...initialUser, uid: 'account-b' };
        useAppStore.getState().resetStore({ force: true });
    });
    afterEach(() => {
        (auth as any).currentUser = initialUser;
    });

    it('rejects a mutation when in-memory data belongs to a different authenticated owner', async () => {
        rememberAuthenticatedOwner('account-b');
        expect(storageOwner()).toBe('user:account-b');
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
        ).rejects.toThrow('Dati in memoria senza proprietario valido');

        expect(useAppStore.getState().dataOwner).toBe('user:account-a');
        expect(useAppStore.getState().userData?.profile?.height).not.toBe('180');
    });
});
