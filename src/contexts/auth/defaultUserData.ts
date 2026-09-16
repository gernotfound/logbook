import type { UserData } from '../../types';
import { getInMemoryCatalog } from '../../lib/catalog/catalogService';
import { resolveEffectiveExercises, resolveEffectiveFoods } from '../../lib/catalog/deltaResolver';
import { createDefaultNutritionPlanning } from '../../lib/nutritionDefaults';

const defaultUserData: UserData = {
    profile: {},
    library: [],
    routines: [],
    history: [],
    nutrition: {},
    customFoods: [],
    catalogOverrides: {},
    activeWorkout: null,
    trainingCycles: [],
    activeCycleId: null,
    nutritionPlanning: createDefaultNutritionPlanning(),
    nutritionPlanningOrigin: 'generated-default',
    supplements: [],
    activePains: [],
    legalConsent: undefined
};

export const getResolvedDefaultUserData = (catalog = getInMemoryCatalog()): UserData => ({
    ...defaultUserData,
    library: resolveEffectiveExercises(catalog.exercises, [], {}),
    customFoods: resolveEffectiveFoods(catalog.foods, [], {}),
    catalogOverrides: {
        exercises: {},
        foods: {},
        hiddenExerciseIds: [],
        hiddenFoodIds: []
    }
});
