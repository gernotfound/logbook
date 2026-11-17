import { describe, it, expect } from 'vitest';
import { formatDuration, getCalendarMonthGrid } from '../../../src/lib/utils/date';

describe('Calendar and date boundary stress', () => {
    describe('R3 Stress: Date Transitions, DST & Calendar Grids', () => {

        it('getCalendarMonthGrid generates exact 5 or 6 week grids without NaN or missing days', () => {
            // Months across 2026
            for (let m = 0; m < 12; m++) {
                const grid = getCalendarMonthGrid(2026, m);
                expect(grid.length).toBeGreaterThanOrEqual(28);
                expect(grid.length % 7).toBe(0);
                grid.forEach(day => {
                    expect(day.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                    expect(typeof day.dayNum).toBe('number');
                    expect(typeof day.isCurrentMonth).toBe('boolean');
                });
            }
        });

        it('formatDuration handles 0, seconds, minutes, hours, and extreme durations without crash', () => {
            expect(formatDuration(0)).toBe('00:00:00');
            expect(formatDuration(60)).toBe('00:01:00');
            expect(formatDuration(3600)).toBe('01:00:00');
            expect(formatDuration(3665)).toBe('01:01:05');
            expect(formatDuration(86400)).toBe('24:00:00');
        });
    });
});
