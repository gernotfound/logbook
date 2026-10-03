import React from 'react';
import { act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHomeView } from '../src/hooks/useHomeView';
import { useAppStore } from '../src/store/useAppStore';
import { emptyUserData, renderWithProviders } from './setup';

describe('home pain persistence', () => {
    it('observes a rejected domain write so it cannot become an unhandled rejection', async () => {
        const rejection = new Error('IndexedDB pain write failed');
        const dispatchDomainOperation = vi.fn().mockRejectedValueOnce(rejection);
        useAppStore.setState({ dispatchDomainOperation });

        let hookResult: ReturnType<typeof useHomeView> | null = null;
        function TestHomeComponent() {
            hookResult = useHomeView();
            return <div>{hookResult.loading ? 'loading' : 'ready'}</div>;
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
});
