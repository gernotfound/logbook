# Challenge Report — M4 Edge Case & Stress Verification

## Challenge Summary

**Overall risk assessment**: LOW

Empirical testing was conducted across zero-quantity inputs, missing user profile data, midnight date boundary cases, timer tick behavior, and component boundary states. A total of 50 test cases were executed using `vitest`. The application demonstrates high overall robustness and graceful boundary handling, with two minor edge-case findings identified.

---

## Challenges

### [Low] Challenge 1: Invalid Date String in User Profile DOB Returns String `'NaN'`

- **Assumption challenged**: Assumes `profile.dob` is either missing/null or a valid ISO date string (e.g., `'1995-01-01'`).
- **Attack scenario**: If a user enters an unparseable or corrupted date string in `profile.dob` (e.g., `'invalid-date'`), `new Date(profile.dob).getTime()` returns `NaN`. `Logic.calculateBodyFat` does not validate `isNaN(dobDate.getTime())`, leading to `age` being `NaN`, `bf` being `NaN`, and returning the string `'NaN'` instead of `null`.
- **Blast radius**: Display components showing body fat calculation may render the string `'NaN'` instead of falling back to a null/hidden display state.
- **Mitigation**: Add a check `if (isNaN(dobDate.getTime())) return null;` in `Logic.calculateBodyFat` in `src/lib/logic.ts`.

### [Low] Challenge 2: Missing `normocalorica` Sub-object in `userData.nutritionPlanning` Causes `TypeError`

- **Assumption challenged**: Assumes `userData.nutritionPlanning` always includes the nested `normocalorica` object (`{ kcal, carbs, pro, fat }`).
- **Attack scenario**: If `userData.nutritionPlanning` exists in Firestore or Zustand state but is missing the `normocalorica` property (e.g., partial migration or corrupted payload `{ weight: 80 }`), `useNutritionPlanning` initializes `planning` with `userData.nutritionPlanning`. When `NutritionPlanning.tsx` attempts to render `<input value={planning.normocalorica.kcal} />`, a runtime `TypeError` is thrown.
- **Blast radius**: `NutritionPlanning` component crashes when rendering if `normocalorica` property is absent.
- **Mitigation**: Use optional chaining or safe fallback initialization in `useNutritionPlanning`: `normocalorica: userData.nutritionPlanning.normocalorica || { kcal: 2500, carbs: 300, pro: 160, fat: 70 }`.

---

## Stress Test Results

| Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|
| Food scaling with `quantity = 0` or negative | Returns zeroed nutrients object, no NaN or crash | `{ kcal: 0, carbs: 0, pro: 0, fat: 0, ... }` | PASS |
| Macro calculation with `weight = 0` or ratios = 0 | Returns zeroed macros, no divide-by-zero | `{ totalKcal: 0, carbsGrams: 0, ... }` | PASS |
| `Logic.calculateMacroRatio(100, 0)` with 0 fat | Returns `ratioKcal: Infinity` and `ratioString: 'N/A'` | `{ ratioKcal: Infinity, ratioString: 'N/A' }` | PASS |
| `Logic.calculateNormocaloricaDiff` with 0 target | Guards against division by zero, returns `0.0%` | `{ kcalPct: 0, formatted: '0.0%' }` | PASS |
| `Logic.calculateBodyFat` with null profile | Returns `null` safely | `null` | PASS |
| `Logic.calculateBodyFat` with invalid DOB | Returns `null` | Returns string `'NaN'` | FAIL (Low Risk) |
| Render `NutritionPlanning` with missing `normocalorica` | Renders with defaults or empty inputs | Throws `TypeError: Cannot read properties of undefined (reading 'kcal')` | FAIL (Low Risk) |
| Midnight date formatting (`00:00:00` vs `23:59:59`) | Properly formats `YYYY-MM-DD` | `2026-07-26` / `2026-12-31` / `2027-01-01` | PASS |
| Month boundary grid generation (Dec 31 to Jan 1) | Generates valid grid containing transition days | 35+ cells including `2026-12-31` and `2027-01-01` | PASS |
| Workout timer duration > 1 hour | Displays `HH:MM:SS` format (e.g. `01:02:16`) | `01:02:16` | PASS |
| Workout timer rest controls play/pause/reset/stop | Ticks rest duration without memory leak or state crash | State transitions cleanly, rest display updates | PASS |
| Food search query with regex special chars `[.*+?^$]` | Filters food items without throwing regex syntax error | Filters string cleanly using `normalize()` | PASS |
| Active workout with empty sets array `sets: []` | Renders workout session card without error | Renders exercise name and empty set table | PASS |
| `MuscleModel` with invalid or null `targetMuscle` | Handles unknown ID gracefully, renders empty/default model | Renders SVG safely without crash | PASS |

---

## Unchallenged Areas

- **Network latency & offline sync retry loops**: Simulated locally via mock DB service; physical network disconnection during active Firebase sync not tested in live browser.
- **Service worker registration on mobile browser PWA engine**: Unit/render tests operate under Vitest JSDOM environment; native mobile PWA lifecycle un-tested directly in JSDOM.
