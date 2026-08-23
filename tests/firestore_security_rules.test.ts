import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type { UserData } from '../src/types';

describe('Firestore Security Rules Whitelist & Parity Verification', () => {
  const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf-8');

  it('rules file exists and specifies rules_version = 2', () => {
    expect(fs.existsSync(rulesPath)).toBe(true);
    expect(rulesContent).toContain("rules_version = '2'");
    expect(rulesContent).toContain('service cloud.firestore');
  });

  it('contains global_catalog public read rule', () => {
    expect(rulesContent).toMatch(/match\s+\/global_catalog\/\{document=\*\*\}/);
    expect(rulesContent).toMatch(/allow\s+read:\s*if\s+true;/);
  });

  it('allows owner to delete on history_months and nutrition_months subcollections', () => {
    // Check history_months
    expect(rulesContent).toMatch(/match\s+\/history_months\/\{monthId\}/);
    expect(rulesContent).toMatch(/allow\s+read,\s*delete:\s*if\s+isOwner\(userId\);/);
    
    // Check nutrition_months
    expect(rulesContent).toMatch(/match\s+\/nutrition_months\/\{monthId\}/);
  });

  it('users/{userId} whitelist contains all root UserData payload keys including catalogOverrides', () => {
    // Extract whitelist array from firestore.rules
    const hasOnlyMatch = rulesContent.match(/incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
    expect(hasOnlyMatch).not.toBeNull();

    const rawKeys = hasOnlyMatch![1];
    const extractedKeys = rawKeys
      .split(',')
      .map(k => k.replace(/['"\s]/g, ''))
      .filter(Boolean);

    const expectedRootKeys: (keyof Omit<UserData, 'history' | 'nutrition'>)[] = [
      'profile',
      'library',
      'routines',
      'customFoods',
      'activeWorkout',
      'trainingCycles',
      'activeCycleId',
      'nutritionPlanning',
      'supplements',
      'activePains',
      'catalogOverrides'
    ];

    expect(extractedKeys).toEqual(expect.arrayContaining(expectedRootKeys));
    expect(extractedKeys).toContain('catalogOverrides');
    expect(extractedKeys.length).toBe(expectedRootKeys.length);
  });

  it('simulates security rules whitelist evaluation on valid userDocData', () => {
    const hasOnlyMatch = rulesContent.match(/incomingData\(\)\.keys\(\)\.hasOnly\(\[\s*([\s\S]*?)\s*\]\)/);
    const allowedKeys = new Set(
      hasOnlyMatch![1]
        .split(',')
        .map(k => k.replace(/['"\s]/g, ''))
        .filter(Boolean)
    );

    const sampleUserDocData = {
      profile: { name: 'Test User' },
      library: [{ id: 'ex1', name: 'Panca Piana' }],
      routines: [{ id: 'r1', name: 'Upper' }],
      customFoods: [{ id: 'cf1', name: 'Whey' }],
      activeWorkout: null,
      trainingCycles: [],
      activeCycleId: null,
      nutritionPlanning: null,
      supplements: [],
      activePains: [],
      catalogOverrides: {
        exercises: {},
        hiddenExerciseIds: ['ex_old'],
        foods: {},
        hiddenFoodIds: []
      }
    };

    const payloadKeys = Object.keys(sampleUserDocData);
    const isPayloadPermitted = payloadKeys.every(k => allowedKeys.has(k));
    expect(isPayloadPermitted).toBe(true);

    // Any unauthorized field should fail
    const invalidPayloadKeys = [...payloadKeys, 'unauthorizedField'];
    const isInvalidPermitted = invalidPayloadKeys.every(k => allowedKeys.has(k));
    expect(isInvalidPermitted).toBe(false);
  });
});
