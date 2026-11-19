import type { Exercise } from '../../types';

export const mockLibrary: Exercise[] = [
    { id: 'ex_bench', name: 'Panca piana', muscles: ['petto'], trackingType: 'weight_reps', setsCount: 3, sets: [] },
    { id: 'ex_squat', name: 'Squat con bilanciere', muscles: ['quadricipiti'], trackingType: 'weight_reps', equipmentWeight: 20, setsCount: 3, sets: [] },
    { id: 'ex_pullup', name: 'Trazioni alla sbarra', muscles: ['dorso'], trackingType: 'weight_reps', isBodyweight: true, setsCount: 3, sets: [] },
    { id: 'ex_dips', name: 'Dip alle parallele', muscles: ['petto', 'tricipiti'], trackingType: 'weight_reps', isBodyweight: true, equipmentWeight: 0, setsCount: 3, sets: [] },
    { id: 'ex_plank', name: 'Plank addominale', muscles: ['addome'], trackingType: 'time', setsCount: 3, sets: [] },
    { id: 'ex_run', name: 'Corsa tapis roulant', muscles: ['gambe'], trackingType: 'cardio', setsCount: 1, sets: [] }
];
