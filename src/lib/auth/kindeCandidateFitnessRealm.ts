import { captureKindeCandidateSessionFence, KindeCandidateBoundaryError, type KindeCandidateAccess } from './kindeCandidateClient';
import { withKindeCandidateLocalReadiness } from './kindeCandidateLocalReadiness';
import { submitKindeCandidateDomainIntent } from './kindeCandidateDomainIntent';
import { authenticatedIdentitySource } from '../sync/authenticatedIdentitySource';
import { isKindeAccountLocalFitnessClear } from '../sync/kindeOwnerLocalFitnessFence';
import { readLocal } from '../sync/localArchiveBootstrap';
import { userOwner } from '../sync/owner';
import type { DomainOperationBatch } from '../sync/domainOperations';
import type { UserData } from '../../types';

type Principal = Extract<KindeCandidateAccess, { kind: 'consent-confirmed' }>['principal'];

type Options = {
    expected: Readonly<Principal>;
    stillCurrent: () => boolean;
    send?: typeof fetch;
    browserCookies?: () => string;
};

export type KindeCandidateFitnessSnapshot = Readonly<{
    owner: string;
    principal: Readonly<Principal>;
    data: UserData;
}>;

type MutationOutcome = Awaited<ReturnType<typeof submitKindeCandidateDomainIntent>>;

export type KindeCandidateFitnessRealm = {
    isCurrent: () => boolean;
    snapshot: () => KindeCandidateFitnessSnapshot | null;
    refresh: () => Promise<KindeCandidateFitnessSnapshot>;
    submit: (operation: DomainOperationBatch) => Promise<MutationOutcome>;
    close: () => void;
};

/**
 * Candidate React owner boundary, deliberately separate from the legacy
 * Firebase AuthContext and global authenticatedIdentitySource. A Kinde identity
 * alone cannot install an application owner while the legacy store still uses
 * Firebase consent and writer gates.
 *
 * Every read/write re-enters the verified Kinde/consent/D1 readiness scope,
 * which releases the device DEK on return. No online result is cached as an
 * offline grant; pending ciphertext survives a failed or cancelled operation.
 */
export async function openKindeCandidateFitnessRealm({
    expected, stillCurrent, send = fetch, browserCookies = () => document.cookie,
}: Options): Promise<KindeCandidateFitnessRealm> {
    const principal = { ...expected };
    const owner = userOwner(principal.uid);
    const fence = captureKindeCandidateSessionFence({ stillCurrent, browserCookies });
    let closed = false;
    let busy = false;
    let visible: KindeCandidateFitnessSnapshot | null = null;
    const current = () => {
        try {
            return !closed && fence.stillCurrent()
                && !authenticatedIdentitySource.hasReader()
                && isKindeAccountLocalFitnessClear(owner, principal.healthConsentRevision);
        } catch { return false; }
    };
    const requireCurrent = () => {
        if (!current()) throw new KindeCandidateBoundaryError();
    };
    const request = { expected: principal, stillCurrent: current, send, browserCookies };

    const load = async (): Promise<KindeCandidateFitnessSnapshot> => {
        requireCurrent();
        const snapshot = await withKindeCandidateLocalReadiness(request, async ready => {
            if (!ready.isCurrent() || ready.owner !== owner) throw new KindeCandidateBoundaryError();
            const local = await readLocal(owner);
            if (!ready.isCurrent() || !local || local.owner !== owner
                || local.consentRevision !== principal.healthConsentRevision
                || !local.data.legalConsent) throw new KindeCandidateBoundaryError();
            return {
                owner,
                principal: { ...principal },
                data: structuredClone(local.data),
            };
        });
        requireCurrent();
        visible = snapshot;
        return structuredClone(snapshot);
    };

    try {
        await load();
    } catch (error) {
        closed = true;
        visible = null;
        throw error;
    }

    return {
        isCurrent: current,
        snapshot: () => current() && visible ? structuredClone(visible) : null,
        close: () => {
            closed = true;
            visible = null;
        },
        refresh: async () => {
            if (busy) throw new KindeCandidateBoundaryError();
            requireCurrent();
            busy = true;
            visible = null;
            try { return await load(); }
            finally { busy = false; }
        },
        submit: async operation => {
            if (busy) throw new KindeCandidateBoundaryError();
            requireCurrent();
            busy = true;
            // The previous plaintext snapshot becomes stale as soon as this
            // operation starts, including when the remote response is lost.
            visible = null;
            try {
                const result = await submitKindeCandidateDomainIntent({ ...request, operation });
                requireCurrent();
                // A pending journal is not a cloud checkpoint. Recover only
                // through a later explicit trusted refresh, never fake success.
                if (result.kind !== 'local-pending') {
                    try { await load(); } catch { visible = null; }
                }
                requireCurrent();
                return result;
            } finally {
                busy = false;
            }
        },
    };
}
