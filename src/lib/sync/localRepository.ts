import { get, update } from 'idb-keyval';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { generateId } from '../utils/date';
import { getNutritionConflictFingerprint } from '../utils/object';
import equal from 'fast-deep-equal';
import { type SemanticOperation, type VectorClock, type SyncMeta, diffDocuments, applySemanticOperations } from './semanticProjection';
import { projectDocuments, applyRemoteDocuments, type DocumentData } from './documentProjection';
import { getCachedCatalog } from '../catalog/catalogService';

export interface LocalEnvelopeV3 {
    version: 3;
    owner: string;
    actorId: string;
    actorSeq: number;
    clock: VectorClock;
    data: UserData;
    baseline: UserData;
    completeMonths: string[];
    pending: SemanticOperation[];
    syncMetaByDocument: Record<string, SyncMeta>;
    revision: number;
}

export type LocalEnvelope = LocalEnvelopeV3;

const keyFor = (owner: string) => {
    if (!owner) throw new Error('Owner richiesto per la persistenza locale');
    return `logbook:v2:${owner}`;
};
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

async function validate(value: any, owner: string): Promise<LocalEnvelope | undefined> {
    if (!value) return undefined;

    if (value.version !== 3 || value.owner !== owner) {
        throw new Error('Archivio locale non riconosciuto: conservato per il recupero');
    }
    const v3 = value as LocalEnvelopeV3;
    return { ...v3, data: parse(v3.data), baseline: parse(v3.baseline) };
}

export async function readLocal(owner: string): Promise<LocalEnvelope | undefined> {
    return validate(await get<any>(keyFor(owner)), owner);
}

export async function commitLocal(owner: string, data: UserData, initialBase: UserData): Promise<SemanticOperation[]> {
    const desired = structuredClone(parse(data));
    const fallback = structuredClone(parse(initialBase));
    let operations: SemanticOperation[] = [];
    await update<any>(keyFor(owner), async raw => {
        const current = await validate(raw, owner);
        const catalog = await getCachedCatalog();
        
        let actorId = current?.actorId ?? generateId('actor');
        let seq = (current?.actorSeq ?? 0) + 1;
        let clock = { ...(current?.clock ?? {}) };
        clock[actorId] = seq;

        const baseDocs = projectDocuments(current?.data ?? fallback, catalog);
        const desiredDocs = projectDocuments(desired, catalog);
        
        operations = diffDocuments(baseDocs, desiredDocs, actorId, seq, clock);
        
        return {
            ...(current ?? { completeMonths: [] }),
            version: 3, owner, actorId, actorSeq: seq, clock,
            data: desired,
            baseline: current?.baseline ?? fallback,
            completeMonths: current?.completeMonths ?? [],
            pending: owner === 'guest' ? [] : [...(current?.pending ?? []), ...operations],
            syncMetaByDocument: current?.syncMetaByDocument ?? {},
            revision: seq
        };
    });
    return operations;
}

export async function acknowledgeLocal(owner: string, _id: string, remote: UserData): Promise<void> {
    const parsed = parse(remote);
    await update<any>(keyFor(owner), async raw => {
        const current = await validate(raw, owner);
        if (!current || current.pending[0] === undefined) throw new Error('Conferma obsoleta o fuori ordine');
        const pending = current.pending.slice(1);
        return { ...current, baseline: parsed, data: pending.length ? current.data : parsed, pending };
    });
}

export async function acknowledgeThrough(owner: string, expectedSeq: number, remote: UserData, _expected?: UserData, months: string[] = [], syncMeta?: Record<string, SyncMeta>): Promise<void> {
    const parsed = parse(remote);
    await update<any>(keyFor(owner), async raw => {
        const current = await validate(raw, owner);
        if (!current) throw new Error('Archivio locale non trovato');
        const pending = current.pending.filter(op => op.seq > expectedSeq);
        
        let newClock = { ...current.clock };
        if (syncMeta) {
            for (const meta of Object.values(syncMeta)) {
                for (const [actor, seq] of Object.entries(meta.clock)) {
                    newClock[actor] = Math.max(newClock[actor] || 0, seq);
                }
            }
        }
        
        const newSyncMeta = { ...current.syncMetaByDocument, ...(syncMeta || {}) };
        return { ...current, clock: newClock, baseline: parsed, data: current.actorSeq === expectedSeq ? parsed : current.data, pending,
            completeMonths: [...new Set([...current.completeMonths, ...months])], syncMetaByDocument: newSyncMeta };
    });
}

export async function initializeLocal(owner: string, data: UserData, completeMonths?: string[]): Promise<void> {
    const parsed = structuredClone(parse(data));
    await update<any>(keyFor(owner), async raw => {
        const current = await validate(raw, owner);
        if (current?.pending.length) return current;
        return { ...current, version: 3, owner, actorId: current?.actorId ?? generateId('actor'), actorSeq: current?.actorSeq ?? 0, clock: current?.clock ?? {}, data: parsed, baseline: parsed, completeMonths: completeMonths ?? current?.completeMonths ?? [], pending: [], syncMetaByDocument: current?.syncMetaByDocument ?? {}, revision: 0 };
    });
}

export async function hydrateLocal(owner: string, cloudData: UserData, months: string[], cloudDocuments?: Map<string, DocumentData>): Promise<LocalEnvelope> {
    const cloud = structuredClone(parse(cloudData));
    let saved: any;
    await update<any>(keyFor(owner), async raw => {
        const current = await validate(raw, owner);
        if (!current) {
            saved = { version: 3, owner, actorId: generateId('actor'), actorSeq: 0, clock: {}, data: cloud, baseline: cloud, completeMonths: months, pending: [], syncMetaByDocument: {}, revision: 0 };
        } else {
            const catalog = await getCachedCatalog();
            
            let syncMeta = current.syncMetaByDocument ?? {};
            let updatedClock = { ...current.clock };
            // hydrateLocal MUST NOT modify existing pending clocks

            
            if (cloudDocuments) {
                for (const [path, doc] of cloudDocuments.entries()) {
                    if (doc._sync) {
                        const meta = doc._sync as SyncMeta;
                        syncMeta[path] = meta;
                        for (const [actor, seq] of Object.entries(meta.clock)) {
                            updatedClock[actor] = Math.max(updatedClock[actor] || 0, seq);
                        }
                    }
                }
            }
            
            const remoteDocs = projectDocuments(cloud, catalog);
            const { documents: mergedDocs, syncMetas: mergedMetas } = applySemanticOperations(remoteDocs, current.pending, syncMeta);
            const data = applyRemoteDocuments(cloud, mergedDocs, catalog);
            
            data.pendingConflicts = current.data.pendingConflicts;
            const parsedData = parse(data);
            
            saved = {
                ...current,
                clock: updatedClock,
                data: parsedData,
                baseline: cloud,
                completeMonths: [...new Set([...current.completeMonths, ...months])],
                syncMetaByDocument: mergedMetas
            };
        }
        return saved;
    });
    return saved;
}

export async function clearNutritionConflict(owner: string, fingerprint: string, fallback: UserData): Promise<UserData> {
    let saved!: UserData;
    const clear = (data: UserData): UserData => {
        if (getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning) !== fingerprint) return data;
        const { nutritionPlanning: _resolved, ...remaining } = data.pendingConflicts ?? {};
        const { pendingConflicts: _old, ...rest } = data;
        return Object.keys(remaining).length ? { ...rest, pendingConflicts: remaining } : rest;
    };
    await update<any>(keyFor(owner), async raw => {
        const current = await validate(raw, owner);
        const data = current?.data ?? fallback;
        if (getNutritionConflictFingerprint(data.pendingConflicts?.nutritionPlanning) !== fingerprint) throw new Error('Conflitto cambiato durante la risoluzione');
        saved = parse(clear(data));
        return {
            ...(current ?? { version: 3, owner, actorId: generateId('actor'), actorSeq: 0, clock: {}, completeMonths: [], pending: [], syncMetaByDocument: {}, revision: 0 }),
            data: saved, baseline: clear(current?.baseline ?? data),
        };
    });
    return saved;
}

export async function revertRejectedConsent(owner: string, expected: UserData['legalConsent'], previous: UserData['legalConsent']): Promise<void> {
    const revert = (data: UserData) => equal(data.legalConsent, expected) ? parse({ ...data, legalConsent: previous }) : data;
    await update<any>(keyFor(owner), async raw => {
        const current = await validate(raw, owner);
        if (!current) return raw!;
        return { ...current, data: revert(current.data) };
    });
}

export async function preserveLegacyCache(): Promise<boolean> {
    const legacy = await get('logbook_cached_user_data');
    if (legacy === undefined) return false;
    await update('logbook:recovery:legacy', original => original ?? legacy);
    return true;
}


