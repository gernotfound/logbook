import { describe, expect, it } from 'vitest';
import { calculateBodyFat, calculateBodyFatByMethod } from './bodyFat';

describe('current US Navy body-fat calculations', () => {
  it('rejects non-finite or impossible circumference measurements', () => {
    expect(calculateBodyFatByMethod('navy_male', { height: 180, waist: 90, neck: Infinity })).toBeNull();
    expect(calculateBodyFatByMethod('navy_male', { height: 180, waist: 40, neck: 40 })).toBeNull();
    expect(calculateBodyFatByMethod('navy_female', { height: 165, waist: 70, neck: 34 })).toBeNull();
    expect(calculateBodyFatByMethod('navy_female', { height: 165, waist: 70, neck: 34, hip: Infinity })).toBeNull();
  });

  it('does not return a body-fat percentage from an invalid weight or incomplete profile', () => {
    expect(calculateBodyFat('Infinity', { height: 180, gender: 'M', waist: 85, neck: 38 })).toBeNull();
    expect(calculateBodyFat(80, { height: 180, gender: 'M', waist: 85 })).toBeNull();
  });
  it('does not resurrect retired manual or BMI body-fat modes', () => {
    expect(calculateBodyFatByMethod('manual', { bfPercentage: 20 })).toBeNull();
    expect(calculateBodyFatByMethod('bmi', { weight: 80, height: 180, age: 30 })).toBeNull();
    expect(calculateBodyFat(80, { height: 180, gender: 'M', manualBf: 20 })).toBeNull();
  });

  it('uses the current Navy inputs even if a retired profile percentage is present', () => {
    expect(calculateBodyFat(80, {
      gender: 'M', height: 180, waist: 85, neck: 38, manualBf: 99,
    })).toBe(16.1);
  });

});
