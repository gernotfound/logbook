import { Logic } from '../src/lib/logic';

/* =========================================================================
 * PURE CALCULATION & PAIN PERSISTENCE CONTRACT HELPERS (R1, R2, R6)
 * ========================================================================= */

export const getLatestUserWeightContract = Logic.getLatestUserWeight;
export const calculateEffectiveSetWeightContract = Logic.calculateEffectiveSetWeight;
export const calculateSetVolumeContract = Logic.calculateSetVolume;
export const calculateWorkoutVolumeContract = Logic.calculateWorkoutVolume;

export function calculateRealtimeKcalContract(carbs: any, pro: any, fat: any): number {
    const c = typeof carbs === 'number' ? carbs : parseFloat(String(carbs || '0').trim().replace(',', '.')) || 0;
    const p = typeof pro === 'number' ? pro : parseFloat(String(pro || '0').trim().replace(',', '.')) || 0;
    const f = typeof fat === 'number' ? fat : parseFloat(String(fat || '0').trim().replace(',', '.')) || 0;
    return Math.round(c * 4 + p * 4 + f * 9);
}

export function mergeActivePainsContract(
    activePains: string[] = [],
    _sessionExercises: Array<{ exId?: string }> = [],
    _library: Array<{ id: string; muscles?: string[] }> = [],
    sessionPains: string[] = []
): string[] {
    return Logic.mergeActivePains(activePains, sessionPains);
}
