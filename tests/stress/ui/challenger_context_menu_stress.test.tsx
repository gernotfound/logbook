import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, type ContextMenuItem } from '../../../src/components/UI/ContextMenu';
import { createContextMenuStressItems } from './contextMenuStressFixtures';

describe('Empirical Adversarial Stress Suite: ContextMenu & Integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleItems: ContextMenuItem[] = createContextMenuStressItems();

  describe('1. Rapid Menu Open/Close Toggling', () => {
    it('handles 100 rapid sequential trigger clicks without state desynchronization or crashes', () => {
      const onOpenChange = vi.fn();
      render(<ContextMenu items={sampleItems} onOpenChange={onOpenChange} />);

      const trigger = screen.getByRole('button', { name: 'Opzioni' });

      // 100 rapid clicks
      for (let i = 1; i <= 100; i++) {
        fireEvent.click(trigger);
        const expectedOpen = i % 2 === 1;
        expect(trigger.getAttribute('aria-expanded')).toBe(expectedOpen ? 'true' : 'false');
        if (expectedOpen) {
          expect(screen.getByRole('menu')).not.toBeNull();
        } else {
          expect(screen.queryByRole('menu')).toBeNull();
        }
      }

      expect(onOpenChange).toHaveBeenCalledTimes(100);
      // Final state after even number of clicks must be closed
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('handles interleaved rapid keyboard and mouse toggle events', () => {
      const { container } = render(<ContextMenu items={sampleItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });

      // Repeat rapid sequence: Enter -> Escape -> Space -> Escape -> Click -> Escape -> ArrowDown -> Escape
      for (let cycle = 0; cycle < 15; cycle++) {
        // Open with Enter
        fireEvent.keyDown(trigger, { key: 'Enter' });
        expect(screen.getByRole('menu')).not.toBeNull();

        // Close with Escape
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();

        // Open with Space
        fireEvent.keyDown(trigger, { key: ' ' });
        expect(screen.getByRole('menu')).not.toBeNull();

        // Close with Escape
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();

        // Open with Click
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).not.toBeNull();

        // Close with Escape
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();

        // Open with ArrowDown
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        expect(screen.getByRole('menu')).not.toBeNull();

        // Close with Escape
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('menu')).toBeNull();
      }

      expect(screen.queryByRole('menu')).toBeNull();
      expect(container).not.toBeNull();
    });

    it('unmounts and remounts an open menu without leaving DOM nodes or throwing on later events', () => {
      for (let i = 0; i < 20; i++) {
        const { unmount } = render(<ContextMenu items={sampleItems} />);
        const trigger = screen.getByRole('button', { name: 'Opzioni' });
        fireEvent.click(trigger);
        expect(screen.getByRole('menu')).not.toBeNull();
        // Unmount while open
        unmount();
        expect(screen.queryByRole('menu')).toBeNull();
        // Fire outside events after unmount - should not throw
        fireEvent.mouseDown(document.body);
        fireEvent.keyDown(document, { key: 'Escape' });
      }
    });

    it('survives dynamic items mutation while dropdown is open', () => {
      const initialItems: ContextMenuItem[] = [
        { id: '1', label: 'Opzione 1', onClick: vi.fn() },
        { id: '2', label: 'Opzione 2', onClick: vi.fn() },
      ];

      const { rerender } = render(<ContextMenu items={initialItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      expect(screen.getAllByRole('menuitem').length).toBe(2);

      // Dynamically add items while open
      const expandedItems: ContextMenuItem[] = [
        { id: '1', label: 'Opzione 1', onClick: vi.fn() },
        { id: '2', label: 'Opzione 2', onClick: vi.fn() },
        { id: '3', label: 'Opzione 3', onClick: vi.fn() },
        { id: '4', label: 'Opzione 4 (nascosta)', onClick: vi.fn(), hidden: true },
      ];
      rerender(<ContextMenu items={expandedItems} />);
      expect(screen.getAllByRole('menuitem').length).toBe(3);

      // Dynamically hide all items while open
      const allHiddenItems: ContextMenuItem[] = [
        { id: '1', label: 'Opzione 1', onClick: vi.fn(), hidden: true },
        { id: '2', label: 'Opzione 2', onClick: vi.fn(), hidden: true },
      ];
      rerender(<ContextMenu items={allHiddenItems} />);
      // All hidden actions must be absent from the rendered menu.
      expect(screen.queryByRole('menu')).toBeNull();

      rerender(<ContextMenu items={initialItems} />);
      const restoredTrigger = screen.getByRole('button', { name: 'Opzioni' });
      expect(restoredTrigger.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByRole('menu')).toBeNull();
      fireEvent.click(restoredTrigger);
      expect(screen.getAllByRole('menuitem')).toHaveLength(2);
    });
  });

  describe('3. Outside Click & Touch Dismissal Handling', () => {
    it('closes menu when clicking anywhere on document via mousedown', () => {
      render(
        <div>
          <div data-testid="outside-area">Area Esterna</div>
          <ContextMenu items={sampleItems} />
        </div>
      );

      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).not.toBeNull();

      fireEvent.mouseDown(screen.getByTestId('outside-area'));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('closes menu when tapping outside via touchstart', () => {
      render(
        <div>
          <div data-testid="outside-mobile">Area Mobile</div>
          <ContextMenu items={sampleItems} />
        </div>
      );

      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).not.toBeNull();

      fireEvent.touchStart(screen.getByTestId('outside-mobile'));
      expect(screen.queryByRole('menu')).toBeNull();
    });

    it('does NOT close menu when clicking inside the dropdown menu (e.g. empty background or padding)', () => {
      render(<ContextMenu items={sampleItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menu = screen.getByRole('menu');
      fireEvent.click(menu);
      expect(screen.getByRole('menu')).not.toBeNull();
    });

    it('does NOT close menu when clicking a disabled menu item', () => {
      const disabledItems: ContextMenuItem[] = [
        { id: '1', label: 'Voce disabilitata', disabled: true, onClick: vi.fn() },
      ];

      render(<ContextMenu items={disabledItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const disabledBtn = screen.getByRole('menuitem', { name: /Voce disabilitata/i });
      fireEvent.click(disabledBtn);

      // Menu must remain open
      expect(screen.getByRole('menu')).not.toBeNull();
    });
  });

  describe('4. Keyboard Interaction Stress Suite', () => {
    it('stress tests rapid Escape key presses (open and closed states)', () => {
      render(<ContextMenu items={sampleItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });

      // Pressing Escape while closed does nothing and does not throw
      for (let i = 0; i < 10; i++) {
        expect(() => fireEvent.keyDown(document, { key: 'Escape' })).not.toThrow();
        expect(screen.queryByRole('menu')).toBeNull();
      }

      // Open, press Escape x 10, verify focus returns to trigger
      fireEvent.click(trigger);
      expect(screen.getByRole('menu')).not.toBeNull();

      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('menu')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('navigates with ArrowDown and ArrowUp, skipping disabled items properly', () => {
      const mixedItems: ContextMenuItem[] = [
        { id: '1', label: 'Item 1', onClick: vi.fn() },
        { id: '2', label: 'Item 2 (Disabilitato)', disabled: true, onClick: vi.fn() },
        { id: '3', label: 'Item 3', onClick: vi.fn() },
        { id: '4', label: 'Item 4 (Disabilitato)', disabled: true, onClick: vi.fn() },
        { id: '5', label: 'Item 5', onClick: vi.fn() },
      ];

      render(<ContextMenu items={mixedItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menu = screen.getByRole('menu');
      const allButtons = screen.getAllByRole('menuitem');
      const enabledButtons = allButtons.filter(b => !(b as HTMLButtonElement).disabled);
      expect(enabledButtons.length).toBe(3); // Item 1, Item 3, Item 5

      // ArrowDown focuses first enabled item (Item 1)
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(enabledButtons[0]);

      // ArrowDown focuses second enabled item (Item 3, skipping disabled Item 2)
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(enabledButtons[1]);

      // ArrowDown focuses third enabled item (Item 5, skipping disabled Item 4)
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(enabledButtons[2]);

      // ArrowDown wraps around to Item 1
      fireEvent.keyDown(menu, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(enabledButtons[0]);

      // ArrowUp wraps back to Item 5
      fireEvent.keyDown(menu, { key: 'ArrowUp' });
      expect(document.activeElement).toBe(enabledButtons[2]);

      // Home focuses Item 1
      fireEvent.keyDown(menu, { key: 'Home' });
      expect(document.activeElement).toBe(enabledButtons[0]);

      // End focuses Item 5
      fireEvent.keyDown(menu, { key: 'End' });
      expect(document.activeElement).toBe(enabledButtons[2]);
    });

    it('safely handles key navigation when ALL items are disabled without throwing or infinite loop', () => {
      const allDisabledItems: ContextMenuItem[] = [
        { id: '1', label: 'Item 1', disabled: true, onClick: vi.fn() },
        { id: '2', label: 'Item 2', disabled: true, onClick: vi.fn() },
      ];

      render(<ContextMenu items={allDisabledItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menu = screen.getByRole('menu');

      // Key navigation commands should safely do nothing
      expect(() => fireEvent.keyDown(menu, { key: 'ArrowDown' })).not.toThrow();
      expect(() => fireEvent.keyDown(menu, { key: 'ArrowUp' })).not.toThrow();
      expect(() => fireEvent.keyDown(menu, { key: 'Home' })).not.toThrow();
      expect(() => fireEvent.keyDown(menu, { key: 'End' })).not.toThrow();
    });

    it('closes menu when pressing Tab inside menu', () => {
      render(<ContextMenu items={sampleItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menu = screen.getByRole('menu');
      expect(menu).not.toBeNull();

      fireEvent.keyDown(menu, { key: 'Tab' });
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });


});
