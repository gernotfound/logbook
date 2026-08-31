import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, ContextMenuItem } from '../src/components/UI/ContextMenu';
import { Pencil, Trash2, Copy } from 'lucide-react';

describe('ContextMenu Component (Milestone M1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleItems: ContextMenuItem[] = [
    {
      id: 'edit',
      label: 'Modifica scheda',
      icon: Pencil,
      onClick: vi.fn(),
    },
    {
      id: 'duplicate',
      label: 'Duplica scheda',
      icon: <Copy size={16} data-testid="copy-icon" />,
      onClick: vi.fn(),
    },
    {
      id: 'delete',
      label: 'Elimina scheda',
      icon: Trash2,
      variant: 'danger',
      onClick: vi.fn(),
    },
  ];

  it('renders closed by default with accessible trigger button', () => {
    render(<ContextMenu items={sampleItems} />);

    const trigger = screen.getByRole('button', { name: 'Opzioni' }) as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('title')).toBe('Opzioni');

    // Dropdown menu should not be rendered
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('renders null when items array is empty', () => {
    const { container } = render(<ContextMenu items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders null when all items are hidden', () => {
    const hiddenItems: ContextMenuItem[] = [
      { id: '1', label: 'Voce 1', onClick: vi.fn(), hidden: true },
      { id: '2', label: 'Voce 2', onClick: vi.fn(), hidden: true },
    ];
    const { container } = render(<ContextMenu items={hiddenItems} />);
    expect(container.firstChild).toBeNull();
  });

  it('opens and closes dropdown on trigger button click', () => {
    const onOpenChange = vi.fn();
    render(<ContextMenu items={sampleItems} onOpenChange={onOpenChange} />);

    const trigger = screen.getByRole('button', { name: 'Opzioni' }) as HTMLButtonElement;

    // Open menu
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).not.toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(true);

    // Verify visible menu items
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBe(3);
    expect(menuItems[0].textContent).toContain('Modifica scheda');
    expect(menuItems[1].textContent).toContain('Duplica scheda');
    expect(menuItems[2].textContent).toContain('Elimina scheda');

    // Close menu by clicking trigger again
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('supports custom ariaLabel, triggerTitle, triggerClassName, and className', () => {
    render(
      <ContextMenu
        items={sampleItems}
        ariaLabel="Altre opzioni scheda"
        triggerTitle="Menu azioni"
        className="custom-container"
        triggerClassName="custom-trigger"
        style={{ marginTop: '10px' }}
      />
    );

    const trigger = screen.getByRole('button', { name: 'Altre opzioni scheda' }) as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('title')).toBe('Menu azioni');
    expect(trigger.classList.contains('context-menu-trigger')).toBe(true);
    expect(trigger.classList.contains('custom-trigger')).toBe(true);

    const container = trigger.closest('.context-menu-container') as HTMLDivElement;
    expect(container).not.toBeNull();
    expect(container.classList.contains('custom-container')).toBe(true);
    expect(container.style.marginTop).toBe('10px');
  });

  it('supports align="left" and align="right"', () => {
    const { rerender } = render(<ContextMenu items={sampleItems} align="left" />);

    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    expect(menu.classList.contains('align-left')).toBe(true);

    rerender(<ContextMenu items={sampleItems} align="right" />);
    expect(screen.getByRole('menu').classList.contains('align-right')).toBe(true);
  });

  it('renders icons properly (both React component and React node)', () => {
    render(<ContextMenu items={sampleItems} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));

    // Icon passed as Component (Pencil)
    const items = screen.getAllByRole('menuitem');
    expect(items[0].querySelector('.context-menu-item-icon')).not.toBeNull();

    // Icon passed as Element (Copy)
    expect(screen.getByTestId('copy-icon')).not.toBeNull();
  });

  it('filters out items with hidden: true', () => {
    const itemsWithHidden: ContextMenuItem[] = [
      { id: '1', label: 'Modifica', onClick: vi.fn() },
      { id: '2', label: 'Elimina', onClick: vi.fn(), hidden: true },
      { id: '3', label: 'Report', onClick: vi.fn() },
    ];

    render(<ContextMenu items={itemsWithHidden} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.length).toBe(2);
    expect(menuItems[0].textContent).toContain('Modifica');
    expect(menuItems[1].textContent).toContain('Report');
    expect(screen.queryByText('Elimina')).toBeNull();
  });

  it('applies danger and primary styling classes', () => {
    const variantItems: ContextMenuItem[] = [
      { id: '1', label: 'Azione normale', onClick: vi.fn() },
      { id: '2', label: 'Azione primaria', variant: 'primary', onClick: vi.fn() },
      { id: '3', label: 'Azione distruttiva', variant: 'danger', onClick: vi.fn() },
    ];

    render(<ContextMenu items={variantItems} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems[0].classList.contains('context-menu-item')).toBe(true);
    expect(menuItems[0].classList.contains('context-menu-item-primary')).toBe(false);
    expect(menuItems[0].classList.contains('context-menu-item-danger')).toBe(false);

    expect(menuItems[1].classList.contains('context-menu-item-primary')).toBe(true);
    expect(menuItems[1].classList.contains('item-primary')).toBe(true);

    expect(menuItems[2].classList.contains('context-menu-item-danger')).toBe(true);
    expect(menuItems[2].classList.contains('item-danger')).toBe(true);
  });

  it('calls item onClick, stops propagation, and closes menu on item click', () => {
    const handleEdit = vi.fn();
    const handleParentClick = vi.fn();

    const items: ContextMenuItem[] = [
      { id: 'edit', label: 'Modifica allenamento', onClick: handleEdit },
    ];

    render(
      <div onClick={handleParentClick}>
        <ContextMenu items={items} />
      </div>
    );

    // Open menu
    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);
    expect(handleParentClick).not.toHaveBeenCalled();

    // Click item
    const itemBtn = screen.getByRole('menuitem', { name: /Modifica allenamento/i });
    fireEvent.click(itemBtn);

    expect(handleEdit).toHaveBeenCalledTimes(1);
    expect(handleParentClick).not.toHaveBeenCalled(); // Event propagation stopped
    expect(screen.queryByRole('menu')).toBeNull(); // Menu closed
  });

  it('handles disabled item: does not invoke onClick and does not close menu', () => {
    const handleDisabledClick = vi.fn();
    const items: ContextMenuItem[] = [
      { id: 'disabled-item', label: 'Azione non disponibile', disabled: true, onClick: handleDisabledClick },
    ];

    render(<ContextMenu items={items} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));

    const disabledBtn = screen.getByRole('menuitem', { name: /Azione non disponibile/i }) as HTMLButtonElement;
    expect(disabledBtn.disabled).toBe(true);
    expect(disabledBtn.getAttribute('aria-disabled')).toBe('true');
    expect(disabledBtn.classList.contains('context-menu-item-disabled')).toBe(true);

    fireEvent.click(disabledBtn);
    expect(handleDisabledClick).not.toHaveBeenCalled();
    // Menu remains open
    expect(screen.getByRole('menu')).not.toBeNull();
  });

  it('closes menu when clicking outside (mousedown and touchstart)', () => {
    render(
      <div>
        <div data-testid="outside-element">Elemento esterno</div>
        <ContextMenu items={sampleItems} />
      </div>
    );

    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).not.toBeNull();

    const outsideEl = screen.getByTestId('outside-element');

    // Click outside via mousedown
    fireEvent.mouseDown(outsideEl);
    expect(screen.queryByRole('menu')).toBeNull();

    // Reopen and test touchstart outside
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).not.toBeNull();

    fireEvent.touchStart(outsideEl);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes menu on Escape key press and refocuses trigger button', () => {
    render(<ContextMenu items={sampleItems} />);

    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).not.toBeNull();

    // Press Escape
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('supports keyboard ArrowDown and ArrowUp navigation across menu items', () => {
    render(<ContextMenu items={sampleItems} />);

    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');

    // First ArrowDown focuses item 0
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);

    // Second ArrowDown focuses item 1
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    // Third ArrowDown focuses item 2
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);

    // Fourth ArrowDown wraps around to item 0
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);

    // ArrowUp wraps backwards to item 2
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[2]);

    // Home focuses first item
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);

    // End focuses last item
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
  });

  it('opens menu with ArrowDown, Enter, Space or ArrowUp on trigger button', () => {
    const { unmount } = render(<ContextMenu items={sampleItems} />);
    const trigger = screen.getByRole('button', { name: 'Opzioni' });

    // ArrowDown
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    expect(screen.getByRole('menu')).not.toBeNull();
    unmount();

    // Enter
    const { unmount: unmount2 } = render(<ContextMenu items={sampleItems} />);
    const trigger2 = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.keyDown(trigger2, { key: 'Enter' });
    expect(screen.getByRole('menu')).not.toBeNull();
    unmount2();

    // Space
    const { unmount: unmount3 } = render(<ContextMenu items={sampleItems} />);
    const trigger3 = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.keyDown(trigger3, { key: ' ' });
    expect(screen.getByRole('menu')).not.toBeNull();
    unmount3();

    // ArrowUp
    const { unmount: unmount4 } = render(<ContextMenu items={sampleItems} />);
    const trigger4 = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.keyDown(trigger4, { key: 'ArrowUp' });
    expect(screen.getByRole('menu')).not.toBeNull();
    unmount4();
  });

  it('closes menu on Tab keydown inside menu', () => {
    render(<ContextMenu items={sampleItems} />);

    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu');

    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('stops event propagation on dropdown container click', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <ContextMenu items={sampleItems} />
      </div>
    );

    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);

    const menu = screen.getByRole('menu');
    fireEvent.click(menu);

    expect(parentClick).not.toHaveBeenCalled();
  });

  it('cleans up event listeners cleanly on unmount', () => {
    const { unmount } = render(<ContextMenu items={sampleItems} />);
    const trigger = screen.getByRole('button', { name: 'Opzioni' });
    fireEvent.click(trigger);

    expect(screen.getByRole('menu')).not.toBeNull();
    expect(() => unmount()).not.toThrow();
  });
});
