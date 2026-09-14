import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from '../src/store/useAppStore';
import { CURRENT_DATA_SCHEMA, CURRENT_SYNC_PROTOCOL, FutureVersionError, normalizeCloudDocument } from '../src/lib/schemaEvolution';

describe('runtime update-required compatibility signal', () => {
    beforeEach(() => {
        useAppStore.setState({
            compatibilityStatus: 'ok',
            compatibilityError: null,
            saveError: null,
            syncing: false,
            syncHealth: 'synced',
        });
    });

    it('enters fail-closed state for a future root data schema', () => {
        expect(() => normalizeCloudDocument({
            _schemaVersion: CURRENT_DATA_SCHEMA + 1,
            profile: { name: 'future' },
        }, 'Firestore root data schema')).toThrow(FutureVersionError);

        expect(useAppStore.getState().compatibilityStatus).toBe('update-required');
        expect(useAppStore.getState().compatibilityError).toContain('aggiorna LogBook');
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
