import { describe, it, expect } from 'vitest';
import { formatDuration, getCalendarMonthGrid } from '../../../src/lib/utils/date';

describe('Calendar and date boundary stress', () => {
    describe('R3 Stress: Date Transitions, DST & Calendar Grids', () => {

        it('getCalendarMonthGrid returns complete Monday-to-Sunday weeks with every month day exactly once', () => {
            for (let month = 0; month < 12; month++) {
                const grid = getCalendarMonthGrid(2026, month);
                expect([35, 42]).toContain(grid.length);

                const dates = grid.map(day => day.dateStr);
                const asUtcDay = (date: string): number => {
                    const [year, monthNumber, day] = date.split('-').map(Number);
                    return Date.UTC(year, monthNumber - 1, day);
                };
                expect(new Set(dates).size).toBe(grid.length);
                expect(new Date(asUtcDay(dates[0])).getUTCDay()).toBe(1);
                expect(new Date(asUtcDay(dates[dates.length - 1])).getUTCDay()).toBe(0);

                for (let index = 0; index < grid.length; index++) {
                    const cell = grid[index];
                    expect(cell.dateStr).toMatch(/^\d{4}-\d{2}-\d{2}$/);
                    expect(cell.dayNum).toBe(Number(cell.dateStr.slice(-2)));
                    expect(cell.isCurrentMonth).toBe(cell.dateStr.startsWith(
                        `2026-${String(month + 1).padStart(2, '0')}-`,
                    ));
                    if (index > 0) {
                        // UTC calendar arithmetic avoids DST offsets in the test oracle.
                        expect(asUtcDay(cell.dateStr) - asUtcDay(dates[index - 1]))
                            .toBe(24 * 60 * 60 * 1000);
                    }
                }

                const daysInMonth = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
                expect(grid.filter(day => day.isCurrentMonth).map(day => day.dayNum))
                    .toEqual(Array.from({ length: daysInMonth }, (_, index) => index + 1));
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
