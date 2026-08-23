# Architectural Survey Report: R1 & R2 Investigation

**Explorer**: Survey Explorer 1  
**Date**: 2026-08-20  
**Repository**: `gernotfound/logbook`  
**Target Scope**: 
- **R1**: Volume Calculation for Bodyweight & Equipment Base Exercises (Data Model, Schemas, Calculation Functions, User Weight Retrieval, Library UI).
- **R2**: Automatic Real-Time Calorie Calculation in Food Forms ($4 \times \text{Carbo} + 4 \times \text{Pro} + 9 \times \text{Grassi}$).

---

## 1. Executive Summary

This investigation surveys all architectural layers involved in implementing **R1** and **R2** according to the project specifications (`AGENTS.md` and `ORIGINAL_REQUEST.md`).

1. **R1 (Bodyweight & Equipment Weight Volume Calculation)**:
   - Modifies `Exercise` in `src/types.ts` to include optional properties `isBodyweight?: boolean` and `equipmentWeight?: number`.
   - Protects runtime integrity via `safeOptionalBoolean()` and `safeOptionalNumber()` in `src/lib/schema.ts` (`ExerciseSchema`).
   - Complies with the 5-step checklist in `AGENTS.md` across `types.ts`, `schema.ts`, `db.ts`, `AuthContext.tsx`, and `export.ts`.
   - Introduces pure calculation functions in `src/lib/calc/workout.ts` (`calculateEffectiveSetWeight`, `calculateSetVolume`, `calculateWorkoutVolume`, `getLatestUserWeight`) and re-exports them through `Logic` in `src/lib/logic.ts`.
   - Extends the Exercise Library creation/editing UI (`TrainingExercises.tsx`, `useTrainingExercises.ts`) with dedicated inputs and draft persistence in `localStorage`.
2. **R2 (Real-Time Automatic Food Calorie Calculation)**:
   - Enhances `CustomFoodForm.tsx` (utilized in both `NutritionMeals.tsx` and `NutritionFoodArchive.tsx`) with a real-time reactive macro handler.
   - Calculates $\text{kcal} = \text{Math.round}((\text{Carbo} \times 4) + (\text{Pro} \times 4) + (\text{Grassi} \times 9))$ whenever carbs, protein, or fat inputs change.
   - Satisfies the exact acceptance criterion: $10\text{g Carbo} + 10\text{g Pro} + 10\text{g Grassi} \implies 170\text{ kcal}$.

---

## 2. Detailed Investigation: R1 (Bodyweight & Equipment Volume)

### 2.1 Data Model & Types (`src/types.ts`)
- **Location**: `src/types.ts:49-60`
- **Current State**:
  ```ts
  export interface Exercise {
      id: string;
      name: string;
      notes?: string;
      setsCount: number;
      muscles?: string[];
      secondaryMuscles?: string[];
      sets: ExerciseSet[];
      trackingType?: 'weight_reps' | 'time' | 'cardio';
      isDefault?: boolean;
  }
  ```
- **Required Extension**:
  ```ts
  export interface Exercise {
      id: string;
      name: string;
      notes?: string;
      setsCount: number;
      muscles?: string[];
      secondaryMuscles?: string[];
      sets: ExerciseSet[];
      trackingType?: 'weight_reps' | 'time' | 'cardio';
      isDefault?: boolean;
      isBodyweight?: boolean;
      equipmentWeight?: number;
  }
  ```

---

### 2.2 Schema & Defensive Zod Gateway (`src/lib/schema.ts`)
- **Location**: `src/lib/schema.ts:146-157`
- **Current State**:
  ```ts
  export const ExerciseSchema = z.object({
      id: safeString(''),
      name: safeString(''),
      notes: safeOptionalString(),
      setsCount: safeNumber(0),
      muscles: z.array(safeString('')).optional().catch([]).default([]),
      secondaryMuscles: z.array(safeString('')).optional().catch([]).default([]),
      sets: z.array(ExerciseSetSchema).catch([]).default([]),
      trackingType: z.enum(['weight_reps', 'time', 'cardio']).optional().catch(undefined),
      isDefault: safeOptionalBoolean(),
  }).passthrough().catch({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] }).default({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] });
  ```
- **Required Extension**:
  ```ts
  export const ExerciseSchema = z.object({
      id: safeString(''),
      name: safeString(''),
      notes: safeOptionalString(),
      setsCount: safeNumber(0),
      muscles: z.array(safeString('')).optional().catch([]).default([]),
      secondaryMuscles: z.array(safeString('')).optional().catch([]).default([]),
      sets: z.array(ExerciseSetSchema).catch([]).default([]),
      trackingType: z.enum(['weight_reps', 'time', 'cardio']).optional().catch(undefined),
      isDefault: safeOptionalBoolean(),
      isBodyweight: safeOptionalBoolean(),
      equipmentWeight: safeOptionalNumber(),
  }).passthrough().catch({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] }).default({ id: '', name: '', setsCount: 0, muscles: [], secondaryMuscles: [], sets: [] });
  ```
- **Resilience Analysis**:
  - `safeOptionalBoolean()` converts `'true'`, `'1'`, `1`, `true` to `true`, and gracefully drops invalid/empty types without throwing.
  - `safeOptionalNumber()` strips whitespace, converts strings to float, ignores `NaN`, and assigns `undefined` if missing.
  - Existing `DomainParsers.parseLibrary` in `src/lib/schema.ts:397-405` uses `ExerciseSchema.safeParse`, preserving valid exercises and their new properties.

---

### 2.3 Storage, Persistence & Merge Alignment (`src/lib/db.ts`, `src/lib/merge.ts`, `src/contexts/AuthContext.tsx`, `src/lib/export.ts`)
1. **`src/lib/db.ts`**:
   - `DB.loadUserData` (lines 54-60): `library` is loaded from the root doc `users/{uid}` and merged with `defaultExercises`.
   - `DB.saveUserData` (lines 174-200): `state.library` is compared with `oldState.library` via `deepEqual` and written to `userDocData`. `removeUndefinedValues` strips any `undefined` values, preventing Firestore rejection.
2. **`src/lib/merge.ts`**:
   - `mergeArrayById` (lines 15-44) handles `library` merge on Google login/link: items are deduplicated by `id`, and guest modifications take precedence.
3. **`src/contexts/AuthContext.tsx`**:
   - `defaultUserData.library` (line 19) uses `defaultExercises`.
4. **`src/lib/export.ts`**:
   - `Exporter.exportToCSV` (lines 5-60) maps workout sets. If needed, can include exercise tare notes or keep pure logged kg.

---

### 2.4 User Bodyweight Retrieval Strategy
- **Locations in Codebase**:
  - `src/hooks/useHomeView.ts:334-341`
  - `src/hooks/useNutritionMeals.ts:39-48`
  - `src/hooks/useNutritionPlanning.ts:21-44`
- **Pattern**:
  - Nutrition dates are sorted chronologically: `Object.keys(nutrition).sort((a,b) => new Date(a).getTime() - new Date(b).getTime())`.
  - The latest non-empty `nutrition[d].weight` is used.
  - Fallback: `nutritionPlanning?.weight || 80`.
- **Dedicated Helper Proposed in `src/lib/calc/workout.ts`**:
  ```ts
  export function getLatestUserWeight(
      nutrition?: Record<string, any> | null,
      nutritionPlanning?: { weight?: number | string } | null
  ): number {
      let latestWeight: number | null = null;
      if (nutrition && typeof nutrition === 'object') {
          const dates = Object.keys(nutrition).sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
          for (const d of dates) {
              const day = nutrition[d];
              if (day && day.weight !== undefined && day.weight !== null && day.weight !== '') {
                  const num = parseFloat(String(day.weight));
                  if (!isNaN(num) && num > 0) {
                      latestWeight = num;
                  }
              }
          }
      }
      if (latestWeight !== null) return latestWeight;
      if (nutritionPlanning?.weight) {
          const planWeight = parseFloat(String(nutritionPlanning.weight));
          if (!isNaN(planWeight) && planWeight > 0) return planWeight;
      }
      return 80;
  }
  ```

---

### 2.5 Volume Calculation Logic (`src/lib/calc/workout.ts`, `src/lib/logic.ts`)
- **Mathematical Specification**:
  - For a single set (or dropset/isometric):
    $$\text{effectiveWeight} = \text{baseKg} + (\text{isBodyweight} ? \text{userBodyweight} : 0) + (\text{equipmentWeight} \text{ or } 0)$$
    $$\text{setVolume} = \text{effectiveWeight} \times \text{reps}$$
  - For a set with dropsets:
    $$\text{totalSetVolume} = (\text{effectiveWeight} \times \text{reps}) + \sum_{ds} (\text{effectiveDropsetWeight} \times \text{dsReps})$$
- **Proposed Functions in `src/lib/calc/workout.ts`**:
  ```ts
  export interface VolumeExerciseRef {
      isBodyweight?: boolean;
      equipmentWeight?: number;
  }

  export function calculateEffectiveSetWeight(
      setKg: string | number | undefined | null,
      exercise?: VolumeExerciseRef | null,
      userWeight: number = 80
  ): number {
      const baseKg = parseFloat(String(setKg ?? '')) || 0;
      const bw = (exercise?.isBodyweight && userWeight > 0) ? userWeight : 0;
      const eq = (exercise?.equipmentWeight && exercise.equipmentWeight > 0) ? exercise.equipmentWeight : 0;
      return baseKg + bw + eq;
  }

  export function calculateSetVolume(
      set: {
          kg?: string | number;
          reps?: string | number;
          dropsets?: Array<{ kg?: string | number; reps?: string | number }>;
      },
      exercise?: VolumeExerciseRef | null,
      userWeight: number = 80
  ): number {
      if (!set) return 0;
      const reps = parseInt(String(set.reps ?? ''), 10) || 0;
      const effectiveWeight = calculateEffectiveSetWeight(set.kg, exercise, userWeight);
      let volume = effectiveWeight * reps;

      if (Array.isArray(set.dropsets)) {
          for (const ds of set.dropsets) {
              const dsReps = parseInt(String(ds.reps ?? ''), 10) || 0;
              const dsEffectiveWeight = calculateEffectiveSetWeight(ds.kg, exercise, userWeight);
              volume += dsEffectiveWeight * dsReps;
          }
      }
      return volume;
  }

  export function calculateWorkoutVolume(
      session: { exercises?: Array<{ exId?: string; sets?: any[] }> },
      library: Array<{ id: string; isBodyweight?: boolean; equipmentWeight?: number }> = [],
      userWeight: number = 80
  ): number {
      if (!session || !Array.isArray(session.exercises)) return 0;
      const libMap = new Map<string, VolumeExerciseRef>();
      library.forEach(ex => {
          if (ex?.id) libMap.set(ex.id, ex);
      });

      let totalVolume = 0;
      for (const ex of session.exercises) {
          if (!ex) continue;
          const libEx = ex.exId ? libMap.get(ex.exId) : null;
          for (const s of (ex.sets || [])) {
              totalVolume += calculateSetVolume(s, libEx, userWeight);
          }
      }
      return totalVolume;
  }
  ```

---

### 2.6 Exercise Library UI & Form Components
- **Files**:
  - `src/components/Training/TrainingExercises.tsx`
  - `src/hooks/useTrainingExercises.ts`
- **UI Extension in `TrainingExercises.tsx`**:
  - In the exercise editor card, when `trackingType === 'weight_reps'`:
    1. A styled checkbox / switch for `isBodyweight`: "Corpo libero (somma il peso corporeo al volume)".
    2. A numeric input for `equipmentWeight`: "Peso base attrezzo (es. bilanciere 20kg)".
  - In the exercise card list view:
    - Display tags when expanded:
      - `{ex.isBodyweight && <span className="badge badge-primary">Corpo libero</span>}`
      - `{ex.equipmentWeight && <span className="badge badge-secondary">Attrezzo: {ex.equipmentWeight} kg</span>}`
- **Hook Extension in `useTrainingExercises.ts`**:
  - Add state variables: `const [isBodyweight, setIsBodyweight] = useState(false);` and `const [equipmentWeight, setEquipmentWeight] = useState('');`.
  - Update `handleEditClick`: load `ex.isBodyweight` and `ex.equipmentWeight`.
  - Update `handleCancelEdit`: reset `isBodyweight` to `false`, `equipmentWeight` to `''`.
  - Update `handleSaveExercise`: save `isBodyweight: isBodyweight || undefined` and `equipmentWeight: equipmentWeight ? parseFloat(equipmentWeight) : undefined`.
  - Update draft persistence (`draft_exercise` in `localStorage`): include `isBodyweight` and `equipmentWeight`.

---

## 3. Detailed Investigation: R2 (Real-Time Automatic Food Calories)

### 3.1 Component Architecture & Form Flow
- **Primary Form Component**: `src/components/Nutrition/CustomFoodForm.tsx`
- **Consumers**:
  1. `src/components/Nutrition/NutritionMeals.tsx` (via `useNutritionMeals.ts`)
  2. `src/components/Nutrition/NutritionFoodArchive.tsx` (internal state)
- **Current Behavior**:
  - In `CustomFoodForm.tsx` lines 92-144, the inputs for `kcal`, `pro`, `carbs`, and `fat` are bound to `cfData.kcal`, `cfData.pro`, `cfData.carbs`, `cfData.fat`.
  - Each input updates only its own field: `onChange={e => setCfData({...cfData, [field]: e.target.value})}`.
  - The user has to manually compute Kcal or leave it blank.

---

### 3.2 Real-Time Calculation Logic & Implementation
- **Formula**:
  $$\text{Kcal} = \text{Math.round}((\text{Carboidrati} \times 4) + (\text{Proteine} \times 4) + (\text{Grassi} \times 9))$$
- **Implementation in `CustomFoodForm.tsx`**:
  ```tsx
  const handleMacroChange = (field: 'carbs' | 'pro' | 'fat', value: string) => {
      const updated = { ...cfData, [field]: value };
      const c = parseFloat(field === 'carbs' ? value : updated.carbs) || 0;
      const p = parseFloat(field === 'pro' ? value : updated.pro) || 0;
      const f = parseFloat(field === 'fat' ? value : updated.fat) || 0;
      
      const autoKcal = Math.round((c * 4) + (p * 4) + (f * 9));
      
      // Auto-populate kcal in real-time
      const hasAnyMacro = Boolean(
          (field === 'carbs' ? value : updated.carbs) ||
          (field === 'pro' ? value : updated.pro) ||
          (field === 'fat' ? value : updated.fat)
      );
      updated.kcal = hasAnyMacro ? String(autoKcal) : '';
      
      setCfData(updated);
  };
  ```
- **Acceptance Criteria Verification**:
  - If user types `10` in Carbo, `10` in Pro, `10` in Grassi:
    $$\text{Kcal} = 10 \times 4 + 10 \times 4 + 10 \times 9 = 40 + 40 + 90 = 170$$
    `cfData.kcal` automatically updates to `"170"`.
  - If user wants to manually fine-tune Kcal (e.g. from an official nutrition label with fiber adjustments), the Kcal input field remains editable directly.

---

## 4. Integration Points, Backwards Compatibility & Risk Analysis

| Area | Impact / Risk | Mitigation Strategy |
|---|---|---|
| **Zod Schema Gateway** | Existing library items in Firestore / IndexedDB lack `isBodyweight` and `equipmentWeight`. | Schema uses `.optional().catch(undefined)`. Missing fields gracefully default to `undefined` without corrupting user data. |
| **Firestore Payload Sanitization** | `undefined` properties cause Firestore batch writes to fail. | `removeUndefinedValues` in `db.ts` strips `undefined` before `writeBatch`. |
| **Number & String Coercion** | Users may enter non-numeric characters, commas (`10,5`), or leave inputs blank. | Parse with `parseFloat(String(val).replace(',', '.'))` and fallback safely to 0. |
| **Draft Persistence in LocalStorage** | Corrupted draft payloads on app restore. | Wrapped in `try-catch` with safe schema parsing in `useTrainingExercises.ts`. |
| **Guest to Cloud Merge** | Merging local exercises with remote cloud exercises. | `mergeArrayById` in `merge.ts` deduplicates by `id`, ensuring newly configured attributes are preserved. |

---

## 5. Verification & Test Plan

1. **Unit Tests (`src/lib/logic.test.ts`)**:
   - Test `calculateEffectiveSetWeight`:
     - Normal exercise with 50 kg $\implies 50$.
     - `isBodyweight: true` with 0 kg and 80 kg user $\implies 80$.
     - `isBodyweight: true` with +10 kg ballast and 80 kg user $\implies 90$.
     - `equipmentWeight: 20` with 60 kg $\implies 80$.
     - `isBodyweight: true` + `equipmentWeight: 5` + 0 kg with 75 kg user $\implies 80$.
   - Test `calculateSetVolume`:
     - 0 kg $\times$ 10 reps on bodyweight exercise (80 kg user) $\implies 800$.
     - Regular set + dropset volume calculation.
   - Test `calculateDailyCalories` / `validateCustomFood`:
     - 10g Carbs, 10g Pro, 10g Fat $\implies 170$ kcal.
2. **Schema Resilience Tests (`tests/schema_resilience.test.ts`)**:
   - Verify `ExerciseSchema.parse({ isBodyweight: 'true', equipmentWeight: '20' })` coerces to `{ isBodyweight: true, equipmentWeight: 20 }`.
   - Verify `ExerciseSchema.parse({ isBodyweight: null, equipmentWeight: 'invalid' })` falls back to `{ isBodyweight: undefined, equipmentWeight: undefined }`.
3. **Component Interaction Tests**:
   - Render `CustomFoodForm` inside test harness: change carbs to 10, pro to 10, fat to 10, assert `input#cf-kcal` displays `170`.
   - Render `TrainingExercises`: toggle bodyweight checkbox, save exercise, assert `library` in Zustand contains `isBodyweight: true`.

---
