import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { useAppStore } from '../../src/store/useAppStore';
import {
  createMockUserData, defaultMockUserData,
  renderWithAuthenticatedTestOwner, renderWithProviders,
} from '../setup';

describe('shared UserData fixture factory', () => {
  it('does not leak nested mutations from one generated snapshot into another', () => {
    const first = createMockUserData();
    const second = createMockUserData();
    const untouched = structuredClone(second);
    if (!first.library || !first.history || !first.nutrition
      || !first.catalogOverrides?.hiddenFoodIds
      || !untouched.library || !untouched.history || !untouched.nutrition
      || !untouched.catalogOverrides?.hiddenFoodIds) {
      throw new Error('Expected full shared fixture defaults');
    }

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

  it.each([
    { label: 'authenticated test context', mount: renderWithAuthenticatedTestOwner },
    { label: 'legacy AuthProvider', mount: renderWithProviders },
  ])('gives each $label render independent default business objects', ({ mount }) => {
    const view = mount(createElement('div'));
    try {
      const installed = useAppStore.getState().userData;
      expect(installed).toEqual(defaultMockUserData);
      expect(installed).not.toBe(defaultMockUserData);
      expect(installed?.library).not.toBe(defaultMockUserData.library);
      expect(installed?.history?.[0]).not.toBe(defaultMockUserData.history?.[0]);
      expect(installed?.nutrition?.['2026-07-26']).not.toBe(defaultMockUserData.nutrition?.['2026-07-26']);
    } finally {
      view.unmount();
    }
  });

  it('preserves the explicit snapshot passed to an authenticated render fixture', () => {
    const provided = createMockUserData();
    const view = renderWithAuthenticatedTestOwner(createElement('div'), { userData: provided });
    try {
      expect(useAppStore.getState().userData).toBe(provided);
    } finally {
      view.unmount();
    }
  });
});
