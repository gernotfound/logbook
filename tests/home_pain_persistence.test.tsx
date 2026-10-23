import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { update } from 'idb-keyval';
import { captureSession } from '../src/lib/sync/session';
import { initializeLocal, readLocal } from '../src/lib/sync/localRepository';
import { prepareUnlockedTestArchive } from './secureVaultFixture';
import { UserDataSchema } from '../src/lib/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHomeView } from '../src/hooks/useHomeView';
import { useAppStore } from '../src/store/useAppStore';
import { emptyUserData, renderWithProviders } from './setup';

const originalDispatch = useAppStore.getState().dispatchDomainOperation;
afterEach(() => { useAppStore.setState({ dispatchDomainOperation: originalDispatch }); });

describe('home pain persistence', () => {
    it('observes a rejected domain write so it cannot become an unhandled rejection', async () => {
        const rejection = new Error('IndexedDB pain write failed');
        const dispatchDomainOperation = vi.fn().mockRejectedValueOnce(rejection);
        useAppStore.setState({ dispatchDomainOperation });

        let hookResult: ReturnType<typeof useHomeView> | null = null;
        function TestHomeComponent() {
            const latest = useHomeView();
            React.useEffect(() => { hookResult = latest; });
            return <div>{latest.loading ? 'loading' : 'ready'}</div>;
        }

        renderWithProviders(<TestHomeComponent />, {
            userData: { ...emptyUserData, activePains: [] } as any,
        });

        act(() => {
            if (!hookResult || hookResult.loading) throw new Error('Home hook not ready');
            hookResult.toggleActivePain('chest_upper');
        });
        await act(async () => {
            await Promise.resolve();
        });

        expect(dispatchDomainOperation).toHaveBeenCalledWith({
            type: 'active-pains.set',
            pains: ['chest_upper'],
        });
    });

    it('rolls back optimistic pains when the encrypted IndexedDB commit fails', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const data = UserDataSchema.parse({ activePains: [] });
        await initializeLocal(owner, data);
        useAppStore.setState({
            dataOwner: owner, userData: data, dispatchDomainOperation: originalDispatch,
            localPersistenceBlocked: false, saveError: null,
        });

        const { result } = renderHook(() => useHomeView());
        await waitFor(() => expect(result.current.loading).toBe(false));
        vi.mocked(update).mockRejectedValueOnce(new Error('Injected IndexedDB pain write failure'));
        act(() => {
            const home = result.current;
            if (home.loading) throw new Error('Home hook not ready');
            home.toggleActivePain('chest_upper');
        });
        await act(async () => { await useAppStore.getState().flushPendingSyncs(); });

        await waitFor(() => expect(useAppStore.getState().syncHealth).toBe('failed'));
        expect(useAppStore.getState().userData?.activePains).toEqual([]);
        const durable = await readLocal(owner);
        expect(durable?.data.activePains).toEqual([]);
        expect(durable?.pending).toEqual([]);
        expect(useAppStore.getState().saveError).toContain('IndexedDB pain write failure');
    });
});
