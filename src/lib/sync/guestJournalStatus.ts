import type { SyncResult } from '../../types';
import { isActiveGuestSession, isCurrentSession, type SessionSnapshot } from './session';
import { getGuestHealthConsentStatus } from '../guestHealthConsent';
import { isAccountDeletionPending } from './accountGate';
import { readLocal } from './localArchiveBootstrap';
import { LegalConsentRequiredError } from './legalConsentRequiredError';
import { ReplicaFencedError } from './replicaProtocol';

// Guest has no remote replica. A successful status still requires a readable,
// unfenced durable archive belonging to the same live guest generation.
export async function evaluateGuestJournal(session: SessionSnapshot, expectedOwner?: string): Promise<SyncResult> {
    try {
        if (expectedOwner && session.owner !== expectedOwner) throw new Error('Sessione cambiata');
        if (session.owner !== 'guest') throw new Error('Sessione guest non valida');
        if (!isActiveGuestSession() || getGuestHealthConsentStatus() !== 'active') {
            return { ok: false, status: 'local-pending', error: new LegalConsentRequiredError() };
        }
        if (isAccountDeletionPending(session.owner)) throw new Error('Cancellazione account in sospeso. Riprendila dalle impostazioni; copia locale conservata.');
        const envelope = await readLocal(session.owner);
        if (!isCurrentSession(session)) throw new Error('Sessione cambiata');
        if (!envelope) throw new Error('Copia locale non disponibile');
        if (envelope.cloudIntegrityFence) throw new ReplicaFencedError('Snapshot cloud incompleto: verifica completa richiesta prima di sincronizzare.');
        return { ok: true, status: 'synced' };
    } catch (error) {
        return { ok: false, status: 'failed', error };
    }
}
