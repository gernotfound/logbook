import { beforeEach, afterEach, describe, test, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';
import { useAppStore } from '../../src/store/useAppStore';
import App from '../../src/App';
import { setupPwaIndexeddbTest, teardownPwaIndexeddbTest } from './pwaIndexeddbTestFixture';

describe('PWA beforeunload guard', () => {
  beforeEach(setupPwaIndexeddbTest);
  afterEach(teardownPwaIndexeddbTest);

  describe('R3: Sync Lock (beforeunload Event Listener)', () => {
    test('beforeunload listener prevents leaving the page while syncing is true', () => {
      // Set syncing to true
      useAppStore.getState().setSyncing(true);

      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      // Render App to attach beforeunload listener
      const { unmount } = render(<App />);

      window.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);

      unmount();
    });

    test('beforeunload listener does NOT prevent default when syncing is false', () => {
      // Set syncing to false
      useAppStore.getState().setSyncing(false);

      const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

      const { unmount } = render(<App />);

      window.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);

      unmount();
    });
  });
});
