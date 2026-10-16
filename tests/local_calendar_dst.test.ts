import { afterEach, describe, expect, it } from 'vitest';
import { getLocalDateString, shiftDateString } from '../src/lib/utils/date';

const originalTimeZone = process.env.TZ;

afterEach(() => {
  if (originalTimeZone === undefined) delete process.env.TZ;
  else process.env.TZ = originalTimeZone;
});

describe('calendar dates across DST changes', () => {
  it('resolves the correct Italian day across spring and autumn clock changes', () => {
    process.env.TZ = 'Europe/Rome';
    expect(getLocalDateString(new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
    expect(getLocalDateString(new Date('2026-03-29T01:30:00Z'))).toBe('2026-03-29');
    expect(getLocalDateString(new Date('2026-03-29T22:30:00Z'))).toBe('2026-03-30');
    expect(getLocalDateString(new Date('2026-10-25T00:30:00Z'))).toBe('2026-10-25');
    expect(getLocalDateString(new Date('2026-10-25T01:30:00Z'))).toBe('2026-10-25');
  });

  it('shifts business calendar dates rather than adding 24-hour intervals', () => {
    process.env.TZ = 'Europe/Rome';
    expect(shiftDateString('2026-03-28', 1)).toBe('2026-03-29');
    expect(shiftDateString('2026-03-29', 1)).toBe('2026-03-30');
    expect(shiftDateString('2026-10-24', 1)).toBe('2026-10-25');
    expect(shiftDateString('2026-10-25', 1)).toBe('2026-10-26');
    expect(shiftDateString('2026-10-26', -1)).toBe('2026-10-25');
  });

  it('does not confuse UTC with the local business date in negative offsets', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(getLocalDateString(new Date('2026-03-09T06:30:00Z'))).toBe('2026-03-08');
    expect(getLocalDateString(new Date('2026-03-09T07:30:00Z'))).toBe('2026-03-09');
    expect(shiftDateString('2026-11-01', 1)).toBe('2026-11-02');
  });
});
