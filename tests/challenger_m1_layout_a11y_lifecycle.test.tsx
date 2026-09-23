import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act } from '@testing-library/react';
import App from '../src/App';
import { renderWithProviders, defaultMockUserData } from './setup';
import { useAppStore } from '../src/store/useAppStore';
import { clearSyncTimers } from '../src/store/slices/createSyncSlice';
import { DB } from '../src/lib/db';
import * as fs from 'fs';
import * as path from 'path';

const readGlobalStyles = () => {
  const stylesDir = path.resolve(__dirname, '../src/styles');
  const globalCss = fs.readFileSync(path.join(stylesDir, 'global.css'), 'utf-8');
  const importedFiles = [...globalCss.matchAll(/@import '\.\/([^']+\.css)'/g)].map((match) => match[1]);
  return [globalCss, ...importedFiles.map((file) => fs.readFileSync(path.join(stylesDir, file), 'utf-8'))].join('\n');
};

describe('Empirical Challenger: Layout Geometry, Accessibility, Z-Index & Online Lifecycle', () => {

  beforeEach(() => {
    vi.useFakeTimers();
    clearSyncTimers();
    vi.mocked(DB.saveUserData).mockReset();
    vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
    useAppStore.setState({
      userData: { ...defaultMockUserData },
      localWorkout: null,
      syncing: false,
      saveError: null,
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      clearSyncTimers();
      useAppStore.getState().resetStore();
    });
    vi.mocked(DB.saveUserData).mockReset();
    vi.mocked(DB.saveUserData).mockResolvedValue({ ok: true, status: 'synced' });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderSettledApp = async () => {
    const result = renderWithProviders(<App />);
    await act(async () => {
      await Promise.resolve();
    });
    return result;
  };

  // ============================================================================
  // 1. DOM ISOLATION & CLICK INTERACTION
  // ============================================================================
  describe('DOM Isolation & Click Non-Blocking Verification', () => {
    it('verifies .sync-indicator has pointer-events: none in CSS', () => {
      const cssContent = readGlobalStyles();

      // Extract .sync-indicator block
      const indicatorBlockMatch = cssContent.match(/\.sync-indicator\s*\{([^}]+)\}/);
      expect(indicatorBlockMatch).not.toBeNull();
      const indicatorBlock = indicatorBlockMatch![1];

      expect(indicatorBlock).toMatch(/pointer-events:\s*none/);
    });

    it('verifies #sync-overlay is completely absent from CSS and App markup', async () => {
      const cssContent = readGlobalStyles();
      expect(cssContent).not.toMatch(/#sync-overlay/);

      const appPath = path.resolve(__dirname, '../src/App.tsx');
      const appContent = fs.readFileSync(appPath, 'utf-8');
      expect(appContent).not.toMatch(/id=["']sync-overlay["']/);

      const { container } = await renderSettledApp();
      act(() => {
        useAppStore.setState({ syncing: true });
      });
      expect(container.querySelector('#sync-overlay')).toBeNull();
      expect(document.getElementById('sync-overlay')).toBeNull();
    });

    it('allows clicks on interactive buttons when syncing is actively true', async () => {
      const { container } = await renderSettledApp();
      
      act(() => {
        useAppStore.setState({ syncing: true });
      });

      // Bottom nav button click verification
      const trainingTabBtn = screen.getByRole('button', { name: /Allenamento/i });
      expect(trainingTabBtn).not.toBeNull();

      act(() => {
        fireEvent.click(trainingTabBtn);
      });

      // Navigating does not throw and sync indicator stays rendered
      const indicator = container.querySelector('.sync-indicator');
      expect(indicator).not.toBeNull();
    });
  });

  // ============================================================================
  // 2. Z-INDEX STACKING HIERARCHY
  // ============================================================================
  describe('Z-Index Stacking Hierarchy: sync-indicator < sync-error-toast < BottomNav < GlobalDialog', () => {
    it('verifies exact z-index values in CSS and component definitions', () => {
      const cssContent = readGlobalStyles();

      // 1. .sync-indicator z-index (9990)
      const indicatorMatch = cssContent.match(/\.sync-indicator\s*\{[^}]*z-index:\s*(\d+)/);
      expect(indicatorMatch).not.toBeNull();
      const zSyncIndicator = parseInt(indicatorMatch![1], 10);
      expect(zSyncIndicator).toBe(9990);

      // 2. .sync-error-toast z-index (9995)
      const toastMatch = cssContent.match(/\.sync-error-toast\s*\{[^}]*z-index:\s*(\d+)/);
      expect(toastMatch).not.toBeNull();
      const zErrorToast = parseInt(toastMatch![1], 10);
      expect(zErrorToast).toBe(9995);

      // 3. .bottom-nav z-index (10000)
      const navMatch = cssContent.match(/\.bottom-nav\s*\{[^}]*z-index:\s*(\d+)/);
      expect(navMatch).not.toBeNull();
      const zBottomNav = parseInt(navMatch![1], 10);
      expect(zBottomNav).toBe(10000);

      // 4. GlobalDialog z-index (99999)
      const dialogPath = path.resolve(__dirname, '../src/components/UI/GlobalDialog.tsx');
      const dialogContent = fs.readFileSync(dialogPath, 'utf-8');
      const dialogMatch = dialogContent.match(/zIndex:\s*(\d+)/);
      expect(dialogMatch).not.toBeNull();
      const zGlobalDialog = parseInt(dialogMatch![1], 10);
      expect(zGlobalDialog).toBe(99999);

      // Hierarchy assertion
      expect(zSyncIndicator).toBeLessThan(zErrorToast);
      expect(zErrorToast).toBeLessThan(zBottomNav);
      expect(zBottomNav).toBeLessThan(zGlobalDialog);
    });
  });

  // ============================================================================
  // 3. ACCESSIBILITY (ARIA ROLES, LIVE REGIONS & LABELS)
  // ============================================================================
  describe('Accessibility (A11y) & ARIA Compliance', () => {
    it('verifies .sync-indicator has role="status", aria-live="polite" and aria-label', async () => {
      const { container } = await renderSettledApp();
      act(() => {
        useAppStore.setState({ syncing: true });
      });

      const indicator = container.querySelector('.sync-indicator');
      expect(indicator).not.toBeNull();
      expect(indicator?.getAttribute('role')).toBe('status');
      expect(indicator?.getAttribute('aria-live')).toBe('polite');
      expect(indicator?.getAttribute('aria-label')).toBe('Salvataggio in corso');
      expect(indicator?.textContent).toContain('Salvataggio in corso...');
    });

    it('verifies .sync-error-toast has role="alert", aria-live="assertive" and accessible close button', async () => {
      const { container } = await renderSettledApp();
      act(() => {
        useAppStore.setState({ saveError: 'Errore durante il salvataggio su cloud' });
      });

      const toast = container.querySelector('.sync-error-toast');
      expect(toast).not.toBeNull();
      expect(toast?.getAttribute('role')).toBe('alert');
      expect(toast?.getAttribute('aria-live')).toBe('assertive');

      const icon = toast?.querySelector('.sync-error-icon');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');

      const closeBtn = toast?.querySelector('.sync-error-close') as HTMLButtonElement;
      expect(closeBtn).not.toBeNull();
      expect(closeBtn.getAttribute('type')).toBe('button');
      expect(closeBtn.getAttribute('aria-label')).toBe('Chiudi avviso');
    });
  });

  // ============================================================================
  // 4. OFFLINE / ONLINE EVENT LIFECYCLE & AUTO-DISMISSAL
  // ============================================================================
  describe('Offline/Online Event Lifecycle & Auto-Dismissal', () => {
    it('clears saveError immediately when browser fires "online" event', async () => {
      const { container } = await renderSettledApp();
      
      act(() => {
        useAppStore.setState({ saveError: 'Connessione assente durante il salvataggio' });
      });
      expect(useAppStore.getState().saveError).toBe('Connessione assente durante il salvataggio');
      expect(container.querySelector('.sync-error-toast')).not.toBeNull();

      // Trigger browser online event
      act(() => {
        window.dispatchEvent(new Event('online'));
      });

      // Immediately cleared without waiting for 5s timer
      expect(useAppStore.getState().saveError).toBeNull();
      expect(container.querySelector('.sync-error-toast')).toBeNull();
    });

    it('auto-dismisses save error toast after exactly 5000ms timer', async () => {
      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({ saveError: 'Errore temporaneo' });
      });
      expect(container.querySelector('.sync-error-toast')).not.toBeNull();

      // Advance timer by 4900ms - still present
      act(() => {
        vi.advanceTimersByTime(4900);
      });
      expect(useAppStore.getState().saveError).toBe('Errore temporaneo');
      expect(container.querySelector('.sync-error-toast')).not.toBeNull();

      // Advance remaining 100ms - dismissed
      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(useAppStore.getState().saveError).toBeNull();
      expect(container.querySelector('.sync-error-toast')).toBeNull();
    });

    it('resets the 5000ms timer if a new saveError arrives before dismissal', async () => {
      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({ saveError: 'Primo errore' });
      });
      expect(screen.getByText('Primo errore')).toBeDefined();

      // Advance by 3000ms
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      // Update with new error
      act(() => {
        useAppStore.setState({ saveError: 'Secondo errore' });
      });
      expect(screen.getByText('Secondo errore')).toBeDefined();

      // Advance another 3000ms (total 6000ms from start, but only 3000ms for second error)
      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(useAppStore.getState().saveError).toBe('Secondo errore');
      expect(container.querySelector('.sync-error-toast')).not.toBeNull();

      // Advance remaining 2000ms
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(useAppStore.getState().saveError).toBeNull();
      expect(container.querySelector('.sync-error-toast')).toBeNull();
    });

    it('dismisses toast immediately on manual close button click', async () => {
      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({ saveError: 'Errore chiudibile manualmente' });
      });
      expect(container.querySelector('.sync-error-toast')).not.toBeNull();

      const closeBtn = container.querySelector('.sync-error-close') as HTMLButtonElement;
      act(() => {
        fireEvent.click(closeBtn);
      });

      expect(useAppStore.getState().saveError).toBeNull();
      expect(container.querySelector('.sync-error-toast')).toBeNull();
    });

    it('handles multiple rapid online/offline/error transitions without unhandled rejections or crashes', async () => {
      await renderSettledApp();

      for (let i = 0; i < 20; i++) {
        act(() => {
          useAppStore.setState({ syncing: i % 2 === 0, saveError: i % 3 === 0 ? `Errore transitorio #${i}` : null });
          window.dispatchEvent(new Event(i % 2 === 0 ? 'online' : 'offline'));
        });
      }

      // Cleanup
      act(() => {
        useAppStore.setState({ syncing: false, saveError: null });
        vi.advanceTimersByTime(5000);
      });
      expect(useAppStore.getState().syncing).toBe(false);
      expect(useAppStore.getState().saveError).toBeNull();
    });
  });

  // ============================================================================
  // 5. LAYOUT GEOMETRY & RESPONSIVE DESIGN CSS VALIDATION
  // ============================================================================
  describe('Layout Geometry & Dark Glassmorphism CSS Conformance', () => {
    it('verifies safe-area-inset and bottom positioning above bottom-nav', () => {
      const cssContent = readGlobalStyles();
      const tokensCss = fs.readFileSync(path.resolve(__dirname, '../src/styles/tokens.css'), 'utf-8');
      const navBlock = cssContent.match(/\.bottom-nav\s*\{([^}]+)\}/)![1];

      expect(tokensCss).toMatch(/--nav-height:\s*3\.25rem/);
      expect(navBlock).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);

      // .sync-indicator positioning
      const indicatorBlock = cssContent.match(/\.sync-indicator\s*\{([^}]+)\}/)![1];
      expect(indicatorBlock).toMatch(/position:\s*fixed/);
      expect(indicatorBlock).toMatch(/bottom:\s*calc\(var\(--nav-height\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*0\.5rem\)/);
      expect(indicatorBlock).toMatch(/right:\s*max\(1rem,\s*env\(safe-area-inset-right,\s*0px\)\)/);
      expect(indicatorBlock).toMatch(/border-radius:\s*999px/);

      // .sync-error-toast positioning & styling
      const toastBlock = cssContent.match(/\.sync-error-toast\s*\{([^}]+)\}/)![1];
      expect(toastBlock).toMatch(/position:\s*fixed/);
      expect(toastBlock).toMatch(/bottom:\s*calc\(var\(--nav-height\)\s*\+\s*env\(safe-area-inset-bottom,\s*0px\)\s*\+\s*0\.5rem\)/);
      expect(toastBlock).toMatch(/max-width:\s*30rem/);
      expect(toastBlock).toMatch(/background:\s*var\(--danger-soft\)/);
      expect(toastBlock).toMatch(/border:\s*1px\s+solid\s+var\(--danger-color\)/);
    });

    it('verifies Italian sentence case in App and store notifications', async () => {
      const { container } = await renderSettledApp();

      act(() => {
        useAppStore.setState({ syncing: true });
      });

      const indicatorText = container.querySelector('.sync-indicator')?.textContent;
      expect(indicatorText).toBe('Salvataggio in corso...');
      // Ensure only first letter is capitalized: 'Salvataggio in corso...'
      const words = indicatorText!.replace('...', '').split(' ');
      expect(words[0]).toBe('Salvataggio');
      expect(words[1]).toBe('in');
      expect(words[2]).toBe('corso');
    });
  });

});
