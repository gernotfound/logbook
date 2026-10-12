import { describe, expect, it } from 'vitest';
import { getDateNavigatorState } from './dateNavigator';

describe('shared day navigation', () => {
    it('formats dates without depending on UTC day shifts', () => {
        expect(getDateNavigatorState('2026-10-10', '2026-10-11')).toEqual({
            isToday: false, formattedDate: '10/10/2026', nextDisabled: false,
        });
    });
    it('disables advancing past today and respects the caller disabled state', () => {
        expect(getDateNavigatorState('2026-10-11', '2026-10-11').nextDisabled).toBe(true);
        expect(getDateNavigatorState('2026-10-10', '2026-10-11', true).nextDisabled).toBe(true);
    });
});
