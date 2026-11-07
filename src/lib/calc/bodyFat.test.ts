import { describe, expect, it } from 'vitest';
import {
  calculateBodyFat,
  calculateBodyFatByMethod,
  calculateBodyComposition,
  validateMeasurementData,
} from './bodyFat';

describe('body-fat numerical and calendar integrity', () => {
  const manual = (date: string, weight: unknown = '80') => validateMeasurementData({
    date, weight, method: 'manual', manualBf: '20',
  });

  it('accepts a genuine local calendar date, including leap day', () => {
    expect(manual('2024-02-29')).toMatchObject({
      isValid: true, bfPercentage: 20,
      cleanData: { date: '2024-02-29', weight: 80 },
    });
  });

  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-01-00', '2026-01-01T10:00:00Z'])(
    'rejects impossible or noncanonical business date %s', date => {
      expect(manual(date)).toMatchObject({ isValid: false, errors: { date: expect.any(String) } });
    },
  );

  it('does not accept non-finite weight or circumference input', () => {
    expect(manual('2026-11-07', 'Infinity')).toMatchObject({
      isValid: false, errors: { weight: expect.any(String) },
    });
    expect(validateMeasurementData({
      date: '2026-11-07', method: 'navy_male', weight: 80,
      height: 180, waist: 90, neck: Infinity,
    })).toMatchObject({ isValid: false, errors: { neck: expect.any(String) } });
  });

  it('does not return NaN or Infinity from derived calculations', () => {
    expect(calculateBodyFatByMethod('navy_male', { height: 180, waist: 90, neck: Infinity })).toBeNull();
    expect(calculateBodyFatByMethod('bmi', { weight: Infinity, height: 180, age: 30 })).toBeNull();
    expect(calculateBodyComposition(Infinity, 20)).toEqual({ fatMass: 0, leanMass: 0 });
    expect(calculateBodyFat('Infinity', { height: 180, gender: 'M', manualBf: 20 })).toBeNull();
  });

  it('keeps a valid zero manual percentage and finite measurement output', () => {
    expect(calculateBodyFat(80, { height: 180, manualBf: 0 })).toBe(0);
    expect(calculateBodyComposition(80, 20)).toEqual({ fatMass: 16, leanMass: 64 });
  });
});
