import { describe, expect, it } from 'vitest';
import { createMockUserData } from '../setup';

describe('shared UserData fixture factory', () => {
  it('does not leak nested mutations from one generated snapshot into another', () => {
    const first = createMockUserData();
    const second = createMockUserData();
    const untouched = structuredClone(second);

    try {
      first.library[0].name = 'first fixture only';
      first.history[0].routineName = 'first fixture only';
      first.nutrition['2026-07-26'].weight = 999;
      first.catalogOverrides.hiddenFoodIds.push('first-fixture-only');

      expect(second).toEqual(untouched);
    } finally {
      // Restore the global defaults even when run against the broken factory.
      // The regression must not poison other tests in the same worker.
      first.library[0].name = untouched.library[0].name;
      first.history[0].routineName = untouched.history[0].routineName;
      first.nutrition['2026-07-26'].weight = untouched.nutrition['2026-07-26'].weight;
      first.catalogOverrides.hiddenFoodIds.pop();
    }
  });
});
