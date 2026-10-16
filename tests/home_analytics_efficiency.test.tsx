import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { useHomeView } from '../src/hooks/useHomeView';
import { Logic } from '../src/lib/logic';
import { emptyUserData, renderWithProviders } from './setup';
import type { NutritionDay } from '../src/types';

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
        const nutrition: Record<string, NutritionDay> = {
            '2026-08-02': { date: '2026-08-02', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: '82.5', bf: '18.1', bfProvenance: { method: 'manual' } },
            '2026-08-03': { date: '2026-08-03', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: '83.1', bf: '' },
            '2026-08-04': { date: '2026-08-04', kcal: 2200, carbs: 200, pro: 150, fat: 80 },
        };
        renderWithProviders(<HomeSummary />, {
            userData: {
                ...emptyUserData,
                history: [],
                nutrition,
            },
        });

        expect(screen.getByTestId('home-summary').textContent).toBe('83.1|18.1|Manuale|2500');
        expect(tdee).not.toHaveBeenCalled();
    });
    it('orders legacy nutrition dates canonically, ignoring invalid days and weights', () => {
        function HomeSummary() {
            const home = useHomeView();
            if (home.loading) return <output>Caricamento</output>;
            return <output data-testid="home-legacy-summary">{[home.userWeight, home.bf, home.bfSource].join('|')}</output>;
        }
        const day = (date: string, weight?: string, bf?: string, method?: 'manual' | 'us_navy'): NutritionDay => ({
            date, kcal: 0, carbs: 0, pro: 0, fat: 0, weight, bf,
            ...(method ? { bfProvenance: { method } } : {}),
        });
        const nutrition: Record<string, NutritionDay> = {
            '2026-9-30': day('2026-9-30', '90', '20', 'manual'),
            '2026-10-02': day('2026-10-02', '82', '18', 'manual'),
            '03/10/2026': day('03/10/2026', '81,5', '17.2', 'us_navy'),
            '2026-13-40': day('2026-13-40', '99', '9', 'manual'),
            '2026-10-04': day('2026-10-04', '-6', ''),
            'not-a-date': day('not-a-date', '150', '5', 'manual'),
        };
        renderWithProviders(<HomeSummary />, {
            userData: { ...emptyUserData, history: [], nutrition },
        });
        expect(screen.getByTestId('home-legacy-summary').textContent).toBe('81.5|17.2|US Navy');
    });

    it('uses the last valid measurement for equal canonical dates and skips malformed entries', () => {
        function HomeSummary() {
            const home = useHomeView();
            if (home.loading) return <output>Caricamento</output>;
            return <output data-testid="home-equal-day">{[home.userWeight, home.bf, home.bfSource].join('|')}</output>;
        }
        const nutrition: Record<string, NutritionDay> = {
            '2026-08-02': { date: '2026-08-02', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: '80', bf: '20', bfProvenance: { method: 'manual' } },
            '02/08/2026': { date: '02/08/2026', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: '81', bf: '19', bfProvenance: { method: 'us_navy' } },
            '2026-08-03': { date: '2026-08-03', kcal: 0, carbs: 0, pro: 0, fat: 0, weight: 'not-a-weight', bf: '' },
        };
        renderWithProviders(<HomeSummary />, {
            userData: { ...emptyUserData, history: [], nutrition },
        });
        expect(screen.getByTestId('home-equal-day').textContent).toBe('81|19.0|US Navy');
    });

});
