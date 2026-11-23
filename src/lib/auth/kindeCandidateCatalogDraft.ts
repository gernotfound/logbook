import { openScopedDeviceRecord } from '../sync/scopedDeviceRecord';
import { decodeWorkoutRecoveryDraft, encodeAccountWorkoutRecoveryDraft } from '../sync/workoutRecoveryDraftRecord';
import type { DomainOperation } from '../sync/domainOperations';
import type { LocalWriteGuard } from '../sync/localDomainCommit';
import type { LocalEnvelope } from '../sync/localEnvelopeValidation';
import type { UserData } from '../../types';

export type KindeCatalogDraftController<Handle> = {
    handle: Handle;
    prepare: (data: UserData) => {
        operation: DomainOperation;
        beforeCommit: LocalWriteGuard;
        clearAfterCommit: () => void;
    };
};

export async function openKindeCatalogDraft<T extends { submitted: boolean }>({
    owner, key, revision, permitted, parse, initialize,
}: {
    owner: string;
    key: 'draft_routine' | 'draft_exercise';
    revision: number;
    permitted: () => boolean;
    parse: (value: unknown) => T;
    initialize: () => T;
}) {
    if (!owner.startsWith('user:') || !Number.isSafeInteger(revision) || revision < 1) {
        throw new Error('Consenso della bozza non verificabile.');
    }
    const device = await openScopedDeviceRecord(owner, key, permitted);
    try {
        const initial = device.read();
        let raw = initial.raw;
        let draft: T;
        if (initial.plaintext === null) draft = initialize();
        else {
            const decoded = decodeWorkoutRecoveryDraft(initial.plaintext, key, owner);
            if (decoded.revision !== revision) throw new Error('Bozza di un consenso precedente. Copia conservata.');
            draft = parse(decoded.value);
        }
        const current = () => {
            if (device.read().raw !== raw) throw new Error('Bozza cambiata: copia più recente conservata.');
            return draft;
        };
        const persist = (next: T) => {
            const validated = parse(next);
            raw = device.replace(raw, encodeAccountWorkoutRecoveryDraft(key, owner, revision, validated));
            draft = validated;
        };
        const discard = () => {
            raw = device.replace(raw, null);
            device.close();
        };
        return {
            current, discard, close: device.close,
            editable: () => {
                const value = current();
                if (value.submitted) throw new Error('Salvataggio già tentato. Verifica l’archivio.');
                return value;
            },
            persist,
            prepareCommit: (submitted: T, operation: DomainOperation, verify: (envelope: LocalEnvelope) => void) => ({
                operation,
                beforeCommit: (envelope: LocalEnvelope | undefined) => {
                    if (current() !== submitted || envelope?.consentRevision !== revision || envelope.owner !== owner) return false;
                    verify(envelope);
                    // The exact attempt survives a crash or an ambiguous outcome
                    // without permitting the same user intent to be sent twice.
                    persist({ ...submitted, submitted: true });
                    return true;
                },
                clearAfterCommit: discard,
            }),
        };
    } catch (error) {
        device.close();
        throw error;
    }
}
