import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, vi } from 'vitest';
import type { ReactNode } from 'react';
import { registerKindeSessionEntryCases } from './kindeSessionEntryCases';
import { registerKindeSessionPreparationCases } from './kindeSessionPreparationCases';
import { registerKindeSessionEpochCases } from './kindeSessionEpochCases';

vi.mock('../../../src/hooks/usePWAInstall', () => ({
    usePWAInstall: vi.fn(() => ({
        isInstallable: false, isIOSInstallable: false, isStandalone: false,
        promptInstall: vi.fn(async () => {}),
    })),
}));

vi.mock('../../../src/lib/db/guestLocalPurge', () => ({ purgeGuestLocalData: vi.fn(async () => {}) }));
vi.mock('../../../src/lib/sync/kindeCandidateOwnerBootstrap', () => ({
    prepareKindeCandidateOwner: vi.fn(),
}));
vi.mock('../../../src/lib/auth/kindeCandidateIdentity', () => ({
    readKindeCandidateIdentity: vi.fn(),
}));
vi.mock('../../../src/lib/auth/kindeCandidateClient', async importOriginal => ({
    ...await importOriginal<typeof import('../../../src/lib/auth/kindeCandidateClient')>(),
    readKindeCandidateAccess: vi.fn(),
    revokeKindeCandidateSession: vi.fn(async () => {}),
    submitKindeHostedSignIn: vi.fn(),
}));

import { GuestOnlyAuthProvider } from '../../../src/contexts/GuestOnlyAuthProvider';
import { KindeAccountSessionProvider } from '../../../src/contexts/auth/KindeAccountSessionProvider';
import { useKindeAccountSession } from '../../../src/contexts/auth/useKindeAccountSession';
import { useSharedKindeAccountSession } from '../../../src/contexts/auth/kindeAccountSessionContext';
import { KindeAccountEntry } from '../../../src/components/UI/KindeAccountEntry';
import { readKindeCandidateIdentity } from '../../../src/lib/auth/kindeCandidateIdentity';
import { KindeCandidateBoundaryError, readKindeCandidateAccess, revokeKindeCandidateSession, submitKindeHostedSignIn } from '../../../src/lib/auth/kindeCandidateClient';
import { prepareKindeCandidateOwner } from '../../../src/lib/sync/kindeCandidateOwnerBootstrap';
import { authenticatedIdentitySource } from '../../../src/lib/sync/authenticatedIdentitySource';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../../src/lib/sync/session';
import { useAuth } from '../../../src/hooks/useAuth';
import { usePWAInstall } from '../../../src/hooks/usePWAInstall';
import { releaseLegacyTestIdentityReader } from '../../setup';

const uid = 'k_' + 'A'.repeat(43);
const readyPrincipal = { uid, fenceEpoch: 1, healthConsentRevision: 1, emailVerified: true };
const verified = {
    kind: 'email-verified' as const,
    principal: { uid, fenceEpoch: 1, healthConsentRevision: 0, emailVerified: true },
};
let csrf = 'A'.repeat(43);
const host = ({ children }: { children: ReactNode }) => (
    <GuestOnlyAuthProvider>
        <KindeAccountSessionProvider>{children}</KindeAccountSessionProvider>
    </GuestOnlyAuthProvider>
);

function Observer() {
    const session = useSharedKindeAccountSession();
    const { currentUser, isGuest } = useAuth();
    return <output data-testid="kinde-presence">{[
        session?.view.phase ?? 'missing', currentUser ? 'fitness-account' : 'fitness-blocked',
        isGuest ? 'local-guest' : 'not-guest',
    ].join('|')}</output>;
}

beforeEach(() => {
    releaseLegacyTestIdentityReader();
    localStorage.clear();
    csrf = 'A'.repeat(43);
    vi.spyOn(document, 'cookie', 'get').mockImplementation(() => '__Host-logbook_csrf=' + csrf);
    vi.mocked(readKindeCandidateIdentity).mockResolvedValue({ kind: 'signed-out' });
    vi.mocked(usePWAInstall).mockReturnValue({
        isInstallable: false, isIOSInstallable: false, isStandalone: false,
        promptInstall: vi.fn(async () => {}),
    });
    vi.mocked(readKindeCandidateAccess).mockReset();
    vi.mocked(revokeKindeCandidateSession).mockResolvedValue();
    vi.mocked(prepareKindeCandidateOwner).mockReset();
    vi.mocked(prepareKindeCandidateOwner).mockResolvedValue({
        kind: 'candidate-observed', checkpointRevision: 1, replicaOutcome: 'already-active',
    });
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

function createKindeSessionContext() {
    return {
        uid, readyPrincipal, verified, host, Observer,
        readKindeCandidateIdentity, readKindeCandidateAccess,
        revokeKindeCandidateSession, submitKindeHostedSignIn,
        authenticatedIdentitySource, usePWAInstall, KindeAccountEntry,
        KindeCandidateBoundaryError, prepareKindeCandidateOwner,
        useKindeAccountSession, useSharedKindeAccountSession,
        activateGuestSession, GUEST_SESSION_KEY,
        setCsrf: (value: string) => { csrf = value; },
    };
}
export type KindeSessionContext = ReturnType<typeof createKindeSessionContext>;

describe('React Kinde session boundary never promotes identity into fitness', () => {
    const context = createKindeSessionContext();
    registerKindeSessionEntryCases(context);
    registerKindeSessionPreparationCases(context);
    registerKindeSessionEpochCases(context);
});
