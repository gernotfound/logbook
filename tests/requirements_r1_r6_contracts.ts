import { Logic } from '../src/lib/logic';

/* =========================================================================
 * PURE CALCULATION & PAIN PERSISTENCE CONTRACT HELPERS (R1, R2, R6)
 * ========================================================================= */

export const getLatestUserWeightContract = Logic.getLatestUserWeight;
export const calculateEffectiveSetWeightContract = Logic.calculateEffectiveSetWeight;
export const calculateSetVolumeContract = Logic.calculateSetVolume;
export const calculateWorkoutVolumeContract = Logic.calculateWorkoutVolume;

// Share the real calculator invoked by CustomFoodForm; never reimplement it in a test.
export { calculateCustomFoodKcal as calculateRealtimeKcalContract } from '../src/lib/nutrition/calculateCustomFoodKcal';

export function mergeActivePainsContract(
    activePains: string[] = [],
    _sessionExercises: Array<{ exId?: string }> = [],
    _library: Array<{ id: string; muscles?: string[] }> = [],
    sessionPains: string[] = []
): string[] {
    return Logic.mergeActivePains(activePains, sessionPains);
}
