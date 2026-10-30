import equal from 'fast-deep-equal';
import { UserDataSchema } from '../schema';
import type { UserData } from '../../types';
import { readBrowserValueStrict } from './browserStorage';
import { normalizeStorageOwner } from './owner';
import { updateArchiveRecord } from './secureArchiveRepository';
import { validateLocalEnvelope } from './localEnvelopeValidation';

const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;

export const ownerConsentRevision = (owner: string) => {
    if (!owner.startsWith('user:')) return {};
    // The generation is durably published only after the trusted server check
    // and an atomic pending-journal check. Pure local recovery code must not
    // require a live consent API request just to initialize its archive.
    const raw = readBrowserValueStrict(`logbook:v2:${owner}:health-consent-generation`);
    if (raw === null) return {};
    if (!/^[1-9]\d*$/.test(raw)) throw new Error('Generazione consenso locale non valida');
    const revision = Number(raw);
    if (!Number.isSafeInteger(revision)) throw new Error('Generazione consenso fuori limite');
    return { consentRevision: revision };
};

export async function advanceLocalConsentRevisionIfClean(
    owner: string, revision: number, guard?: () => boolean, erasedBeforeRevision?: number,
): Promise<boolean | 'erased'> {
    owner = normalizeStorageOwner(owner);
    if (!owner.startsWith('user:') || !Number.isSafeInteger(revision) || revision < 1
        || (erasedBeforeRevision !== undefined && (!Number.isSafeInteger(erasedBeforeRevision)
            || erasedBeforeRevision < 1 || erasedBeforeRevision >= revision))) {
        throw new Error('Generazione consenso non valida');
    }
    let ready: boolean | 'erased' = false;
    await updateArchiveRecord<any>(owner, raw => {
        if (guard && !guard()) throw new Error('Sessione cambiata durante la riconciliazione del consenso.');
        const current = validateLocalEnvelope(raw, owner);
        if (!current) { ready = true; return raw; }
        const previous = current.consentRevision ?? 0;
        if (previous > revision) throw new Error('Generazione locale più recente del server');
        if (previous === revision) { ready = true; return raw; }
        // An ACKed journal is not proof that its business data survived a
        // server-confirmed erasure. Keep the original envelope unchanged.
        if (erasedBeforeRevision !== undefined && previous <= erasedBeforeRevision) {
            ready = 'erased';
            return raw;
        }
        if (current.pending.length > 0) { ready = false; return raw; }
        ready = true;
        return { ...current, consentRevision: revision, replica: null, revision: current.revision + 1 };
    });
    return ready;
}

export async function revertRejectedConsent(owner: string, expected: UserData['legalConsent'], previous: UserData['legalConsent']): Promise<void> {
    owner = normalizeStorageOwner(owner);
    await updateArchiveRecord<any>(owner, raw => {
        const current = validateLocalEnvelope(raw, owner);
        if (!current || !equal(current.data.legalConsent, expected)) return raw!;

        const legalConsentOps = current.pending.filter(op =>
            op.docPath === ''
            && op.path[0] === 'legalConsent'
            && op.actorId === current.actorId
        );
        const rejectedSeq = legalConsentOps.reduce((max, op) => Math.max(max, op.seq), -1);
        // An old rejection must not undo a consent already acknowledged by a concurrent flush.
        if (rejectedSeq < 0) return raw!;
        const pending = current.pending.filter(op => !(
            op.docPath === ''
            && op.path[0] === 'legalConsent'
            && op.actorId === current.actorId
            && op.seq === rejectedSeq
        ));
        const data = parse({ ...current.data, legalConsent: previous });
        return { ...current, data, pending };
    });
}
