import equal from 'fast-deep-equal';
import type { RetiredConflictKind, RetiredReplicaConflictCapsule } from './retiredReplicaConflictRecord';
import { previewRetiredReplicaConflictResolution } from './retiredReplicaConflictResolution';

export type RetiredReplicaConflictDecision = {
    kind: RetiredConflictKind;
    entityId: string;
    choice: 'device' | 'cloud' | 'combined';
};

/** A choice is only an owner-local preference tied to immutable alternatives. */
export function parseRetiredReplicaConflictDecisions(
    raw: unknown, capsule?: RetiredReplicaConflictCapsule,
): RetiredReplicaConflictDecision[] | undefined {
    if (raw === undefined) return undefined;
    if (!capsule || !Array.isArray(raw) || raw.length > capsule.entries.length) {
        throw new Error('Scelte di conflitto senza originali autenticati: archivio preservato.');
    }
    const entries = new Set(capsule.entries.map(entry => `${entry.kind}:${entry.entityId}`));
    const combinable = new Set(previewRetiredReplicaConflictResolution(capsule)
        .filter(draft => draft.kind === 'automatic-candidate')
        .map(draft => `${draft.entityKind}:${draft.entityId}`));
    const seen = new Set<string>();
    const result: RetiredReplicaConflictDecision[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)
            || Object.keys(item).sort().join(',') !== 'choice,entityId,kind'
            || typeof item.kind !== 'string' || typeof item.entityId !== 'string'
            || !['device', 'cloud', 'combined'].includes(String(item.choice))) {
            throw new Error('Scelta di conflitto non valida: archivio preservato.');
        }
        const choice = item as RetiredReplicaConflictDecision;
        const key = `${choice.kind}:${choice.entityId}`;
        if (!entries.has(key) || seen.has(key) || (choice.choice === 'combined' && !combinable.has(key))) {
            throw new Error('Scelta di conflitto non verificabile: archivio preservato.');
        }
        seen.add(key);
        result.push({ kind: choice.kind, entityId: choice.entityId, choice: choice.choice });
    }
    if (!equal(raw, result)) throw new Error('Scelte di conflitto non conservabili senza perdita.');
    return result;
}
