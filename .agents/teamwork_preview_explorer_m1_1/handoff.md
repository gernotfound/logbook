# Handoff Report: R1 & R2 Investigation (Milestone M1)

**Agent**: Explorer 1  
**Milestone**: M1 (Architectural & Performance Fixes)  
**Date**: 2026-08-17  
**Artifact**: `analysis.md` (in same directory)  

---

## 1. Observation
1. **`vite.config.ts` (lines 6 & 50)**:
   - Line 6: `base: '/logbook/', // GitHub Pages base path`
   - Line 50: `start_url: '/logbook/',`
   - No `scope` property is explicitly defined in `manifest`.
   - `index.html` uses `%BASE_URL%` interpolation token for all asset paths (e.g., `%BASE_URL%apple-touch-icon.png`), which Vite substitutes dynamically based on `base`.
   - Grep search for `/logbook` across the entire repository confirmed that `vite.config.ts` lines 6 and 50 are the only occurrences.
2. **`src/components/UI/ErrorBoundary.tsx` (lines 54–62)**:
   ```tsx
   <button 
     className="btn" 
     style={{ background: 'transparent', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', fontSize: '0.85rem' }}
     onClick={() => {
       if(window.confirm('ATTENZIONE: Questo cancellerà tutti i dati non sincronizzati col cloud. Procedere?')) {
         window.localStorage.clear();
         window.location.reload();
       }
     }}
   >
     ⚠️ Hard Reset (Dati Corrotti)
   </button>
   ```
   - Uses native blocking `window.confirm()`, violating AGENTS.md Rule 7.
   - Button text uses Title Case "Hard Reset (Dati Corrotti)", violating AGENTS.md Rule 11.
   - Grep search for `window.confirm` and `confirm(` across `src/` confirmed this is the ONLY remaining native confirm in the entire repository.
3. **`src/store/useDialogStore.ts` & `src/components/UI/GlobalDialog.tsx`**:
   - `useDialogStore` provides `showConfirm: (message: string, title?: string) => Promise<boolean>`.
   - `GlobalDialog` is currently mounted only inside `App.tsx` (line 133).
   - In `src/main.tsx` (lines 35–39), `ErrorBoundary` wraps `<AuthProvider>` and `<App />`. When an uncaught error occurs, `<App />` is unmounted and replaced by `ErrorBoundary`'s fallback UI.

---

## 2. Logic Chain
1. **R1 (Dynamic Base Path)**:
   - *Observation 1*: `base` and `start_url` are hardcoded to `'/logbook/'`.
   - *Logic Step 1.1*: When deploying to root domains (e.g. Firebase Hosting or local preview), `/logbook/` causes asset 404s and broken PWA launch URLs.
   - *Logic Step 1.2*: Using `const basePath = process.env.VITE_BASE_PATH || '/'` allows build environments to supply `VITE_BASE_PATH` (e.g. `/logbook/` for GitHub Pages in CI) while defaulting cleanly to `'/'` for root hosting.
   - *Logic Step 1.3*: Applying `basePath` to `base`, `manifest.start_url`, and `manifest.scope` ensures complete PWA consistency across both scenarios.

2. **R2 (ErrorBoundary Dialog Replacement)**:
   - *Observation 2 & 3*: `window.confirm` is used in `ErrorBoundary.tsx`, and `ErrorBoundary` replaces `<App />` upon error.
   - *Logic Step 2.1*: Replacing `window.confirm` with `await useDialogStore.getState().showConfirm('Questo cancellerà tutti i dati non sincronizzati con il cloud. Procedere?', 'Attenzione')` adheres to AGENTS.md Rules 7 and 11.
   - *Logic Step 2.2*: Because `<App />` is unmounted when `ErrorBoundary` is active, `<GlobalDialog />` must be mounted directly inside `ErrorBoundary`'s fallback JSX so the user can see and interact with the confirmation dialog.
   - *Logic Step 2.3*: The reset action is asynchronous: `if (confirmed) { window.localStorage.clear(); window.location.reload(); }`.

---

## 3. Caveats
- **No caveats.** The scope is cleanly bounded to `vite.config.ts` and `src/components/UI/ErrorBoundary.tsx`. All other files (e.g., `index.html`, `vitest.config.ts`, `useDialogStore.ts`) are already compatible and require no modifications for R1 and R2.

---

## 4. Conclusion
- **R1 Plan**: Update `vite.config.ts` to compute `const basePath = process.env.VITE_BASE_PATH || '/'` and assign it to `base`, `manifest.start_url`, and `manifest.scope`.
- **R2 Plan**: In `src/components/UI/ErrorBoundary.tsx`:
  1. Import `useDialogStore` from `../../store/useDialogStore` and `GlobalDialog` from `./GlobalDialog`.
  2. Implement `handleHardReset = async () => { const confirmed = await useDialogStore.getState().showConfirm(...); if (confirmed) { window.localStorage.clear(); window.location.reload(); } }`.
  3. Include `<GlobalDialog />` in the fallback JSX.
  4. Fix button text to Italian Sentence Case: `⚠️ Hard reset (dati corrotti)`.

---

## 5. Verification Method
- **Command Line Tests**:
  1. `npm.cmd run lint` $\rightarrow$ must pass with 0 errors.
  2. `npm.cmd run build` $\rightarrow$ verify TypeScript and Vite build succeed.
  3. `npm.cmd test` $\rightarrow$ all 26 test suites and 475 tests pass.
- **Specific Confirmations**:
  - `grep -r "window.confirm" src/` $\rightarrow$ returns 0 matches.
  - Inspect `dist/manifest.webmanifest` after default build $\rightarrow$ `"start_url": "/"` and `"scope": "/"`.
