import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { assertWorkoutSnapshotEpoch, readDeviceConsentRevision } from './workoutDeviceIntent';

type RecoveryDraftWitness = {
    __logbookWorkoutRecoveryDraft: 1;
    owner: string;
    name: string;
    consentRevision: number;
    data: unknown;
};

/**
 * Recovery JSON is historical evidence until its consent generation is proven.
 * Keep provenance and payload in the same synchronous owner-scoped record.
 */
export function readWorkoutRecoveryDraft(name: string, owner: string): unknown | null {
    const raw = readDeviceValueStrict(name, owner);
    if (raw === null) return null;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('Bozza workout di recupero non leggibile: originale conservato.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Bozza workout di recupero non valida: originale conservato.');
    }
    const record = parsed as Partial<RecoveryDraftWitness>;
    let revision: number | undefined;
    if (Object.hasOwn(record, '__logbookWorkoutRecoveryDraft')) {
        if (record.__logbookWorkoutRecoveryDraft !== 1 || record.owner !== owner
            || record.name !== name || !Number.isSafeInteger(record.consentRevision)
            || (record.consentRevision ?? 0) < 1 || !Object.hasOwn(record, 'data')) {
            throw new Error('Metadati della bozza workout non validi: originale conservato.');
        }
        revision = record.consentRevision;
        parsed = record.data;
    }
    assertWorkoutSnapshotEpoch(owner, revision);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Contenuto della bozza workout non valido: originale conservato.');
    }
    return parsed;
}

/** An unproven previous draft is never overwritten or cleared automatically. */
export function writeWorkoutRecoveryDraft(name: string, owner: string, data: unknown | null): void {
    readWorkoutRecoveryDraft(name, owner);
    if (data === null) {
        writeDeviceValue(name, null, owner);
        return;
    }
    const revision = readDeviceConsentRevision(owner);
    const value: unknown = owner.startsWith('user:') && revision !== undefined
        ? { __logbookWorkoutRecoveryDraft: 1, owner, name, consentRevision: revision, data } satisfies RecoveryDraftWitness
        : data;
    writeDeviceValue(name, JSON.stringify(value), owner);
}
