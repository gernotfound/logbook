# BRIEFING — 2026-08-23T08:00:00Z

## Mission
Own and update the bootstrap and guest authentication initialization for Milestone M2: Guest Bootstrap & Cold Start Lifecycle.

## 🔒 My Identity
- Archetype: worker_m2
- Roles: implementer, qa, specialist
- Working directory: C:\Users\gerar\Documents\GitHub\logbook\.agents\worker_m2
- Original parent: cdbdb363-4a02-4dfd-a363-8ae65d23773b
- Milestone: M2 (Guest Bootstrap & Cold Start Lifecycle)

## 🔒 Key Constraints
- Pure, genuine implementations only (no hardcoding / cheating).
- Zero empty catalog flashes during guest cold start and lifecycle transitions.
- Synchronous seed catalog fallback and IndexedDB catalog caching.
- Prevent unauthenticated handler from resetting active guest state or wiping cached catalogs.

## Current Parent
- Conversation ID: cdbdb363-4a02-4dfd-a363-8ae65d23773b
- Updated: 2026-08-23T08:00:00Z

## Task Summary
- **What to build**:
  1. In src/main.tsx: Pre-render bootstrap retrieves catalog = await getCachedCatalog() and resolves effective exercises & foods for window.__INITIAL_USER_DATA__.
  2. In src/contexts/AuthContext.tsx: loginAsGuest() resolves exercises and foods against getInMemoryCatalog() / getCachedCatalog() using esolveEffectiveExercises and esolveEffectiveFoods. onAuthStateChanged prevents accidental wiping of guest state.
  3. Tests: 	ests/guest_bootstrap_lifecycle.test.tsx covering cold start, pre-render resolution, guest state preservation, and custom item retention.
- **Success criteria**:
  - 
px.cmd tsc --noEmit passes (0 errors).
  - 
pm.cmd run lint passes (0 errors).
  - 
pm.cmd test tests/guest_bootstrap_lifecycle.test.tsx passes (5/5).
  - 
pm.cmd run build passes.

## Change Tracker
- **Files modified**:
  - src/main.tsx: Pre-render bootstrap retrieves cached catalog and resolves cached user data with delta resolvers before createRoot().render().
  - src/contexts/AuthContext.tsx: In loginAsGuest(), resolves standard catalog items when missing/empty; in onAuthStateChanged, safeguards guest mode from accidental store reset; provides resolved fallback for unauthenticated linking.
  - src/contexts/AuthContextDef.ts: Updated loginAsGuest signature to () => void | Promise<void>.
  - 	ests/guest_bootstrap_lifecycle.test.tsx: Comprehensive test suite for M2 lifecycle.
- **Build status**: PASS
- **Pending issues**: None for M2.

## Quality Status
- **Build/test result**: PASS (TypeScript, Vite Build, Vitest M2 suite)
- **Lint status**: 0 errors
- **Tests added/modified**: 	ests/guest_bootstrap_lifecycle.test.tsx (5 tests covering all M2 requirements).
