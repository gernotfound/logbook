import { Logic } from '../src/lib/logic';

/* =========================================================================
 * SHARED PRODUCTION CALCULATION & PAIN PERSISTENCE CONTRACT HELPERS
 * ========================================================================= */

export const getLatestUserWeightContract = Logic.getLatestUserWeight;
export const calculateEffectiveSetWeightContract = Logic.calculateEffectiveSetWeight;
export const calculateSetVolumeContract = Logic.calculateSetVolume;
export const calculateWorkoutVolumeContract = Logic.calculateWorkoutVolume;

export const mergeActivePainsContract = Logic.mergeActivePains;
