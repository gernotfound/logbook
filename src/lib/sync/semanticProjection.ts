export type {
    FieldStamp,
    MergePolicy,
    ReplicaWriter,
    SemanticOperation,
    StampLike,
    SyncMeta,
    VectorClock,
} from './semanticProjection/contracts';

export {
    compareStamps,
    coversVectorClock,
    dominates,
    fieldKey,
    mergeVectors,
    parseSemanticOperation,
    parseSyncMeta,
    parseVectorClock,
    pathFromFieldKey,
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
