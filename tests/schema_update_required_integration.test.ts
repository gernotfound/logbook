import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL, FutureVersionError, normalizeCloudDocument } from '../src/lib/schemaEvolution';
import { requiredUpdateRecoveryRegistry } from '../src/lib/sync/requiredUpdateRecovery';

describe('health consent writer metadata during cloud normalization', () => {
    const cloudDocument = (consentRevision?: unknown) => ({
        _schemaVersion: CURRENT_DATA_SCHEMA,
        profile: { height: '178' },
        _sync: {
            protocolVersion: CURRENT_SYNC_PROTOCOL,
            clock: {},
            fields: {},
            writer: {
                slot: 's00', replicaId: 'health-consent-device', generation: 1, seq: 0,
                ...(consentRevision === undefined ? {} : { consentRevision }),
            },
        },
    });

    it('loads a post-reacceptance server writer without losing the consent epoch', () => {
        expect(normalizeCloudDocument(cloudDocument(2))).toMatchObject({
            business: { profile: { height: '178' } },
            sync: { writer: { slot: 's00', generation: 1, seq: 0, consentRevision: 2 } },
        });
        expect(normalizeCloudDocument(cloudDocument()).sync).toMatchObject({
            writer: { slot: 's00', generation: 1, seq: 0 },
        });
    });

    it('rejects invalid writer consent epochs instead of silently stripping them', () => {
        for (const revision of [-1, 1.5, '2', null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
            expect(() => normalizeCloudDocument(cloudDocument(revision))).toThrow();
        }
    });
});

describe('runtime update-required compatibility signal', () => {
    beforeEach(() => {
        useAppStore.setState({
            compatibilityStatus: 'ok',
            compatibilityError: null,
            saveError: null,
            syncing: false,
            syncHealth: 'synced',
            localPersistenceBlocked: false,
        });
    });

    it('enters fail-closed state for a future root data schema', () => {
        expect(() => normalizeCloudDocument({
            _schemaVersion: CURRENT_DATA_SCHEMA + 1,
            profile: { name: 'future' },
        }, 'Firestore root data schema')).toThrow(FutureVersionError);

        expect(useAppStore.getState().compatibilityStatus).toBe('update-required');
        expect(useAppStore.getState().compatibilityError).toContain('aggiorna TheLogBook');
    });

    it('blocks the transition before session invalidation when volatile recovery fails', () => {
        const unregister = requiredUpdateRecoveryRegistry.register(() => {
            throw new Error('quota');
        });
        try {
            expect(() => normalizeCloudDocument({
                _schemaVersion: CURRENT_DATA_SCHEMA + 1,
                profile: { name: 'future' },
            }, 'Firestore root data schema')).toThrow(FutureVersionError);

            expect(useAppStore.getState().compatibilityStatus).toBe('ok');
            expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
            expect(useAppStore.getState().saveError).toContain('ricaricamento è bloccato');
        } finally {
            unregister();
        }
    });

    it('also enters fail-closed state for a future monthly sync protocol regardless of diagnostic label', () => {
        expect(() => normalizeCloudDocument({
            _schemaVersion: CURRENT_DATA_SCHEMA,
            _sync: { protocolVersion: CURRENT_SYNC_PROTOCOL + 1, clock: {}, fields: {} },
        }, 'history_months/2026-09 data schema')).toThrow(FutureVersionError);

        expect(useAppStore.getState().compatibilityStatus).toBe('update-required');
        expect(useAppStore.getState().compatibilityError).toContain('sync protocol');
    });
});
