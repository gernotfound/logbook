import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import HomeView from '../../src/components/Home/HomeView';
import { getLocalDateString, shiftDateString } from '../../src/lib/utils/date';
import { emptyUserData, renderWithProviders } from '../setup';

describe('Home biometry: most recently recorded weight', () => {
    it('shows the latest recorded measurement even when it is outside the chart period', () => {
        const oldDate = shiftDateString(getLocalDateString(), -12);
        const { container } = renderWithProviders(<HomeView onNavigate={vi.fn()} />, {
            userData: {
                ...emptyUserData,
                nutrition: {
                    [oldDate]: { date: oldDate, weight: 78.4 },
                },
            } as typeof emptyUserData,
        });

        const value = container.querySelector('.home-biometry dt + dd');
        expect(value?.textContent).toContain('78.4 kg');
        const period = within(screen.getByRole('group', { name: 'Periodo del peso corporeo' }));
        expect(period.getByRole('button', { name: '1 sett' }).getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(period.getByRole('button', { name: '1 mese' }));
        expect(value?.textContent).toContain('78.4 kg');
        fireEvent.click(period.getByRole('button', { name: '1 sett' }));
        expect(value?.textContent).toContain('78.4 kg');
    });

    it('keeps the empty value when no valid weight measurement is recorded', () => {
        const { container } = renderWithProviders(<HomeView onNavigate={vi.fn()} />, {
            userData: { ...emptyUserData, nutrition: {} },
        });
        expect(container.querySelector('.home-biometry dt + dd')?.textContent?.trim()).toBe('--');
    });
});
