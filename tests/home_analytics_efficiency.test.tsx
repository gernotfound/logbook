import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useHomeView } from '../src/hooks/useHomeView';
import { Logic } from '../src/lib/logic';
import { emptyUserData, renderWithProviders } from './setup';

describe('Home nutrition summary efficiency', () => {
    afterEach(() => { vi.restoreAllMocks(); });

    it('does not recompute an unused TDEE and preserves latest weight and BF provenance', () => {
        const tdee = vi.spyOn(Logic, 'calculateTDEE');
        function HomeSummary() {
            const home = useHomeView();
            if (home.loading) return <output>Caricamento</output>;
            return <output data-testid="home-summary">{[
                home.userWeight, home.bf, home.bfSource, home.kcalTarget,
            ].join('|')}</output>;
        }
        renderWithProviders(<HomeSummary />, {
            userData: {
                ...emptyUserData,
                history: [],
                nutrition: {
                    '2026-08-02': { date: '2026-08-02', weight: '82.5', bf: '18.1', bfProvenance: { method: 'manual' } },
                    '2026-08-03': { date: '2026-08-03', weight: '83.1', bf: '' },
                    '2026-08-04': { date: '2026-08-04', kcal: 2200 },
                },
            } as typeof emptyUserData,
        });

        expect(screen.getByTestId('home-summary').textContent).toBe('83.1|18.1|Manuale|2500');
        expect(tdee).not.toHaveBeenCalled();
    });
});
