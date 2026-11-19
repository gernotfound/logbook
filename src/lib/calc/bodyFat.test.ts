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
  it('rejects suffixes, partial decimals and unsupported numeric notations instead of estimating from prefixes', () => {
    const male = { height: 180, waist: 85, neck: 38 };
    for (const invalid of ['85cm', '85 kg', '85,5cm', '1e2', '0x55', '85.5.1', '85,', '', ' ']) {
      expect(calculateBodyFatByMethod('navy_male', { ...male, waist: invalid })).toBeNull();
      expect(calculateBodyFat(80, { gender: 'M', ...male, neck: invalid })).toBeNull();
    }
    expect(calculateBodyFatByMethod('navy_male', { ...male, height: '180cm' })).toBeNull();
    expect(calculateBodyFatByMethod('navy_female', {
      height: 165, waist: 70, neck: 34, hip: '95cm',
    })).toBeNull();
    expect(calculateBodyFat('80kg', { gender: 'M', ...male })).toBeNull();
    expect(calculateBodyFatByMethod('navy_male', { ...male, waist: {} })).toBeNull();
  });

  it('preserves finite decimal measurements including comma notation and both public entry points', () => {
    const male = { height: '180', waist: '85,5', neck: '38,2' };
    const expectedMale = calculateBodyFatByMethod('navy_male', { height: 180, waist: 85.5, neck: 38.2 });
    expect(expectedMale).not.toBeNull();
    expect(calculateBodyFatByMethod('navy_male', male)).toBe(expectedMale);
    expect(calculateBodyFat('80,5', { ...male, gender: 'M' })).toBe(expectedMale);

    const female = { height: 165, waist: '70,5', neck: 34, hip: '95,5' };
    const expectedFemale = calculateBodyFatByMethod('navy_female', {
      height: 165, waist: 70.5, neck: 34, hip: 95.5,
    });
    expect(expectedFemale).not.toBeNull();
    expect(calculateBodyFatByMethod('navy_female', female)).toBe(expectedFemale);
    expect(calculateBodyFat(65, { ...female, gender: 'F' })).toBe(expectedFemale);
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
