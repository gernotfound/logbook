import 'fake-indexeddb/auto';
import { clear, get } from 'idb-keyval';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const remote = vi.hoisted(() => ({
    apply: vi.fn(),
    auth: { currentUser: { uid: 'a', getIdToken: async () => 'id-token' } },
}));
vi.mock('../../src/lib/firebase', () => ({
    auth: remote.auth, getDb: () => ({}), ensureAppCheck: async () => {},
    waitForPendingWrites: async () => {},
}));
vi.mock('../../src/lib/appCheck', () => ({ getLimitedUseAppCheckToken: async () => 'one-use-token' }));
vi.mock('../../src/lib/healthConsent', async () => {
    const actual = await vi.importActual<typeof import('../../src/lib/healthConsent')>('../../src/lib/healthConsent');
    const writable = (owner: string) => owner === 'user:' + remote.auth.currentUser.uid;
    return {
        ...actual,
        isHealthConsentWritable: writable, isHealthConsentCloudWritable: writable,
        requireHealthConsentWritable: (owner: string) => {
            if (!writable(owner)) throw new Error('Consent unavailable');
        },
        getVerifiedHealthConsentRevision: () => 1,
    };
});
vi.mock('../../src/lib/telemetryHub', () => ({ telemetryHub: { trackEvent: vi.fn(), trackError: vi.fn() } }));
vi.mock('../../src/lib/sync/transactionWriter', () => ({ applyDocumentChanges: remote.apply }));

import { getSeedCatalog } from '../../src/lib/catalog/catalogService';
import { projectDocuments } from '../../src/lib/sync/documentProjection';
import { applySemanticOperations } from '../../src/lib/sync/semanticProjection';
import { replicateJournal } from '../../src/lib/sync/replicateJournal';
import { adoptReplicaCheckpoint, initializeLocal, commitLocal, readLocal } from '../../src/lib/sync/localRepository';
import { createJournalRetry, type JournalRetryState } from '../../src/lib/sync/journalRetry';
import { UserDataSchema } from '../../src/lib/schema';
import { invalidateSession } from '../../src/lib/sync/session';
import { createAndMigrateVault } from '../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../src/lib/sync/secureArchiveSession';
import type { UserData } from '../../src/types';

const data = (height: number) => UserDataSchema.parse({
    profile: { height: String(height) },
    legalConsent: {
        hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z',
        privacyVersion: '1.3.4', termsVersion: '1.2.1',
    },
}) as unknown as UserData;
const keyPayload = {
    format: 'thelogbook-account-data-key', version: 1,
    key: btoa(String.fromCharCode(...new Uint8Array(32).fill(18))),
};

beforeEach(async () => {
    lockAllVaults();
    localStorage.clear();
    localStorage.setItem('logbook:v2:user:a:health-consent-generation', '1');
    vi.stubGlobal('navigator', { onLine: true, locks: {
        request: async (_name: string, _options: unknown, run: () => Promise<unknown>) => run(),
    } });
    invalidateSession();
    await clear();
    remote.auth.currentUser.uid = 'a';
    remote.apply.mockReset();
    await createAndMigrateVault('user:a');
    await initializeLocal('user:a', data(170));
    const now = Date.now();
    await adoptReplicaCheckpoint('user:a', {
        identity: {
            slot: 's00', replicaId: 'replica-a', generation: 1,
            checkpointAtMs: now, leaseUntilMs: now + 360 * 24 * 60 * 60 * 1000,
        },
        baseSeq: 0,
    }, { clock: {}, syncMetaByDocument: {} });
    await commitLocal('user:a', data(171), data(170));
});
afterEach(() => { vi.useRealTimers(); lockAllVaults(); vi.unstubAllGlobals(); });

it.each(['network', 'timeout', 429, 503] as const)(
    'preserves ciphertext after key-service %s and automatically retries to a real local ACK',
    async failure => {
        const before = await readLocal('user:a');
        expect(before?.pending).toHaveLength(1);
        const ciphertext = await get('logbook:v2:user:a');
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        const fetch = vi.fn()
            .mockImplementationOnce(async () => {
                if (failure === 'network') throw new TypeError('Injected network outage');
                if (failure === 'timeout') throw new DOMException('Injected timeout', 'TimeoutError');
                return new Response(null, { status: failure });
            })
            .mockResolvedValueOnce(Response.json(keyPayload));
        vi.stubGlobal('fetch', fetch);
        // Auth/consent, App Check and the cloud writer are collaborators.
        // The key client, replica, retry controller, AEAD, IndexedDB and ACK are real.
        remote.apply.mockImplementationOnce(async () => {
            const { documents, syncMetas } = applySemanticOperations(
                projectDocuments(data(170), getSeedCatalog()), before!.pending,
            );
            return { documents, syncMeta: syncMetas };
        });
        const first = await replicateJournal('user:a');
        expect(first.status).toBe('local-pending');
        expect(remote.apply).not.toHaveBeenCalled();
        expect(await get('logbook:v2:user:a')).toEqual(ciphertext);
        expect((await readLocal('user:a'))?.pending).toEqual(before!.pending);

        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let state: JournalRetryState = {
            syncHealth: first.status, syncing: false, localPersistenceBlocked: false, compatibilityStatus: 'ok',
        };
        const retry = createJournalRetry(
            () => state, () => () => {}, () => true,
            async () => {
                state = { ...state, syncing: true };
                const result = await replicateJournal('user:a');
                state = { ...state, syncing: false, syncHealth: result.status };
            },
        );
        try {
            await vi.advanceTimersByTimeAsync(19_999);
            expect(fetch).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            // Real IndexedDB completes outside the fake timer queue.
            await vi.waitFor(() => expect(state.syncHealth).toBe('synced'));
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(remote.apply).toHaveBeenCalledTimes(1);
            const recovered = await readLocal('user:a');
            expect(recovered?.pending).toHaveLength(0);
            expect(recovered?.data.profile?.height).toBe('171');
            expect(recovered?.baseline.profile?.height).toBe('171');
            await vi.advanceTimersByTimeAsync(300_000);
            expect(fetch).toHaveBeenCalledTimes(2);
        } finally { retry.dispose(); }
    },
);
