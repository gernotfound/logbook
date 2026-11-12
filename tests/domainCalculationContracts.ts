import { Logic } from '../src/lib/logic';

/* =========================================================================
 * SHARED PRODUCTION CALCULATION & PAIN PERSISTENCE CONTRACT HELPERS
 * ========================================================================= */

export const getLatestUserWeightContract = Logic.getLatestUserWeight;
export const calculateEffectiveSetWeightContract = Logic.calculateEffectiveSetWeight;
export const calculateSetVolumeContract = Logic.calculateSetVolume;
export const calculateWorkoutVolumeContract = Logic.calculateWorkoutVolume;

// Share the real calculator invoked by CustomFoodForm; never reimplement it in a test.
export { calculateCustomFoodKcal as calculateRealtimeKcalContract } from '../src/lib/nutrition/calculateCustomFoodKcal';

export const mergeActivePainsContract = Logic.mergeActivePains;
