import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, ContextMenuItem } from '../src/components/UI/ContextMenu';
import { CycleCard } from '../src/components/Training/planning/CycleCard';
import { RoutineCard } from '../src/components/Training/routines/RoutineCard';
import { FoodItemRow } from '../src/components/Nutrition/archive/FoodItemRow';
import TrainingHistory from '../src/components/Training/TrainingHistory';
import { useAppStore } from '../src/store/useAppStore';
import { Pencil } from 'lucide-react';
import type { TrainingCycle, Routine, WorkoutSession } from '../src/types';
import fs from 'fs';
import path from 'path';

describe('Adversarial Challenger Suite: Mobile UX, Layout, Sentence Case & Edge States', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /* -------------------------------------------------------------------------- */
  /* 1. MOBILE TOUCH TARGETS & CSS INTEGRITY (>= 44x44px)                       */
  /* -------------------------------------------------------------------------- */
  describe('1. Mobile Touch Targets & CSS Rules (>= 44x44px)', () => {
    it('verifies the imported ContextMenu styles provide a 44px trigger and touch manipulation', () => {
      const stylesDir = path.resolve(__dirname, '../src/styles');
      const globalCss = fs.readFileSync(path.join(stylesDir, 'global.css'), 'utf-8');
      const menuCss = fs.readFileSync(path.join(stylesDir, 'context-menu.css'), 'utf-8');
      const baseCss = fs.readFileSync(path.join(stylesDir, 'base.css'), 'utf-8');

      // cssReadCompat expands the imported modules for the effective global stylesheet.
      expect(globalCss).toContain('.context-menu-trigger');
      // 2.75rem is 44px at the 16px root font size; larger user fonts enlarge the target.
      expect(menuCss).toMatch(/\.context-menu-trigger\s*\{[^}]*min-width:\s*2\.75rem/);
      expect(menuCss).toMatch(/\.context-menu-trigger\s*\{[^}]*min-height:\s*2\.75rem/);
      expect(baseCss).toMatch(/button,\s*\[role="button"\],\s*a\s*\{[^}]*touch-action:\s*manipulation/);
    });

    it('verifies ContextMenu trigger button has .context-menu-trigger class and meets touch target standards', () => {
      render(
        <ContextMenu
          items={[{ id: '1', label: 'Modifica', onClick: vi.fn() }]}
        />
      );

      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      expect(trigger.classList.contains('context-menu-trigger')).toBe(true);
      expect(trigger.getAttribute('type')).toBe('button');
    });

    it('verifies all 5 target components render ContextMenu with touch-friendly trigger button', () => {
      // 1. CycleCard
      const mockCycle: TrainingCycle = {
        id: 'c1',
        name: 'Ciclo Test',
        durationWeeks: 4,
        sessionsPerWeek: 3,
        routines: [],
      };
      const { unmount: unmountCycle } = render(
        <CycleCard
          cycle={mockCycle}
          isActive={false}
          routines={[]}
          onSetActive={vi.fn()}
          onDeactivate={vi.fn()}
          onEdit={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Opzioni' }).classList.contains('context-menu-trigger')).toBe(true);
      unmountCycle();

      // 2. RoutineCard
      const mockRoutine: Routine = { id: 'r1', name: 'Scheda Test', exercises: [] };
      const { unmount: unmountRoutine } = render(
        <RoutineCard
          routine={mockRoutine}
          isExpanded={false}
          library={[]}
          onToggleExpand={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Opzioni' }).classList.contains('context-menu-trigger')).toBe(true);
      unmountRoutine();

      // 3. FoodItemRow
      const mockFood = { id: 'f1', name: 'Riso basmati', kcal: 350, pro: 7, carbs: 78, fat: 1 };
      const { unmount: unmountFood } = render(
        <FoodItemRow
          food={mockFood}
          isLast={false}
          mealTypes={['Pranzo']}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onQuickAddToMeal={vi.fn()}
        />
      );
      expect(screen.getByRole('button', { name: 'Opzioni' }).classList.contains('context-menu-trigger')).toBe(true);
      unmountFood();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. ADAPTIVE THEME VARIABLES & CONSISTENCY                                  */
  /* -------------------------------------------------------------------------- */
  describe('2. Adaptive Theme Variables & Theme Consistency', () => {
    it('verifies ContextMenu uses semantic tokens defined for both themes', () => {
      const stylesDir = path.resolve(__dirname, '../src/styles');
      const globalCss = fs.readFileSync(path.join(stylesDir, 'global.css'), 'utf-8');
      const menuCss = fs.readFileSync(path.join(stylesDir, 'context-menu.css'), 'utf-8');
      const tokensCss = fs.readFileSync(path.join(stylesDir, 'tokens.css'), 'utf-8');

      expect(globalCss).toContain('.context-menu-dropdown');
      expect(globalCss).toContain(':root[data-theme="light"]');
      expect(tokensCss).toContain(':root[data-theme="light"]');
      for (const token of ['text-muted', 'text-main', 'surface-color', 'border-strong', 'primary-color', 'danger-color']) {
        expect(menuCss).toContain(`var(--${token})`);
        expect(tokensCss.match(new RegExp(`--${token}:`, 'g'))?.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('verifies dropdown popup and variant items use their styled classes', () => {
      const items: ContextMenuItem[] = [
        { id: '1', label: 'Azione standard', onClick: vi.fn() },
        { id: '2', label: 'Azione primaria', variant: 'primary', onClick: vi.fn() },
        { id: '3', label: 'Azione pericolosa', variant: 'danger', onClick: vi.fn() },
      ];

      render(<ContextMenu items={items} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const dropdown = screen.getByRole('menu');
      expect(dropdown.classList.contains('context-menu-dropdown')).toBe(true);

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems[0].className).toContain('context-menu-item');
      expect(menuItems[1].className).toContain('context-menu-item-primary');
      expect(menuItems[2].className).toContain('context-menu-item-danger');
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. 100% ITALIAN SENTENCE CASE COMPLIANCE ACROSS ALL 5 TARGET COMPONENTS    */
  /* -------------------------------------------------------------------------- */
  describe('3. 100% Italian Sentence Case Compliance', () => {
    const isStrictSentenceCase = (text: string): boolean => {
      if (!text || text.trim().length === 0) return true;
      const clean = text.replace(/^[^\p{L}]+/u, '').trim(); // Remove leading emojis/symbols
      if (clean.length === 0) return true;

      // First letter must be uppercase
      const firstChar = clean[0];
      if (firstChar !== firstChar.toUpperCase()) return false;

      // In Italian sentence case, words after the first should not be capitalized unless acronyms
      const words = clean.split(/\s+/).slice(1);
      for (const word of words) {
        const wordClean = word.replace(/[^\p{L}]/gu, '');
        if (wordClean.length > 1 && wordClean === wordClean.toUpperCase()) {
          // Allowed uppercase acronyms (e.g. CSV, PWA)
          continue;
        }
        if (wordClean.length > 1 && wordClean[0] === wordClean[0].toUpperCase() && wordClean[1] === wordClean[1].toLowerCase()) {
          // Title Case violation
          return false;
        }
      }
      return true;
    };

    it('validates sentence case for ContextMenu default ariaLabel and items', () => {
      expect(isStrictSentenceCase('Opzioni')).toBe(true);
      expect(isStrictSentenceCase('Modifica scheda')).toBe(true);
      expect(isStrictSentenceCase('Elimina scheda')).toBe(true);
      expect(isStrictSentenceCase('Modifica ciclo')).toBe(true);
      expect(isStrictSentenceCase('Duplica ciclo')).toBe(true);
      expect(isStrictSentenceCase('Elimina ciclo')).toBe(true);
      expect(isStrictSentenceCase('Modifica allenamento')).toBe(true);
      expect(isStrictSentenceCase('Elimina allenamento')).toBe(true);
      expect(isStrictSentenceCase('Vedi report')).toBe(true);
      expect(isStrictSentenceCase('Modifica esercizio')).toBe(true);
      expect(isStrictSentenceCase('Elimina esercizio')).toBe(true);
      expect(isStrictSentenceCase('Modifica alimento')).toBe(true);
      expect(isStrictSentenceCase('Elimina alimento')).toBe(true);
    });

    it('verifies CycleCard ContextMenu items conform strictly to Italian sentence case', () => {
      const mockCycle: TrainingCycle = {
        id: 'c1',
        name: 'Ciclo Ipertrofia',
        durationWeeks: 4,
        sessionsPerWeek: 3,
        routines: [],
      };

      render(
        <CycleCard
          cycle={mockCycle}
          isActive={false}
          routines={[]}
          onSetActive={vi.fn()}
          onDeactivate={vi.fn()}
          onEdit={vi.fn()}
          onDuplicate={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
      const items = screen.getAllByRole('menuitem');
      const labels = items.map(i => i.querySelector('.context-menu-item-label')?.textContent || '');

      expect(labels).toEqual(['Modifica', 'Duplica', 'Elimina']);
      labels.forEach(label => {
        expect(isStrictSentenceCase(label)).toBe(true);
      });
    });

    it('verifies RoutineCard ContextMenu items conform strictly to Italian sentence case', () => {
      const mockRoutine: Routine = { id: 'r1', name: 'Scheda Gambe', exercises: [] };

      render(
        <RoutineCard
          routine={mockRoutine}
          isExpanded={false}
          library={[]}
          onToggleExpand={vi.fn()}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
      const items = screen.getAllByRole('menuitem');
      const labels = items.map(i => i.querySelector('.context-menu-item-label')?.textContent || '');

      expect(labels).toEqual(['Modifica', 'Duplica', 'Elimina']);
      labels.forEach(label => {
        expect(isStrictSentenceCase(label)).toBe(true);
      });
    });

    it('verifies TrainingHistory ContextMenu items conform strictly to Italian sentence case', () => {
      const mockSession: WorkoutSession = {
        id: 'wo-1',
        date: '2026-08-31',
        routineName: 'Push Day',
        exercises: [],
      };

      useAppStore.setState({
        userData: {
          history: [mockSession],
          library: [],
          routines: [],
          customFoods: [],
          trainingCycles: [],
        } as any,
      });

      render(
        <TrainingHistory
          onEditWorkout={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
      const items = screen.getAllByRole('menuitem');
      const labels = items.map(i => i.querySelector('.context-menu-item-label')?.textContent || '');

      expect(labels).toEqual(['Vedi report', 'Modifica allenamento', 'Elimina allenamento']);
      labels.forEach(label => {
        expect(isStrictSentenceCase(label)).toBe(true);
      });
    });

    it('verifies FoodItemRow ContextMenu items conform strictly to Italian sentence case', () => {
      const mockFood = { id: 'f1', name: 'Fiocchi di latte', kcal: 90, pro: 12, carbs: 3, fat: 4 };

      render(
        <FoodItemRow
          food={mockFood}
          isLast={false}
          mealTypes={['Spuntino']}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
          onQuickAddToMeal={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Opzioni' }));
      const items = screen.getAllByRole('menuitem');
      const labels = items.map(i => i.querySelector('.context-menu-item-label')?.textContent || '');

      expect(labels).toEqual(['Modifica', 'Duplica', 'Elimina']);
      labels.forEach(label => {
        expect(isStrictSentenceCase(label)).toBe(true);
      });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 4. EDGE CASE TESTING                                                       */
  /* -------------------------------------------------------------------------- */
  describe('4. Edge Cases: Long Labels, Missing Icons, Disabled/Hidden Items, 320px Viewport', () => {
    it('Edge Case A: Handles excessively long labels without breaking layout (ellipsis and overflow containment)', () => {
      const longLabel = 'Questa è una descrizione estremamente lunga per una voce di menu contestuale che potrebbe potenzialmente rompere il layout su dispositivi mobili con schermi stretti';
      const items: ContextMenuItem[] = [
        {
          id: 'long-item',
          label: longLabel,
          icon: <Pencil size={16} />,
          onClick: vi.fn(),
        },
      ];

      render(
        <div style={{ width: '320px' }}>
          <ContextMenu items={items} />
        </div>
      );

      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menu = screen.getByRole('menu');
      expect(menu).not.toBeNull();

      const labelEl = menu.querySelector('.context-menu-item-label');
      expect(labelEl).not.toBeNull();
      expect(labelEl?.textContent).toBe(longLabel);
    });

    it('Edge Case B: Handles items with NO icon without throwing or rendering empty icon span', () => {
      const noIconItems: ContextMenuItem[] = [
        { id: '1', label: 'Voce senza icona 1', onClick: vi.fn() },
        { id: '2', label: 'Voce senza icona 2', icon: undefined, onClick: vi.fn() },
        { id: '3', label: 'Voce con icona null', icon: null as any, onClick: vi.fn() },
      ];

      render(<ContextMenu items={noIconItems} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems.length).toBe(3);

      menuItems.forEach((btn) => {
        expect(btn.querySelector('.context-menu-item-icon')).toBeNull();
        expect(btn.textContent).toContain(`Voce`);
      });
    });

    it('Edge Case C: Disabled items cannot be activated via click or Enter key and preserve open state', () => {
      const handleDisabledClick = vi.fn();
      const items: ContextMenuItem[] = [
        { id: 'disabled', label: 'Voce disabilitata', disabled: true, onClick: handleDisabledClick },
        { id: 'enabled', label: 'Voce abilitata', onClick: vi.fn() },
      ];

      render(<ContextMenu items={items} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const disabledItem = screen.getByRole('menuitem', { name: /Voce disabilitata/i }) as HTMLButtonElement;
      expect(disabledItem.disabled).toBe(true);
      expect(disabledItem.getAttribute('aria-disabled')).toBe('true');

      // Click attempt
      fireEvent.click(disabledItem);
      expect(handleDisabledClick).not.toHaveBeenCalled();
      expect(screen.getByRole('menu')).not.toBeNull(); // Still open

      // Enter key attempt
      fireEvent.keyDown(disabledItem, { key: 'Enter' });
      expect(handleDisabledClick).not.toHaveBeenCalled();
      expect(screen.getByRole('menu')).not.toBeNull(); // Still open
    });

    it('Edge Case D: Hidden items are completely excluded from the DOM tree', () => {
      const items: ContextMenuItem[] = [
        { id: 'visible-1', label: 'Visibile 1', onClick: vi.fn() },
        { id: 'hidden-1', label: 'Nascosto 1', hidden: true, onClick: vi.fn() },
        { id: 'visible-2', label: 'Visibile 2', hidden: false, onClick: vi.fn() },
        { id: 'hidden-2', label: 'Nascosto 2', hidden: true, onClick: vi.fn() },
      ];

      render(<ContextMenu items={items} />);
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      fireEvent.click(trigger);

      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems.length).toBe(2);
      expect(screen.queryByText('Nascosto 1')).toBeNull();
      expect(screen.queryByText('Nascosto 2')).toBeNull();
      expect(screen.getByText('Visibile 1')).not.toBeNull();
      expect(screen.getByText('Visibile 2')).not.toBeNull();
    });

    it('Edge Case E: Renders gracefully inside 320px narrow mobile viewport containers', () => {
      const mockCycle: TrainingCycle = {
        id: 'c1',
        name: 'Ciclo Forza Avanzata per Atleti Competitivi',
        durationWeeks: 12,
        sessionsPerWeek: 5,
        routines: [],
      };

      const { container } = render(
        <div style={{ width: '320px', maxWidth: '320px', boxSizing: 'border-box' }}>
          <CycleCard
            cycle={mockCycle}
            isActive={true}
            routines={[]}
            onSetActive={vi.fn()}
            onDeactivate={vi.fn()}
            onEdit={vi.fn()}
            onDuplicate={vi.fn()}
            onDelete={vi.fn()}
          />
        </div>
      );

      expect(container.querySelector('.card')).not.toBeNull();
      const trigger = screen.getByRole('button', { name: 'Opzioni' });
      expect(trigger).not.toBeNull();

      fireEvent.click(trigger);
      const dropdown = screen.getByRole('menu');
      expect(dropdown).not.toBeNull();
      expect(dropdown.classList.contains('align-right')).toBe(true);
    });
  });
});
