# Project: LogBook Non-Blocking Background Sync & Error Toast

## Architecture
- **State Management**: Zustand 5 store (`src/store/useAppStore.ts`, `src/store/slices/createSyncSlice.ts`) with `syncing: boolean`, `saveError: string | null`, `setSyncing`, `setSaveError`.
- **UI Layer**: React 19 in `src/App.tsx`, `src/components/UI/BottomNav.tsx`, `src/contexts/AuthContext.tsx`.
- **Design System**: Dark Glassmorphism via Vanilla CSS in `src/styles/global.css` using custom properties (`--glass-bg`, `--glass-border`, `--primary-color`, `--danger-color`, `--text-main`, `--text-muted`).
- **Persistence**: 3-Tier Storage (Tier 1 Firestore, Tier 2 IndexedDB `idb-keyval`, Tier 3 `localStorage`).

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | R1. Rimozione Overlay Bloccante | Rimuovere `<div id="sync-overlay">` da `src/App.tsx` e il relativo blocco CSS `#sync-overlay` da `src/styles/global.css`. | M1 | ORIGINAL_REQUEST §R1 |
| 2 | R2. Indicatore Sincronizzazione Non Bloccante | Implementare un indicatore visivo in basso a destra sopra la barra di navigazione con spinner, testo "Salvataggio in corso..." e Dark Glassmorphism, visibile solo con `syncing === true`. | M1 | ORIGINAL_REQUEST §R2 |
| 3 | R3. Gestione Errori (Toast Auto-scomparente) | Banner/toast rosso non bloccante per `saveError`, auto-dismiss dopo 5 secondi via `useEffect` timer, pulsante di chiusura manuale `✕`, reset dello store. | M1 | ORIGINAL_REQUEST §R3 |
| 4 | E2E Test Suite (Tiers 1-4) | Suite di test completa (Tier 1 Feature Coverage, Tier 2 Boundary/Corner, Tier 3 Cross-Feature, Tier 4 Workloads) per verificare l'assenza di overlay e la comparsa/scomparsa di indicatore e toast. | E2E_TEST | ORIGINAL_REQUEST §Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | UI & State Implementation | R1, R2, R3: Aggiornamento `src/App.tsx`, `src/styles/global.css`, `src/contexts/AuthContext.tsx` per rimuovere overlay, aggiungere sync indicator e auto-dismissing toast. | none | DONE |
| E2E | E2E Testing Suite | Creazione della test suite completa (Tiers 1-4) in `tests/sync_indicator_and_toast.test.tsx` e pubblicazione di `TEST_READY.md`. | none | DONE |
| M2 | Final Verification & Hardening | Esecuzione al 100% dei test E2E (Tiers 1-4) + Hardening avversariale (Tier 5) + `npm test`, `npm run lint`, `npm run build`. | M1, E2E | DONE |

## Interface Contracts
### Store ↔ UI
- `useAppStore(state => state.syncing)`: `boolean` — controlla la visibilità dell'indicatore `.sync-indicator`.
- `useAppStore(state => state.saveError)`: `string | null` — controlla la visibilità e il messaggio del toast `.sync-error-toast`.
- `useAppStore.getState().setSaveError(null)`: invoca il reset dell'errore allo scadere dell'auto-dismiss (5000ms) o al click di `✕`.

## Code Layout
- `src/App.tsx`: Layout principale, rendering `.sync-indicator` e `.sync-error-toast` con `useEffect` auto-dismiss.
- `src/styles/global.css`: Classi `.sync-indicator`, `.sync-indicator-spinner`, `.sync-error-toast`, `.sync-error-text`, `.sync-error-close`.
- `src/contexts/AuthContext.tsx`: Pulizia del vecchio banner `saveError` ridondante.
- `tests/sync_indicator_and_toast.test.tsx`: Test suite unificata per R1, R2, R3 across all 4 tiers.
- `tests/challenger_m1_sync_adversarial.test.tsx`: Stress & churn test harness.
- `tests/challenger_m1_layout_a11y_lifecycle.test.tsx`: Layout, a11y & lifecycle test harness.
