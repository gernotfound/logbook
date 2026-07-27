# Project: Logbook PWA QA & Refactoring

## Architecture
- React + TypeScript + Zustand PWA application.
- State management refactored from React JS Context to TS + Zustand stores.
- Key modules: Persistence, Timers, Routing, Log Calculations, React UI components/views.

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | Codebase Audit & Exploration | Investigate whole codebase for syntax errors, state bugs, missing features, lint issues | None | DONE |
| 2 | Dual Track E2E / Render Test Suite | Create render testing script (@testing-library/react + jsdom) to ensure main components/views render without crashing | M1 | DONE |
| 3 | Bug Fixes & Refactoring | Fix identified bugs, restore lost features (timer, routing, calculations, persistence), clean up code | M1 | DONE |
| 4 | Final Build & Forensic Audit | Verification via Reviewers, Challengers, Forensic Auditor, and zero-error `npm run build` | M2, M3 | DONE |
| 5 | Git Commit & Push | Commit all changes with descriptive commit message and push to repository | M4 | DONE |

## Interface Contracts
- Zustand stores: state interface definitions, persistence hydration, selector optimization.
- Components/Views: props interfaces, render stability, route params, calculations.

## Code Layout
- `src/`: Source code directory
  - `components/`: UI components
  - `views/` or `pages/`: Application views
  - `store/` or `stores/`: Zustand state management stores
  - `hooks/`: Custom React hooks
  - `utils/` or `helpers/`: Utility functions and calculations
- `tests/` or `__tests__/`: Render test suite
