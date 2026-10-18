import type { DocumentData } from './documentProjection';
import type { SemanticOperation, VectorClock } from './semanticProjection';

/** Retain original operation order and append parent tombstones in document/entity order. */
export function enforceMonthlyEntityTombstones(
    baseDocs: Map<string, DocumentData>, desiredDocs: Map<string, DocumentData>, input: SemanticOperation[],
    actorId: string, seq: number, clock: VectorClock,
): SemanticOperation[] {
    const removed = new Map<string, Set<string>>();
    const tombstones: SemanticOperation[] = [];
    const paths = new Set([...baseDocs.keys(), ...desiredDocs.keys()]);
    for (const docPath of paths) {
        if (!docPath.startsWith('history_months/') && !docPath.startsWith('nutrition_months/')) continue;
        const baseDoc = baseDocs.get(docPath) ?? {};
        const desiredDoc = desiredDocs.get(docPath) ?? {};
        for (const entityId of Object.keys(baseDoc)) {
            if (Object.hasOwn(desiredDoc, entityId)) continue;
            const ids = removed.get(docPath) ?? new Set<string>();
            ids.add(entityId);
            removed.set(docPath, ids);
            tombstones.push({ docPath, path: [entityId], isDelete: true, actorId, seq, clock });
        }
    }
    return [...input.filter(op => !removed.get(op.docPath)?.has(op.path[0])), ...tombstones];
}
