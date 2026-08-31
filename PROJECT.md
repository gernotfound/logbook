# Project: ContextMenu Component & Integration Across LogBook

## Architecture
- **Component**: `src/components/UI/ContextMenu.tsx`
  - Reusable, accessible dropdown menu component triggered by an iOS-style 3 horizontal dots icon (`MoreHorizontal` from `lucide-react`, size 20).
  - Minimum touch target 44x44px (`min-width: 44px; min-height: 44px;` in CSS).
  - Click-outside and Escape key dismissal.
  - Event bubbling isolation (`e.stopPropagation()`) on both trigger button and menu items to prevent parent click/accordion triggers.
  - Dark Glassmorphism visual design conforming to `AGENTS.md` (variables from `src/styles/global.css`: `--glass-bg`, `--glass-border`, `--surface-color`, `--text-main`, `--text-muted`, `--danger-color`, `--primary-color`).
  - Accessibility: `aria-haspopup="menu"`, `aria-expanded={isOpen}`, `role="menu"`, `role="menuitem"`, keyboard navigation support (`ArrowDown`, `ArrowUp`, `Enter`, `Space`, `Escape`).
  - Strict Italian sentence case for all labels (e.g., "Modifica ciclo", "Duplica ciclo", "Elimina ciclo").
- **Integration Targets**:
  - `src/components/Training/planning/CycleCard.tsx` (Replaced 3 inline buttons: Modifica, Duplica, Elimina).
  - `src/components/Training/routines/RoutineCard.tsx` (Replaced 2 inline buttons: Modifica, Elimina).
  - `src/components/Training/TrainingHistory.tsx` (Replaced inline buttons: Modifica, Elimina, and optionally Vedi report).
  - `src/components/Training/TrainingExercises.tsx` (Replaced inline buttons: Modifica, Elimina with condition `!ex.isDefault`).
  - `src/components/Nutrition/archive/FoodItemRow.tsx` (Replaced inline buttons: Modifica, Elimina).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | ContextMenu Core Component | Create `src/components/UI/ContextMenu.tsx` with `ContextMenuProps`, `ContextMenuItem`, touch target, a11y, stopPropagation, keyboard & click-outside dismissal | M1 | Survey (Explorer 2) |
| 2 | ContextMenu CSS Styling | Add dark glassmorphism styling in `src/styles/global.css` (`.context-menu-container`, `.context-menu-trigger`, `.context-menu-dropdown`, `.context-menu-item`, `.context-menu-item-danger`) | M1 | Survey (Explorer 2) |
| 3 | ContextMenu Unit Tests | Create `tests/context_menu.test.tsx` testing render, open/close, click outside, keyboard navigation, disabled items, stopPropagation, sentence case | M1 | Survey (Explorer 3) |
| 4 | CycleCard Integration | Replace inline action buttons in `CycleCard.tsx` with `ContextMenu`, preserve `onEdit`, `onDuplicate`, `onDelete` | M2 | Survey (Explorer 1) |
| 5 | RoutineCard Integration | Replace inline action buttons in `RoutineCard.tsx` with `ContextMenu`, preserve `onEdit`, `onDelete`, prevent accordion toggle on menu click | M2 | Survey (Explorer 1) |
| 6 | Planning & Routine Test Updates | Update `tests/training_planning.test.tsx` and related tests to interact with ContextMenu trigger | M2 | Survey (Explorer 3) |
| 7 | TrainingHistory Integration | Replace inline action buttons in `TrainingHistory.tsx` with `ContextMenu`, preserve `onEditWorkout`, `deleteWorkout`, `setSelectedReportWorkout` | M3 | Survey (Explorer 1) |
| 8 | TrainingExercises Integration | Replace inline action buttons in `TrainingExercises.tsx` with `ContextMenu`, preserve `handleEditClick`, `handleDelete` (`!ex.isDefault` conditional), prevent row accordion toggle | M3 | Survey (Explorer 1) |
| 9 | FoodItemRow Integration | Replace inline action buttons in `FoodItemRow.tsx` with `ContextMenu`, preserve `onEdit`, `onDelete` | M3 | Survey (Explorer 1) |
| 10 | History & Workout Test Updates | Update `tests/workout_improvements.test.tsx` and related tests to interact with ContextMenu trigger | M3 | Survey (Explorer 3) |
| 11 | Comprehensive Verification & Hardening | Run all 55+ test suites (`npm run test`), type check & build (`npm run build`), lint (`npm run lint`), plus adversarial challenger tests & forensic audit | M4 | Survey (Explorer 3) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: ContextMenu Component & Styles | `src/components/UI/ContextMenu.tsx`, `src/styles/global.css`, `tests/context_menu.test.tsx` | none | DONE |
| 2 | M2: CycleCard & RoutineCard Integration | `src/components/Training/planning/CycleCard.tsx`, `src/components/Training/routines/RoutineCard.tsx`, `tests/training_planning.test.tsx` | M1 | DONE |
| 3 | M3: TrainingHistory, TrainingExercises & FoodItemRow Integration | `src/components/Training/TrainingHistory.tsx`, `src/components/Training/TrainingExercises.tsx`, `src/components/Nutrition/archive/FoodItemRow.tsx`, `tests/workout_improvements.test.tsx` | M1 | DONE |
| 4 | M4: Final Verification, Review, Adversarial Testing & Audit | Full test suite (`npm run test`), build (`npm run build`), lint (`npm run lint`), Challenger tests, Forensic Audit | M2, M3 | DONE |

## Interface Contracts
### `ContextMenu` Component Contract (`src/components/UI/ContextMenu.tsx`)
```typescript
import React from 'react';

export interface ContextMenuItem {
  id?: string;
  label: string; // Italian sentence case (e.g. "Modifica ciclo", "Elimina scheda")
  icon?: React.ReactNode; // e.g. <Edit size={16} />, <Trash2 size={16} />
  onClick: (e: React.MouseEvent) => void;
  variant?: 'default' | 'danger' | 'primary';
  disabled?: boolean;
  hidden?: boolean;
  title?: string;
  'aria-label'?: string;
}

export interface ContextMenuProps {
  items: ContextMenuItem[];
  ariaLabel?: string; // Default: "Opzioni"
  triggerTitle?: string;
  triggerClassName?: string;
  className?: string;
  align?: 'right' | 'left'; // Default: 'right'
}
```

## Code Layout
- `src/components/UI/ContextMenu.tsx` - Reusable ContextMenu component (M1)
- `src/styles/global.css` - Global Dark Glassmorphism CSS styles (M1)
- `src/components/Training/planning/CycleCard.tsx` - Training cycle card (M2)
- `src/components/Training/routines/RoutineCard.tsx` - Routine card (M2)
- `tests/training_planning.test.tsx` - Planning & Cycle test suite (M2)
- `src/components/Training/TrainingHistory.tsx` - Workout history item cards (M3)
- `src/components/Training/TrainingExercises.tsx` - Exercise archive list items (M3)
- `src/components/Nutrition/archive/FoodItemRow.tsx` - Food item row (M3)
- `tests/workout_improvements.test.tsx` - Workout history test suite (M3)
- `tests/context_menu.test.tsx` - Dedicated unit test suite for ContextMenu (M1)
- `tests/challenger_context_menu_stress.test.tsx` - Adversarial stress test suite (M4)
- `tests/challenger_m4_mobile_ux_adversarial.test.tsx` - Mobile UX & edge case test suite (M4)
