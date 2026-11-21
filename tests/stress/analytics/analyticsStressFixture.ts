import type { Exercise } from '../../../src/types';

export const testLibrary: Exercise[] = [
        { id: 'ex_bench', name: 'Panca piana', muscles: ['chest_upper'], trackingType: 'weight_reps', setsCount: 3, sets: [] },
        { id: 'ex_squat', name: 'Squat con bilanciere', muscles: ['quads'], trackingType: 'weight_reps', equipmentWeight: 20, setsCount: 3, sets: [] },
        { id: 'ex_pullup', name: 'Trazioni alla sbarra', muscles: ['lats'], trackingType: 'weight_reps', isBodyweight: true, setsCount: 3, sets: [] },
        { id: 'ex_dip', name: 'Dip alle parallele', muscles: ['chest_upper', 'triceps'], trackingType: 'weight_reps', isBodyweight: true, equipmentWeight: 5, setsCount: 3, sets: [] },
        { id: 'ex_plank', name: 'Plank', muscles: ['abs'], trackingType: 'time', setsCount: 3, sets: [] },
        { id: 'ex_run', name: 'Corsa', muscles: ['quads'], trackingType: 'cardio', setsCount: 1, sets: [] }
    ];
