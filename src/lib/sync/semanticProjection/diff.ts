import equal from 'fast-deep-equal';
import type { DocumentData } from '../documentProjection';
import type { SemanticOperation, VectorClock } from './contracts';
import { getMergePolicy, resolveIdentity } from './policy';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function diffDocuments(
    base: Map<string, DocumentData>,
    desired: Map<string, DocumentData>,
    actorId: string,
    seq: number,
    clock: VectorClock
): SemanticOperation[] {
    const ops: SemanticOperation[] = [];
    const allPaths = new Set([...base.keys(), ...desired.keys()]);

    for (const docPath of allPaths) {
        const bDoc = base.get(docPath) ?? {};
        const dDoc = desired.get(docPath) ?? {};

        const allProps = new Set([...Object.keys(bDoc), ...Object.keys(dDoc)]);
        for (const prop of allProps) {
            traverseAndDiff(docPath, [prop], bDoc[prop], dDoc[prop], actorId, seq, clock, ops);
        }
    }

    // Active workout children are valid only while the same session is active.
    for (const op of ops) {
        if (op.docPath === '' && op.path[0] === 'activeWorkout' && op.path.length > 1) {
            const dRoot: DocumentData = desired.get('') ?? {};
            const bRoot: DocumentData = base.get('') ?? {};
            const aw = dRoot.activeWorkout ?? bRoot.activeWorkout;
            if (isRecord(aw)) {
                const awId = aw.id;
                const hasStableId =
                    (typeof awId === 'string' && awId.trim().length > 0) ||
                    (typeof awId === 'number' && Number.isFinite(awId));
                if (hasStableId) op.guard = { path: ['activeWorkout', 'id'], equals: awId };
            }
        }
    }

    return ops;
}

function traverseAndDiff(
    docPath: string,
    currentPath: string[],
    bVal: any,
    dVal: any,
    actorId: string,
    seq: number,
    clock: VectorClock,
    ops: SemanticOperation[]
) {
    if (equal(bVal, dVal)) return;

    const policy = getMergePolicy(docPath, currentPath);
    if (policy === 'ignore') return;

    if (policy === 'atomic') {
        ops.push({
            docPath,
            path: currentPath,
            value: dVal === undefined ? null : dVal,
            isDelete: dVal === undefined,
            actorId,
            seq,
            clock
        });
    } else if (policy === 'property') {
        const isPropertyContainer = (
            (docPath.startsWith('nutrition_months/') && currentPath.length === 1) ||
            (docPath.startsWith('history_months/') && currentPath.length === 1) ||
            (docPath === '' && currentPath.length === 1 && ['profile', 'nutritionPlanning', 'catalogOverrides'].includes(currentPath[0]))
        );
        let effBVal = bVal;
        const effDVal = dVal;

        // New property containers are expanded so independent concurrent children can converge.
        // Deletions are intentionally NOT expanded: they must remain a parent tombstone.
        if (isPropertyContainer && effBVal === undefined && effDVal !== undefined && typeof effDVal === 'object' && effDVal !== null && !Array.isArray(effDVal)) {
            effBVal = {};
        }

        if (effBVal === undefined || effDVal === undefined || typeof effBVal !== 'object' || typeof effDVal !== 'object' || effBVal === null || effDVal === null || Array.isArray(effBVal) || Array.isArray(effDVal)) {
            ops.push({
                docPath,
                path: currentPath,
                value: dVal === undefined ? null : dVal,
                isDelete: dVal === undefined,
                actorId,
                seq,
                clock
            });
            return;
        }

        if (currentPath.length === 1 && currentPath[0] === 'activeWorkout') {
            // A session without stable identity cannot safely support child-level operations.
            if (!effBVal.id || !effDVal.id || effBVal.id !== effDVal.id) {
                ops.push({
                    docPath,
                    path: currentPath,
                    value: dVal,
                    isDelete: false,
                    actorId,
                    seq,
                    clock
                });
                return;
            }
        }

        const allKeys = new Set([...Object.keys(effBVal), ...Object.keys(effDVal)]);
        for (const k of allKeys) {
            traverseAndDiff(docPath, [...currentPath, k], effBVal[k], effDVal[k], actorId, seq, clock, ops);
        }
    } else if (policy === 'keyed' || policy === 'ordered-keyed') {
        const bArr = Array.isArray(bVal) ? bVal : [];
        const dArr = Array.isArray(dVal) ? dVal : [];

        let valid = true;
        const bMap = new Map<string, any>();
        const dMap = new Map<string, any>();

        try {
            for (const item of bArr) {
                const id = resolveIdentity(currentPath, item);
                if (bMap.has(id)) { valid = false; break; }
                bMap.set(id, item);
            }
            if (valid) {
                for (const item of dArr) {
                    const id = resolveIdentity(currentPath, item);
                    if (dMap.has(id)) { valid = false; break; }
                    dMap.set(id, item);
                }
            }
        } catch {
            valid = false;
        }

        if (!valid) {
            ops.push({
                docPath,
                path: currentPath,
                value: dVal === undefined ? null : dVal,
                isDelete: dVal === undefined,
                actorId,
                seq,
                clock
            });
            return;
        }

        if (policy === 'ordered-keyed') {
            const bOrder = bArr.map((item: any) => resolveIdentity(currentPath, item));
            const dOrder = dArr.map((item: any) => resolveIdentity(currentPath, item));
            if (!equal(bOrder, dOrder)) {
                ops.push({
                    docPath,
                    path: [...currentPath, '$order'],
                    value: dOrder,
                    isDelete: false,
                    actorId,
                    seq,
                    clock
                });
            }
        }

        const allIds = new Set([...bMap.keys(), ...dMap.keys()]);
        for (const id of allIds) {
            const bItem = bMap.get(id);
            const dItem = dMap.get(id);
            if (!equal(bItem, dItem)) {
                if (dItem === undefined) {
                    ops.push({
                        docPath,
                        path: [...currentPath, id],
                        isDelete: true,
                        actorId,
                        seq,
                        clock
                    });
                } else if (bItem === undefined) {
                    ops.push({
                        docPath,
                        path: [...currentPath, id],
                        value: dItem,
                        isDelete: false,
                        actorId,
                        seq,
                        clock
                    });
                } else {
                    traverseAndDiff(docPath, [...currentPath, id], bItem, dItem, actorId, seq, clock, ops);
                }
            }
        }
    }
}
