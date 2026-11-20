import { getSeedCatalog } from '../../../src/lib/catalog/catalogService';
import type { Exercise } from '../../../src/types';

// The seed catalog omits editable workout fields required by the Exercise type.
export const asUserExercises = (entries: ReturnType<typeof getSeedCatalog>['exercises']): Exercise[] =>
    entries.map(item => ({ ...item, setsCount: item.setsCount ?? 3, sets: [] }));
