import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { assertWorkoutSnapshotEpoch, readDeviceConsentRevision } from './workoutDeviceIntent';

type BufferedDraftRecord = {
    __logbookBufferedDraft: 1;
    owner: string;
    name: string;
    consentRevision: number;
    value: string;
};

export type BufferedDraftSnapshot = {
    value: string | null;
    /** Exact plaintext representation, not the underlying AEAD ciphertext. */
    raw: string | null;
};

class BufferedDraftConflictError extends Error {
    constructor() {
        super('Bozza modificata da un’altra scheda: copia corrente conservata.');
        this.name = 'BufferedDraftConflictError';
    }
}

/**
 * A single strict read returns both the user-facing value and the exact
 * document image the editor observed. Checking only owner and consent revision
 * does not detect a different editor writing the same workout and field.
 */
export function readBufferedDraftSnapshot(name: string, owner: string): BufferedDraftSnapshot {
    const raw = readDeviceValueStrict(name, owner);
    if (raw === null) return { value: null, raw: null };
    let revision: number | undefined;
    let value = raw;
    if (raw.startsWith('{')) {
        let parsed: unknown;
        try { parsed = JSON.parse(raw); }
        catch { parsed = null; }
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            && Object.hasOwn(parsed, '__logbookBufferedDraft')) {
            const record = parsed as Partial<BufferedDraftRecord>;
            if (record.__logbookBufferedDraft !== 1 || record.owner !== owner || record.name !== name
                || !Number.isSafeInteger(record.consentRevision)
                || (record.consentRevision ?? 0) < 1 || typeof record.value !== 'string') {
                throw new Error('Provenienza della bozza bufferizzata non valida: copia conservata.');
            }
            revision = record.consentRevision;
            value = record.value;
        }
    }
    // Legacy raw text has no epoch. It is safe to auto-recover only in epoch 1.
    assertWorkoutSnapshotEpoch(owner, revision);
    return { value, raw };
}

export function assertBufferedDraftUnchanged(name: string, owner: string, expectedRaw: string | null): void {
    if (readBufferedDraftSnapshot(name, owner).raw !== expectedRaw) {
        throw new BufferedDraftConflictError();
    }
}

/**
 * Conditional replacement/clear. The caller must carry forward the exact raw
 * image returned by the last successful write. A stale editor must not use a
 * fresh read to authorize overwriting a newer image it never observed.
 *
 * localStorage has no compare-and-swap primitive: this protects observable
 * interleavings, but simultaneous read-then-write across JS realms still
 * requires a distinct cross-tab serialization protocol.
 */
export function writeBufferedDraft(
    name: string, owner: string, value: string | null,
    expectedConsentGeneration?: string | null,
    expectedRaw?: string | null,
): string | null {
    const current = readBufferedDraftSnapshot(name, owner);
    if (expectedRaw !== undefined && current.raw !== expectedRaw) {
        throw new BufferedDraftConflictError();
    }
    const revision = readDeviceConsentRevision(owner);
    if (expectedConsentGeneration !== undefined && owner.startsWith('user:')
        && expectedConsentGeneration !== (revision === undefined ? null : String(revision))) {
        throw new Error('Generazione consenso cambiata: bozza bufferizzata conservata.');
    }
    if (value === null) {
        writeDeviceValue(name, null, owner);
        return null;
    }
    const sourceRevision = expectedConsentGeneration === undefined ? revision
        : expectedConsentGeneration === null ? undefined : Number(expectedConsentGeneration);
    const next = owner.startsWith('user:') && sourceRevision !== undefined
        ? JSON.stringify({
            __logbookBufferedDraft: 1, owner, name, consentRevision: sourceRevision, value,
        } satisfies BufferedDraftRecord)
        : value;
    writeDeviceValue(name, next, owner);
    return next;
}
