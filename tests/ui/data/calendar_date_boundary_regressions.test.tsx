import { describe, test, expect, beforeEach } from 'vitest';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { Logic } from '../../../src/lib/logic';

describe('Calendar date and midnight boundaries', () => {
  beforeEach(async () => { await prepareUnlockedTestArchive(); });

    test('Logic.getLocalDateString correctly formats midnight boundaries', () => {
      const midnight1 = new Date(2026, 6, 26, 0, 0, 0);
      const dateStr1 = Logic.getLocalDateString(midnight1);
      expect(dateStr1).toBe('2026-07-26');

      const endOfDay = new Date(2026, 6, 26, 23, 59, 59, 999);
      const dateStr2 = Logic.getLocalDateString(endOfDay);
      expect(dateStr2).toBe('2026-07-26');

      const dec31 = new Date(2026, 11, 31, 23, 59, 59);
      expect(Logic.getLocalDateString(dec31)).toBe('2026-12-31');

      const jan1 = new Date(2027, 0, 1, 0, 0, 0);
      expect(Logic.getLocalDateString(jan1)).toBe('2027-01-01');

      const leapFeb = new Date(2028, 1, 29);
      expect(Logic.getLocalDateString(leapFeb)).toBe('2028-02-29');
    });

    test('Logic.getCalendarMonthGrid generates correct days for month transitions', () => {
      const gridDec = Logic.getCalendarMonthGrid(2026, 11); // December 2026
      expect(gridDec.length).toBeGreaterThanOrEqual(35);
      expect(gridDec.some(cell => cell.dateStr === '2026-12-31')).toBe(true);

      const gridJan = Logic.getCalendarMonthGrid(2027, 0); // January 2027
      expect(gridJan.some(cell => cell.dateStr === '2027-01-01')).toBe(true);
    });
});
