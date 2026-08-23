# Investigation Analysis Report: R1 & R2 (Milestone M1)

**Date**: 2026-08-17  
**Explorer**: Explorer 1 (Architectural & Performance Fixes)  
**Scope**: R1 (Dynamic PWA Base Path in `vite.config.ts`), R2 (Remove `window.confirm` in `src/components/UI/ErrorBoundary.tsx`)  
**Status**: COMPLETE  

---

## Executive Summary
This analysis investigates the requirements and architectural considerations for two foundational fixes in Milestone M1:
1. **R1: Dynamic PWA Base Path in `vite.config.ts`**: Eliminates hardcoded `/logbook/` path so the PWA works seamlessly when deployed to root paths (e.g., Firebase Hosting, custom domains, local preview) or subpaths (GitHub Pages) via `process.env.VITE_BASE_PATH || '/'`.
2. **R2: Replacement of `window.confirm` in `ErrorBoundary.tsx`**: Removes the blocking native dialog `window.confirm` in compliance with `AGENTS.md` (Rules 7 and 11), integrating `useDialogStore.getState().showConfirm(...)` and mounting `<GlobalDialog />` inside the ErrorBoundary fallback tree to ensure dialog visibility when the main app tree is unmounted.

---

## 1. Requirement R1: Dynamic PWA Base Path (`vite.config.ts`)

### 1.1 Current State & Observations
- **File**: `vite.config.ts`
- **Line 6**: `base: '/logbook/', // GitHub Pages base path`
- **Line 50**: `start_url: '/logbook/',`
- **PWA Manifest scope**: Not explicitly declared, which defaults to `base`.
- **Global search across project**:
  - `grep -r "/logbook" src/` $\rightarrow$ 0 results.
  - `index.html` already uses the dynamic `%BASE_URL%` interpolation token (e.g. `<link rel="apple-touch-icon" href="%BASE_URL%apple-touch-icon.png">`), which Vite substitutes automatically based on the `base` property.
  - The ONLY hardcoded occurrences of `/logbook/` in the entire repository are in `vite.config.ts` (lines 6 and 50).

### 1.2 Issue & Impact
- When deploying to Firebase Hosting or custom domains where the app is served at `/`, having `base: '/logbook/'` causes all asset URLs (`/logbook/assets/...`) to 404.
- The PWA manifest `start_url` forces the browser/OS to launch the app at `/logbook/`, resulting in navigation errors if hosted at root `/`.

### 1.3 Proposed Implementation & Technical Details
- In `vite.config.ts`:
  ```typescript
  import { defineConfig } from 'vite';
  import react from '@vitejs/plugin-react';
  import { VitePWA } from 'vite-plugin-pwa';

  const basePath = process.env.VITE_BASE_PATH || '/';

  export default defineConfig({
    base: basePath,
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'favicon.svg', 'icons.svg'],
        workbox: {
          cleanupOutdatedCaches: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'google-fonts-stylesheets',
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 60 * 60 * 24 * 365
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        },
        manifest: {
          name: 'LogBook Premium',
          short_name: 'LogBook',
          description: "L'app definitiva per il tracciamento di allenamento, nutrizione e progressi. Funziona anche offline in palestra.",
          theme_color: '#0f172a',
          background_color: '#0f172a',
          display: 'standalone',
          orientation: 'portrait',
          start_url: basePath,
          scope: basePath,
          lang: 'it-IT',
          categories: ['fitness', 'health', 'lifestyle'],
          icons: [
            {
              src: 'icon-192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png'
            },
            {
              src: 'apple-touch-icon.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: 'icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable'
            }
          ]
        }
      })
    ],
    build: {
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/firebase/auth')) return 'firebase-auth';
            if (id.includes('node_modules/firebase/firestore')) return 'firebase-firestore';
            if (id.includes('node_modules/firebase')) return 'firebase-core';
            if (id.includes('chart.js') || id.includes('react-chartjs-2')) return 'chartjs';
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/zustand') || id.includes('node_modules/lucide-react')) return 'vendor';
          }
        }
      }
    }
  });
  ```
- **Key Characteristics**:
  1. Default fallback is `'/'` for root deployments (Firebase Hosting, Vercel, Netlify, Dev).
  2. For GitHub Pages builds, setting `VITE_BASE_PATH='/logbook/'` dynamically overrides `base`, `manifest.start_url`, and `manifest.scope`.
  3. `vitest.config.ts` maintains its standalone test configuration and is completely unaffected.

---

## 2. Requirement R2: Remove `window.confirm` in `ErrorBoundary.tsx`

### 2.1 Current State & Observations
- **File**: `src/components/UI/ErrorBoundary.tsx` (lines 54–62)
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
- **Violations Identified**:
  1. **AGENTS.md Rule 7**: Strict prohibition of native blocking dialogs (`window.confirm()`, `window.alert()`). Mandatory requirement to use `useDialogStore.getState().showConfirm(...)` / `showAlert(...)` rendered via `GlobalDialog.tsx`.
  2. **AGENTS.md Rule 11**: Text casing violation ("Hard Reset (Dati Corrotti)" in Title Case rather than Italian Sentence Case "Hard reset (dati corrotti)").
  3. **Repository-wide Confirmation**: Full grep across `src/` and `tests/` confirmed this is the **single remaining** `window.confirm` in the entire codebase.

### 2.2 Architectural Integration Analysis
- **Dialog Store API (`src/store/useDialogStore.ts`)**:
  - `showConfirm: (message: string, title?: string) => Promise<boolean>`
  - `showAlert: (message: string, title?: string) => Promise<void>`
  - When `showConfirm` is called, it returns a Promise resolving to `true` (if user clicks "Conferma") or `false` (if user clicks "Annulla").
- **Mounting Context & Error Boundary Lifecycle**:
  - In `src/main.tsx`, `ErrorBoundary` is the top-level error boundary wrapping `<AuthProvider>` and `<App />`.
  - During normal app execution, `<GlobalDialog />` is mounted inside `App.tsx` (line 133).
  - When an uncaught exception triggers `ErrorBoundary`, `this.state.hasError === true`, and `this.props.children` (`<AuthProvider><App /></AuthProvider>`) is unmounted and replaced by the error fallback UI.
  - **CRITICAL DISCOVERY**: Because `<App />` is unmounted when `ErrorBoundary` is active, any call to `useDialogStore.getState().showConfirm(...)` would update Zustand state, but the dialog UI would never appear on screen unless `<GlobalDialog />` is also mounted inside `ErrorBoundary`'s fallback UI!
  - Therefore, `<GlobalDialog />` MUST be included directly within `ErrorBoundary`'s fallback render tree.

### 2.3 Proposed Implementation for `ErrorBoundary.tsx`
```tsx
import { Component, ErrorInfo, ReactNode } from 'react';
import { useDialogStore } from '../../store/useDialogStore';
import { GlobalDialog } from './GlobalDialog';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  private handleHardReset = async () => {
    const confirmed = await useDialogStore.getState().showConfirm(
      'Questo cancellerà tutti i dati non sincronizzati con il cloud. Procedere?',
      'Attenzione'
    );
    if (confirmed) {
      window.localStorage.clear();
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '20px',
          background: 'var(--bg-color)',
          color: 'var(--text-main)',
          textAlign: 'center'
        }}>
          <GlobalDialog />
          <h1 style={{ color: 'var(--danger-color)', marginBottom: '10px' }}>Ops, qualcosa è andato storto!</h1>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
            Si è verificato un errore imprevisto. Prova a ricaricare la pagina.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', alignItems: 'center' }}>
            <button 
              className="btn btn-primary" 
              onClick={() => window.location.reload()}
            >
              🔄 Ricarica pagina
            </button>
            <button 
              className="btn" 
              style={{ background: 'transparent', border: '1px solid var(--danger-color)', color: 'var(--danger-color)', fontSize: '0.85rem' }}
              onClick={this.handleHardReset}
            >
              ⚠️ Hard reset (dati corrotti)
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
```

---

## 3. Verification Plan & Test Strategy

1. **Static Analysis & Linting**:
   - Run `oxlint` (`npm.cmd run lint`).
   - Run TypeScript type checking (`tsc --noEmit`).
   - Verify `grep -r "window.confirm" src/` returns 0 results.
2. **Build Verification**:
   - Run `npm.cmd run build` with default environment (`VITE_BASE_PATH` undefined) $\rightarrow$ verify `dist/manifest.webmanifest` contains `"start_url": "/"` and `"scope": "/"`.
   - Run build with `VITE_BASE_PATH=/logbook/` $\rightarrow$ verify `dist/manifest.webmanifest` contains `"start_url": "/logbook/"` and `"scope": "/logbook/"`.
3. **Unit & Component Testing**:
   - Run full Vitest suite (`npm.cmd test`).
   - Create unit tests covering `ErrorBoundary` fallback rendering, dialog trigger via `useDialogStore.getState().showConfirm`, and execution of the hard reset callback.
