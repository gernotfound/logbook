import equal from 'fast-deep-equal';
import { readDeviceValueStrict, writeDeviceValue } from './deviceStorage';
import { assertWorkoutSnapshotEpoch, readDeviceConsentRevision } from './workoutDeviceIntent';
import { decodeWorkoutRecoveryDraft, encodeAccountWorkoutRecoveryDraft } from './workoutRecoveryDraftRecord';

/**
 * Recovery JSON is historical evidence until its consent generation is proven.
 * Keep provenance and payload in the same synchronous owner-scoped record.
 */
export function readWorkoutRecoveryDraftImage(name: string, owner: string): { value: unknown | null; raw: string | null } {
    const raw = readDeviceValueStrict(name, owner);
    if (raw === null) return { value: null, raw: null };
    const { value, revision } = decodeWorkoutRecoveryDraft(raw, name, owner);
    assertWorkoutSnapshotEpoch(owner, revision);
    return { value, raw };
}

export function readWorkoutRecoveryDraft(name: string, owner: string): unknown | null {
    return readWorkoutRecoveryDraftImage(name, owner).value;
}

/** An unproven previous draft is never overwritten or cleared automatically. */
export function writeWorkoutRecoveryDraft(
    name: string, owner: string, data: unknown | null,
    expectedConsentGeneration?: string | null,
    expectedRaw?: string | null,
): string | null {
    const current = readWorkoutRecoveryDraftImage(name, owner);
    // Consent/owner equality alone cannot distinguish two editors in the same session.
    if (expectedRaw !== undefined && current.raw !== expectedRaw) {
        throw new Error('Bozza workout modificata da un’altra scheda: copia più recente conservata.');
    }
    const revision = readDeviceConsentRevision(owner);
    // A mounted editor must write the generation it originally captured, never
    // relabel old in-memory answers with a concurrently published new generation.
    if (expectedConsentGeneration !== undefined && owner.startsWith('user:')
        && expectedConsentGeneration !== (revision === undefined ? null : String(revision))) {
        throw new Error('Generazione consenso cambiata: vecchia bozza preservata.');
    }
    if (data === null) {
        writeDeviceValue(name, null, owner);
        return null;
    }
    const origin = expectedConsentGeneration === undefined ? revision
        : expectedConsentGeneration === null ? undefined : Number(expectedConsentGeneration);
    if (owner.startsWith('user:') && origin === undefined) {
        throw new Error('Generazione consenso bozza workout non verificabile: originale conservato.');
    }
    // Refreshing an unchanged draft must not invalidate a different mounted
    // editor's observed ciphertext. Authentication and epoch gates still run.
    if (current.raw !== null && equal(current.value, data)) return current.raw;
    const raw = owner.startsWith('user:') && origin !== undefined
        ? encodeAccountWorkoutRecoveryDraft(name, owner, origin, data) : JSON.stringify(data);
    writeDeviceValue(name, raw, owner);
    return raw;
}
