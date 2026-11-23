import type { Exercise } from '../types';
import type { DomainOperation } from './sync/domainOperations';
import { generateUniqueName } from './utils/string';

export function buildExerciseDuplicateOperation(
    source: Exercise, library: readonly Exercise[], id: string,
): DomainOperation {
    return {
        type: 'exercise.upsert',
        exercise: {
            ...structuredClone(source),
            id,
            name: generateUniqueName(source.name, library.map(exercise => exercise.name)),
            isDefault: false,
        },
    };
}
