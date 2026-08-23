# Handoff Report — Empirical Challenger 2: Layout Geometry, Accessibility, Z-Index & Online Lifecycle

**Verdict**: **APPROVE**

---

## 1. Observation

### 1.1 DOM Isolation & Click Interactivity
- **File**: `src/styles/global.css`, lines 427-448:
  ```css
  .sync-indicator {
      position: fixed;
      bottom: calc(76px + env(safe-area-inset-bottom, 0px));
      right: max(16px, calc(env(safe-area-inset-right, 0px) + 16px));
      background: var(--glass-bg);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid rgba(0, 229, 255, 0.25);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6), 0 0 10px var(--primary-glow);
      border-radius: 9999px;
      padding: 6px 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      z-index: 9990;
      pointer-events: none;
      font-size: 0.78rem;
      font-weight: 500;
      color: var(--text-main);
      animation: fadeSlideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      user-select: none;
  }
  ```
  `pointer-events: none` is explicitly declared on `.sync-indicator`, ensuring click and touch events pass directly through to underlying elements.
- **File**: `src/App.tsx`, lines 187-197:
  ```tsx
  {syncing && (
    <div 
      className="sync-indicator" 
      role="status" 
      aria-live="polite"
      aria-label="Salvataggio in corso"
    >
      <div className="sync-indicator-spinner" />
      <span>Salvataggio in corso...</span>
    </div>
  )}
  ```
  The old `#sync-overlay` is completely eliminated from `src/App.tsx` and `src/styles/global.css`.

### 1.2 Z-Index Stacking Hierarchy
Direct code inspection of z-index declarations across the project reveals:
1. `.sync-indicator` (`src/styles/global.css:441`): `z-index: 9990;`
2. `.sync-error-toast` (`src/styles/global.css:480`): `z-index: 9995;`
3. `.bottom-nav` (`src/styles/global.css:377`): `z-index: 10000 !important;`
4. `GlobalDialog` overlay (`src/components/UI/GlobalDialog.tsx:22`): `zIndex: 99999`

Stacking hierarchy confirmed:
$$\text{sync-indicator (9990)} < \text{sync-error-toast (9995)} < \text{BottomNav (10000)} < \text{GlobalDialog (99999)}$$

### 1.3 Accessibility (ARIA & Semantics)
- `.sync-indicator` (`src/App.tsx:188-193`):
  - `role="status"`
  - `aria-live="polite"`
  - `aria-label="Salvataggio in corso"`
  - Text: `"Salvataggio in corso..."` (Italian sentence case)
- `.sync-error-toast` (`src/App.tsx:201-216`):
  - `role="alert"`
  - `aria-live="assertive"`
  - Icon: `<span className="sync-error-icon" aria-hidden="true">⚠️</span>`
  - Text container: `<span className="sync-error-text">{saveError}</span>`
  - Close button: `<button type="button" className="sync-error-close" aria-label="Chiudi avviso" onClick={() => setSaveError(null)}>✕</button>`

### 1.4 Offline / Online Event Lifecycle & Auto-Dismissal
- **Browser Online Listener** (`src/store/useAppStore.ts:37-42`):
  ```ts
  // PWA FIX: Listen for online event to clear saveError if connection is restored
  if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
          useAppStore.getState().setSaveError(null);
      });
  }
  ```
  Firing `window.dispatchEvent(new Event('online'))` immediately invokes `setSaveError(null)` and dismisses the toast.
- **5000ms Auto-Dismiss Timer** (`src/App.tsx:38-44`):
  ```tsx
  useEffect(() => {
    if (!saveError) return;
    const timer = setTimeout(() => {
      setSaveError(null);
    }, 5000);
    return () => clearTimeout(timer);
  }, [saveError, setSaveError]);
  ```
  Auto-dismisses the toast after 5000ms, with clean timer reset if a new `saveError` arrives or on unmount.
- **Manual Close**:
  Clicking the `✕` button immediately executes `setSaveError(null)`.

### 1.5 Verification Commands & Outputs
- **Lint Check (`npm.cmd run lint`)**:
  `Found 34 warnings and 0 errors. Finished in 71ms on 151 files with 92 rules using 12 threads.` (0 errors).
- **TypeScript & Production Build (`npm.cmd run build`)**:
  `tsc --noEmit && vite build` completed with exit code 0 in 12.73s, bundling all chunks without type or bundling errors.
- **Empirical Challenger Suite (`tests/challenger_m1_layout_a11y_lifecycle.test.tsx`)**:
  ```
  ✓ tests/challenger_m1_layout_a11y_lifecycle.test.tsx (13 tests) 1898ms
  Test Files  1 passed (1)
       Tests  13 passed (13)
  ```
- **Milestone M1 Combined Test Run (`tests/challenger_m1_layout_a11y_lifecycle.test.tsx`, `tests/sync_indicator_and_toast.test.tsx`, `src/App.test.tsx`)**:
  ```
  Test Files  3 passed (3)
       Tests  56 passed (56)
    Duration  16.22s
  ```

---

## 2. Logic Chain

1. **Step 1 — Non-blocking interaction**: Observation §1.1 confirms that `#sync-overlay` has been completely purged and `.sync-indicator` carries `pointer-events: none`. Therefore, when synchronization occurs in the background, user touches and clicks are never intercepted or swallowed by the sync pill.
2. **Step 2 — Visual hierarchy preservation**: Observation §1.2 confirms that `.bottom-nav` has `z-index: 10000`, which is strictly higher than `.sync-indicator` (9990) and `.sync-error-toast` (9995). The bottom navigation tabs remain fully interactive and visible. Furthermore, system modals via `GlobalDialog` (99999) stack on top of all application views and toasts, preventing modal clipping.
3. **Step 3 — Assistive technology compliance**: Observation §1.3 confirms standard ARIA live region semantics (`role="status"` + `aria-live="polite"` for non-disruptive sync updates, `role="alert"` + `aria-live="assertive"` for critical sync failures). Decorative icons are hidden via `aria-hidden="true"`, and the dismiss button contains explicit `aria-label="Chiudi avviso"`.
4. **Step 4 — Resilient online/offline lifecycle**: Observation §1.4 confirms that network restoration (`online` event) immediately resets `saveError` to `null` to clear outdated error messages. In offline scenarios, the 5000ms auto-dismiss timer cleans up the toast while local mutations remain safe in IndexedDB and localStorage.
5. **Step 5 — Empirical validation**: Observation §1.5 confirms that linting, production build, and all 56 tests in the M1 sync suite pass cleanly.

---

## 3. Caveats

No caveats. All verification targets (layout geometry, responsive design, accessibility, DOM isolation, z-index hierarchy, online/offline lifecycle, and test executions) were empirically tested and confirmed.

---

## 4. Conclusion

The milestone M1 implementation satisfies all requirements (R1, R2, R3) and acceptance criteria:
- Blocking `#sync-overlay` is completely eliminated.
- `.sync-indicator` floats non-blockingly above the bottom navigation with `pointer-events: none` and Italian sentence case.
- `.sync-error-toast` renders with dark glassmorphic styling, auto-dismisses after 5000ms, provides an accessible `✕` close button, and clears immediately upon browser `online` events.
- Stacking order `sync-indicator (9990) < sync-error-toast (9995) < BottomNav (10000) < GlobalDialog (99999)` is strictly preserved.
- Lint (0 errors), build (code 0), and all 56 M1 test cases pass.

**Verdict**: **APPROVE**

---

## 5. Verification Method

To independently reproduce and verify:
1. `npm.cmd run lint` — Confirm 0 errors.
2. `npm.cmd run build` — Confirm clean TypeScript check (`tsc --noEmit`) and Vite bundling.
3. `npx.cmd vitest run tests/challenger_m1_layout_a11y_lifecycle.test.tsx tests/sync_indicator_and_toast.test.tsx src/App.test.tsx` — Confirm 56/56 tests pass.
4. Inspect `src/styles/global.css` lines 427-515 and `src/App.tsx` lines 187-217.
