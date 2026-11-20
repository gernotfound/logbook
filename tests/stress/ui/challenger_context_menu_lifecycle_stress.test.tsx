import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu } from '../../../src/components/UI/ContextMenu';
import { createContextMenuStressItems } from './contextMenuStressFixtures';

describe('Empirical Adversarial Stress Suite: ContextMenu & Integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleItems = createContextMenuStressItems();

  describe('5. Multiple Open Menus (Single Active Menu Invariant)', () => {
    it('guarantees only one menu is open at a time across multiple rendered ContextMenus', () => {
      render(
        <div>
          <div data-testid="card-1">
            <ContextMenu items={[{ id: '1', label: 'Menu 1 Voce', onClick: vi.fn() }]} ariaLabel="Opzioni 1" />
          </div>
          <div data-testid="card-2">
            <ContextMenu items={[{ id: '2', label: 'Menu 2 Voce', onClick: vi.fn() }]} ariaLabel="Opzioni 2" />
          </div>
          <div data-testid="card-3">
            <ContextMenu items={[{ id: '3', label: 'Menu 3 Voce', onClick: vi.fn() }]} ariaLabel="Opzioni 3" />
          </div>
          <div data-testid="card-4">
            <ContextMenu items={[{ id: '4', label: 'Menu 4 Voce', onClick: vi.fn() }]} ariaLabel="Opzioni 4" />
          </div>
        </div>
      );

      const trigger1 = screen.getByRole('button', { name: 'Opzioni 1' });
      const trigger2 = screen.getByRole('button', { name: 'Opzioni 2' });
      const trigger3 = screen.getByRole('button', { name: 'Opzioni 3' });
      const trigger4 = screen.getByRole('button', { name: 'Opzioni 4' });

      // Open Menu 1
      fireEvent.click(trigger1);
      expect(screen.getAllByRole('menu').length).toBe(1);
      expect(screen.getByText('Menu 1 Voce')).not.toBeNull();

      // Click Trigger 2: Menu 1 should close, Menu 2 should open
      fireEvent.mouseDown(trigger2); // Triggers outside click on Menu 1
      fireEvent.click(trigger2);
      expect(screen.getAllByRole('menu').length).toBe(1);
      expect(screen.getByText('Menu 2 Voce')).not.toBeNull();
      expect(screen.queryByText('Menu 1 Voce')).toBeNull();

      // Click Trigger 3: Menu 2 should close, Menu 3 should open
      fireEvent.mouseDown(trigger3);
      fireEvent.click(trigger3);
      expect(screen.getAllByRole('menu').length).toBe(1);
      expect(screen.getByText('Menu 3 Voce')).not.toBeNull();
      expect(screen.queryByText('Menu 2 Voce')).toBeNull();

      // Click outside: Menu 3 should close
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('menu')).toBeNull();

      // Rapidly cycling triggers
      const triggers = [trigger1, trigger2, trigger3, trigger4];
      for (let i = 0; i < 20; i++) {
        const nextTrig = triggers[i % 4];
        fireEvent.mouseDown(nextTrig);
        fireEvent.click(nextTrig);
        const openMenus = screen.getAllByRole('menu');
        expect(openMenus.length).toBe(1);
      }

      // Close final
      fireEvent.mouseDown(document.body);
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  it('keeps a single active menu when switching cards using only the keyboard', () => {
    vi.useFakeTimers();
    try {
      render(
        <div>
          <ContextMenu ariaLabel="Opzioni A" items={[{ label: 'Azione A', onClick: vi.fn() }]} />
          <ContextMenu ariaLabel="Opzioni B" items={[{ label: 'Azione B', onClick: vi.fn() }]} />
        </div>,
      );
      const a = screen.getByRole('button', { name: 'Opzioni A' });
      const b = screen.getByRole('button', { name: 'Opzioni B' });
      a.focus();
      fireEvent.keyDown(a, { key: 'Enter' });
      vi.runAllTimers();
      expect(screen.getByRole('menu', { name: 'Opzioni A' })).not.toBeNull();
      b.focus();
      fireEvent.keyDown(b, { key: 'ArrowDown' });
      vi.runAllTimers();
      expect(screen.queryByRole('menu', { name: 'Opzioni A' })).toBeNull();
      expect(a.getAttribute('aria-expanded')).toBe('false');
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Azione B' }));
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(document.activeElement).toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('6. A11y & Italian Sentence Case Conformance', () => {
    it('has accessible roles, labels, and aria attributes', () => {
      render(<ContextMenu items={sampleItems} ariaLabel="Opzioni scheda" triggerTitle="Menu azioni" />);

      const trigger = screen.getByRole('button', { name: 'Opzioni scheda' });
      expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger.getAttribute('aria-expanded')).toBe('false');

      fireEvent.click(trigger);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');

      const menu = screen.getByRole('menu', { name: 'Opzioni scheda' });
      expect(menu).not.toBeNull();

      const items = screen.getAllByRole('menuitem');
      expect(items.length).toBe(3);
      items.forEach(item => {
        expect(item.getAttribute('type')).toBe('button');
      });
    });
  });

  describe('7. Lifecycle Races & Touch Stress', () => {
    it('does not run stale keyboard focus after closing and reopening with a pointer', () => {
      vi.useFakeTimers();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        render(<ContextMenu items={sampleItems} />);
        const trigger = screen.getByRole('button', { name: 'Opzioni' });
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(screen.getByRole('menuitem', { name: 'Modifica scheda' })).toBe(document.activeElement);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).not.toBeNull();
        outside.focus();
        vi.runAllTimers();
        expect(document.activeElement).toBe(outside);
      } finally {
        outside.remove();
        vi.useRealTimers();
      }
    });

    it('does not focus a detached menu after immediate unmount', () => {
      vi.useFakeTimers();
      const outside = document.createElement('button');
      document.body.appendChild(outside);
      try {
        for (let i = 0; i < 10; i++) {
          const { unmount } = render(<ContextMenu items={sampleItems} />);
          const trigger = screen.getByRole('button', { name: 'Opzioni' });
          fireEvent.keyDown(trigger, { key: 'ArrowDown' });
          expect(screen.getByRole('menu')).not.toBeNull();
          unmount();
          outside.focus();
          vi.runAllTimers();
          expect(document.activeElement).toBe(outside);
          expect(screen.queryByRole('menu')).toBeNull();
        }
      } finally {
        outside.remove();
        vi.useRealTimers();
      }
    });

    it('handles mobile touch interaction cycles with outside taps', () => {
      render(
        <div>
          <div data-testid="touch-outside">Outside Touch Area</div>
          <ContextMenu items={sampleItems} />
        </div>
      );

      const trigger = screen.getByRole('button', { name: 'Opzioni' });

      for (let i = 0; i < 10; i++) {
        // Open with click
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).not.toBeNull();

        // Tap outside
        fireEvent.touchStart(screen.getByTestId('touch-outside'));
        expect(screen.queryByRole('menu')).toBeNull();
      }
    });

    it('handles rapid 50-cycle ArrowDown and ArrowUp wraps without focus loss', () => {
      render(<ContextMenu items={sampleItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menu = screen.getByRole('menu');
      const items = screen.getAllByRole('menuitem');

      for (let i = 0; i < 50; i++) {
        fireEvent.keyDown(menu, { key: 'ArrowDown' });
      }
      // 50 mod 3 = 2 -> item 2
      expect(document.activeElement).toBe(items[1]); // (50 % 3 = 2 -> 0-indexed is 1 since starting from -1: -1 + 50 = 49 % 3 = 1)

      for (let i = 0; i < 50; i++) {
        fireEvent.keyDown(menu, { key: 'ArrowUp' });
      }
      // 1 - 50 = -49 -> (-49 % 3 + 3) % 3 = 2 -> item 2
      expect(document.activeElement).toBe(items[2]);
    });
  });
});
