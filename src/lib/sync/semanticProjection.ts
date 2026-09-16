export type {
    FieldStamp,
    MergePolicy,
    SemanticOperation,
    StampLike,
    SyncMeta,
    VectorClock,
} from './semanticProjection/contracts';

export {
    dominates,
    fieldKey,
    mergeVectors,
    parseSyncMeta,
    stampWins,
} from './semanticProjection/metadata';

export {
    getMergePolicy,
    resolveIdentity,
} from './semanticProjection/policy';

export { diffDocuments } from './semanticProjection/diff';

export {
    applySemanticOperations,
    normalizeDomainData,
} from './semanticProjection/apply';
