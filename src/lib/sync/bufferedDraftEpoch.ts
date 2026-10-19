import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { assertWorkoutSnapshotEpoch, readDeviceConsentRevision } from './workoutDeviceIntent';

type BufferedDraftRecord = {
    __logbookBufferedDraft: 1;
    owner: string;
    name: string;
    consentRevision: number;
    value: string;
};

/**
 * Owner-scoped ciphertext authenticates storage ownership, not the consent
 * generation that originally produced a health-related unfinished input.
 * Read the witness and text in one synchronous protected record.
 */
export function readBufferedDraft(name: string, owner: string): string | null {
    const raw = readDeviceValueStrict(name, owner);
    if (raw === null) return null;
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
            value = record.value!;
        }
    }
    // Legacy raw text has no epoch. It is safe to auto-recover only in epoch 1.
    assertWorkoutSnapshotEpoch(owner, revision);
    return value;
}

/** An old or unverified record cannot be overwritten or silently cleaned up. */
export function writeBufferedDraft(
    name: string, owner: string, value: string | null,
    expectedConsentGeneration?: string | null,
): void {
    readBufferedDraft(name, owner);
    const revision = readDeviceConsentRevision(owner);
    if (expectedConsentGeneration !== undefined && owner.startsWith('user:')
        && expectedConsentGeneration !== (revision === undefined ? null : String(revision))) {
        throw new Error('Generazione consenso cambiata: bozza bufferizzata conservata.');
    }
    if (value === null) {
        writeDeviceValue(name, null, owner);
        return;
    }
    const sourceRevision = expectedConsentGeneration === undefined ? revision
        : expectedConsentGeneration === null ? undefined : Number(expectedConsentGeneration);
    const next = owner.startsWith('user:') && sourceRevision !== undefined
        ? JSON.stringify({
            __logbookBufferedDraft: 1, owner, name, consentRevision: sourceRevision, value,
        } satisfies BufferedDraftRecord)
        : value;
    writeDeviceValue(name, next, owner);
}
