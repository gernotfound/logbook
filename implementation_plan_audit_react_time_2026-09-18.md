# Remediation plan — residual React/time audit findings

Base SHA: `4def1190f04a513f656cb1d4c1a1fc97f7b4527c`

## Scope

This lot addresses only residual audit findings that remain reproducible on the current `main` and share the same time/reactivity boundary:

- **DEF-11** — `WorkoutTimer` still mirrors derived display state from an effect and uses `setInterval`, despite the repository invariant requiring timestamp-derived elapsed time without a pure interval loop.
- **DEF-12** — `useHomeView` reads `Date.now()` inside a memo whose dependencies exclude time, so the fatigue view can become stale without any store mutation.

DEF-17 (UTC `toISOString()` in analytics test fixtures) is verified separately and will be handled in a dedicated test-only lot so this runtime change stays minimal. Other residual audit findings remain classification work and are not included here.

## Root causes

1. `WorkoutTimer` stores both the persisted timer snapshot and a second derived display string. Synchronizing the second state in an effect creates unnecessary state propagation and the repaint loop is implemented with `setInterval`.
2. Home fatigue is a function of persisted workout timestamps **and wall-clock time**, but wall-clock time is not represented as reactive state. `useMemo` therefore caches a time-sensitive result indefinitely until unrelated data changes.

## Implementation

- Keep the persisted timer snapshot as the timer source of truth.
- Replace the display-string state with a lightweight clock state and derive the rendered string from snapshot + clock.
- Drive timer repaints through a self-scheduling `setTimeout` and foreground visibility refresh; no synchronous state write in the effect body and no `setInterval`.
- Add a minute-resolution foreground clock to `useHomeView`; include it in the fatigue/volume memo dependency so elapsed-time classifications age correctly without store writes.
- Add deterministic regression tests using fake timers for both boundaries.

## Verification

- Targeted timer/home regression tests.
- Full canonical gate: `npm run verify:m8` on the exact candidate SHA.
- Final PR diff review before merge.
- Post-merge `Milestone Verification` / `Canonical Verification` on the resulting `main` SHA.
- Production Vercel deployment must be `READY` and reference the same `main` SHA.

## Deployment invariant

`vercel.json` is already configured with `main: true` and `"**": false`. This branch must not produce a Vercel Preview Deployment.

## Rollback

The change is isolated to timer/home time reactivity plus regression coverage. A revert restores the previous rendering behavior without data migration or schema changes.
