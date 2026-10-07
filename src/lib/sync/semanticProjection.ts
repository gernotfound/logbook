export type {
    FieldStamp,
    SemanticOperation,
    SyncMeta,
    VectorClock,
} from './semanticProjection/contracts';

export {
    coversVectorClock,
    mergeVectors,
    parseSemanticOperation,
    parseSyncMeta,
    parseVectorClock,
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
