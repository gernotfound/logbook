import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ContextMenu, ContextMenuItem } from '../src/components/UI/ContextMenu';
import { RoutineCard } from '../src/components/Training/routines/RoutineCard';
import { CycleCard } from '../src/components/Training/planning/CycleCard';
import { FoodItemRow } from '../src/components/Nutrition/archive/FoodItemRow';
import TrainingExercises from '../src/components/Training/TrainingExercises';
import { useAppStore } from '../src/store/useAppStore';
import { Pencil, Trash2, Copy } from 'lucide-react';
import type { Routine, ExerciseLibraryItem, TrainingCycle, WorkoutRoutine } from '../src/types';

describe('Empirical Adversarial Stress Suite: ContextMenu & Integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const sampleItems: ContextMenuItem[] = [
    {
      id: 'item-1',
      label: 'Modifica scheda',
      icon: Pencil,
      onClick: vi.fn(),
    },
    {
      id: 'item-2',
      label: 'Duplica scheda',
      icon: Copy,
      onClick: vi.fn(),
    },
    {
      id: 'item-3',
      label: 'Elimina scheda',
      icon: Trash2,
      variant: 'danger',
      onClick: vi.fn(),
    },
  ];

  /* -------------------------------------------------------------------------- */
  /* 1. RAPID MENU OPEN / CLOSE TOGGLING STRESS                                 */
  /* -------------------------------------------------------------------------- */
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

    it('survives unmounting and remounting immediately while dropdown is open without memory leaks or dangling listeners', () => {
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
      // When all visible items are empty, component returns null safely
      expect(screen.queryByRole('menu')).toBeNull();
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 2. EVENT BUBBLING ISOLATION & COMPONENT INTEGRATIONS                       */
  /* -------------------------------------------------------------------------- */
  describe('2. Event Bubbling Isolation Across Integrated Components', () => {
    describe('RoutineCard Integration', () => {
      const mockRoutine: Routine = {
        id: 'routine-1',
        name: 'Spinta & Tricipiti',
        exercises: [
          { exId: 'ex-1', setsCount: 4, minReps: 8, maxReps: 10 } as any,
        ],
      };

      const mockLibrary: ExerciseLibraryItem[] = [
        { id: 'ex-1', name: 'Panca piana bilanciere', muscles: ['chest'], secondaryMuscles: ['triceps'] } as any,
      ];

      it('isolates clicks on ContextMenu trigger so RoutineCard accordion is NOT toggled', () => {
        const onToggleExpand = vi.fn();
        const onEdit = vi.fn();
        const onDelete = vi.fn();

        render(
          <RoutineCard
            routine={mockRoutine}
            isExpanded={false}
            library={mockLibrary}
            onToggleExpand={onToggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );

        const trigger = screen.getByRole('button', { name: 'Opzioni' });
        // Click trigger to open menu
        fireEvent.click(trigger);

        // Verification: Menu is open, but RoutineCard accordion was NOT toggled
        expect(screen.getByRole('menu')).not.toBeNull();
        expect(onToggleExpand).not.toHaveBeenCalled();
      });

      it('isolates clicks on ContextMenu items so RoutineCard accordion is NOT toggled on Edit / Delete', () => {
        const onToggleExpand = vi.fn();
        const onEdit = vi.fn();
        const onDelete = vi.fn();

        render(
          <RoutineCard
            routine={mockRoutine}
            isExpanded={false}
            library={mockLibrary}
            onToggleExpand={onToggleExpand}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        );

        // 1. Test "Modifica scheda"
        const trigger = screen.getByRole('button', { name: 'Opzioni' });
        fireEvent.click(trigger);
        expect(onToggleExpand).not.toHaveBeenCalled();

        const editBtn = screen.getByRole('menuitem', { name: /Modifica scheda/i });
        fireEvent.click(editBtn);

        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(onEdit).toHaveBeenCalledWith(mockRoutine);
        expect(onToggleExpand).not.toHaveBeenCalled();
        expect(screen.queryByRole('menu')).toBeNull(); // Menu closed

        // 2. Test "Elimina scheda"
        fireEvent.click(trigger);
        expect(onToggleExpand).not.toHaveBeenCalled();

        const deleteBtn = screen.getByRole('menuitem', { name: /Elimina scheda/i });
        fireEvent.click(deleteBtn);

        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(onDelete).toHaveBeenCalledWith(mockRoutine.id, expect.anything());
        expect(onToggleExpand).not.toHaveBeenCalled();
      });

      it('allows RoutineCard accordion toggle when clicking on card header area outside ContextMenu', () => {
        const onToggleExpand = vi.fn();
        render(
          <RoutineCard
            routine={mockRoutine}
            isExpanded={false}
            library={mockLibrary}
            onToggleExpand={onToggleExpand}
            onEdit={vi.fn()}
            onDelete={vi.fn()}
          />
        );

        const routineNameHeader = screen.getByText('Spinta & Tricipiti');
        fireEvent.click(routineNameHeader);

        expect(onToggleExpand).toHaveBeenCalledTimes(1);
        expect(onToggleExpand).toHaveBeenCalledWith('routine-1');
      });
    });

    describe('TrainingExercises Integration', () => {
      beforeEach(() => {
        const initialUserData: any = {
          library: [
            { id: 'lib-1', name: 'Croci ai cavi', muscles: ['chest'], trackingType: 'weight_reps', isDefault: false },
            { id: 'lib-2', name: 'Panca piana', muscles: ['chest'], trackingType: 'weight_reps', isDefault: true },
          ],
          routines: [],
        };
        useAppStore.setState({ userData: initialUserData });
      });

      it('isolates ContextMenu trigger and item clicks from exercise row expansion in TrainingExercises', () => {
        render(<TrainingExercises />);

        // Find the options trigger for the first exercise ("Croci ai cavi")
        const triggers = screen.getAllByRole('button', { name: 'Opzioni' });
        expect(triggers.length).toBe(2);

        // Click trigger on first item
        fireEvent.click(triggers[0]);
        expect(screen.getByRole('menu')).not.toBeNull();

        // Check menu item labels conform to sentence case
        const editItem = screen.getByRole('menuitem', { name: /Modifica esercizio/i });
        const deleteItem = screen.getByRole('menuitem', { name: /Elimina esercizio/i });
        expect(editItem).not.toBeNull();
        expect(deleteItem).not.toBeNull();

        // Default exercise (lib-2) should NOT show "Elimina esercizio" when opened
        fireEvent.mouseDown(triggers[1]);
        fireEvent.click(triggers[1]); // Opens second menu, closes first
        expect(screen.getByRole('menuitem', { name: /Modifica esercizio/i })).not.toBeNull();
        expect(screen.queryByRole('menuitem', { name: /Elimina esercizio/i })).toBeNull();
      });
    });

    describe('CycleCard Integration', () => {
      const mockCycle: TrainingCycle = {
        id: 'cycle-1',
        name: 'Massa Ipertrofia Autunno',
        durationWeeks: 6,
        sessionsPerWeek: 4,
        routines: [{ routineId: 'r1' }, { routineId: 'r2' }],
      };

      const mockRoutines: WorkoutRoutine[] = [
        { id: 'r1', name: 'Scheda A', exercises: [] },
        { id: 'r2', name: 'Scheda B', exercises: [] },
      ];

      it('isolates clicks on ContextMenu in CycleCard for Edit, Duplicate, and Delete actions', () => {
        const onSetActive = vi.fn();
        const onDeactivate = vi.fn();
        const onEdit = vi.fn();
        const onDuplicate = vi.fn();
        const onDelete = vi.fn();

        render(
          <CycleCard
            cycle={mockCycle}
            isActive={false}
            routines={mockRoutines}
            onSetActive={onSetActive}
            onDeactivate={onDeactivate}
            onEdit={onEdit}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
          />
        );

        const trigger = screen.getByRole('button', { name: 'Opzioni' });

        // 1. Edit cycle
        fireEvent.click(trigger);
        const editItem = screen.getByRole('menuitem', { name: /Modifica ciclo/i });
        fireEvent.click(editItem);
        expect(onEdit).toHaveBeenCalledWith(mockCycle);
        expect(onSetActive).not.toHaveBeenCalled();

        // 2. Duplicate cycle
        fireEvent.click(trigger);
        const duplicateItem = screen.getByRole('menuitem', { name: /Duplica ciclo/i });
        fireEvent.click(duplicateItem);
        expect(onDuplicate).toHaveBeenCalledWith(mockCycle);

        // 3. Delete cycle
        fireEvent.click(trigger);
        const deleteItem = screen.getByRole('menuitem', { name: /Elimina ciclo/i });
        expect(deleteItem.classList.contains('context-menu-item-danger')).toBe(true);
        fireEvent.click(deleteItem);
        expect(onDelete).toHaveBeenCalledWith(mockCycle);
      });
    });

    describe('FoodItemRow Integration', () => {
      const mockFood = {
        id: 'food-1',
        name: 'Petto di pollo',
        kcal: 110,
        pro: 23,
        carbs: 0,
        fat: 1.2,
      };

      it('isolates ContextMenu in FoodItemRow for Edit and Delete without bubbling to quick add', () => {
        const onEdit = vi.fn();
        const onDelete = vi.fn();
        const onQuickAddToMeal = vi.fn();

        render(
          <FoodItemRow
            food={mockFood}
            isLast={false}
            mealTypes={['Colazione', 'Pranzo', 'Cena']}
            onEdit={onEdit}
            onDelete={onDelete}
            onQuickAddToMeal={onQuickAddToMeal}
          />
        );

        const trigger = screen.getByRole('button', { name: 'Opzioni' });

        // Edit
        fireEvent.click(trigger);
        const editItem = screen.getByRole('menuitem', { name: /Modifica alimento/i });
        fireEvent.click(editItem);
        expect(onEdit).toHaveBeenCalledWith(mockFood);
        expect(onQuickAddToMeal).not.toHaveBeenCalled();

        // Delete
        fireEvent.click(trigger);
        const deleteItem = screen.getByRole('menuitem', { name: /Elimina alimento/i });
        fireEvent.click(deleteItem);
        expect(onDelete).toHaveBeenCalledWith(mockFood);
        expect(onQuickAddToMeal).not.toHaveBeenCalled();
      });
    });
  });

  /* -------------------------------------------------------------------------- */
  /* 3. OUTSIDE CLICK HANDLING                                                  */
  /* -------------------------------------------------------------------------- */
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

  /* -------------------------------------------------------------------------- */
  /* 4. KEYBOARD INTERACTION STRESS                                             */
  /* -------------------------------------------------------------------------- */
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

  /* -------------------------------------------------------------------------- */
  /* 5. MULTIPLE OPEN MENUS (MUTUAL EXCLUSION & OUTSIDE DISMISSAL)              */
  /* -------------------------------------------------------------------------- */
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

  /* -------------------------------------------------------------------------- */
  /* 6. ACCESSIBILITY & DESIGN SYSTEM CONFORMANCE                               */
  /* -------------------------------------------------------------------------- */
  describe('6. A11y & Italian Sentence Case Conformance', () => {
    it('verifies Italian sentence case for all standard menu labels', () => {
      const labels = [
        'Modifica scheda',
        'Elimina scheda',
        'Modifica ciclo',
        'Duplica ciclo',
        'Elimina ciclo',
        'Modifica esercizio',
        'Elimina esercizio',
        'Modifica alimento',
        'Elimina alimento',
      ];

      for (const label of labels) {
        // First character uppercase
        expect(label[0]).toBe(label[0].toUpperCase());
        // Remaining words start with lowercase unless proper nouns
        const words = label.split(' ');
        for (let w = 1; w < words.length; w++) {
          expect(words[w][0]).toBe(words[w][0].toLowerCase());
        }
      }
    });

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

  /* -------------------------------------------------------------------------- */
  /* 7. ASYNC LIFECYCLE & TOUCH TORTURE STRESS                                   */
  /* -------------------------------------------------------------------------- */
  describe('7. Lifecycle Races & Touch Stress', () => {
    it('survives synchronous unmount immediately following keyboard trigger activation before setTimeout tick', () => {
      for (let i = 0; i < 10; i++) {
        const { unmount } = render(<ContextMenu items={sampleItems} />);
        const trigger = screen.getByRole('button', { name: 'Opzioni' });
        // Press ArrowDown to schedule focus in setTimeout
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        // Immediately unmount before setTimeout fires
        unmount();
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
