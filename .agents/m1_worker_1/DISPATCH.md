## 2026-08-22T07:38:55Z
You are m1_worker_1.
Your working directory is C:\Users\gerar\Documents\GitHub\logbook\.agents\m1_worker_1.
Read the authoritative user request at C:\Users\gerar\Documents\GitHub\logbook\.agents\ORIGINAL_REQUEST.md, project plan at C:\Users\gerar\Documents\GitHub\logbook\PROJECT.md, project rules at C:\Users\gerar\Documents\GitHub\logbook\AGENTS.md, and survey reports at C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_1\handoff.md and C:\Users\gerar\Documents\GitHub\logbook\.agents\survey_explorer_2\handoff.md.

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. A teamwork_preview_auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

File Ownership:
You exclusively own and modify:
- `src/App.tsx`
- `src/styles/global.css`
- `src/contexts/AuthContext.tsx`
DO NOT modify any test files.

Tasks:
1. In `src/App.tsx` and `src/styles/global.css`:
   - Remove `<div id="sync-overlay">` and all `#sync-overlay` CSS rules.
2. In `src/App.tsx`:
   - Render the non-blocking sync indicator `.sync-indicator` positioned at bottom-right above the bottom navigation bar (`bottom: calc(76px + env(safe-area-inset-bottom, 0px))`, `right: 16px`), with animated spinner (`.sync-indicator-spinner`) and Italian sentence case text `"Salvataggio in corso..."`.
   - Render only when `syncing === true` from Zustand store.
   - Ensure `pointer-events: none` so clicks pass through.
   - Accessible with `role="status"` and `aria-live="polite"`.
3. In `src/App.tsx`:
   - Render the non-blocking error toast `.sync-error-toast` when `saveError` is non-null.
   - Include error icon, error text, and manual dismiss button `✕` (`aria-label="Chiudi avviso"`).
   - Implement an auto-dismiss lifecycle via `useEffect` with 5000ms timer that calls `useAppStore.getState().setSaveError(null)` with proper cleanup on unmount/re-render.
   - Ensure `role="alert"` and `aria-live="assertive"`.
4. In `src/styles/global.css`:
   - Add styles for `.sync-indicator`, `.sync-indicator-spinner`, `.sync-error-toast`, `.sync-error-text`, `.sync-error-close` adhering to the Dark Glassmorphism design system in AGENTS.md (`--glass-bg`, `--glass-border`, `--primary-color`, `--danger-color`, etc.).
5. In `src/contexts/AuthContext.tsx`:
   - Remove the old manual-only saveError banner (lines 285-299) to prevent duplicate toasts.
6. Verify your implementation by running:
   - `npm.cmd test`
   - `npm.cmd run lint`
   - `npm.cmd run build`
7. Write your full report to `C:\Users\gerar\Documents\GitHub\logbook\.agents\m1_worker_1\handoff.md` and send a message when done.
