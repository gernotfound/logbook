import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BrowserStorageError,
    readBrowserValue,
    readBrowserValueStrict,
    writeBrowserJson,
    writeBrowserValue,
} from '../src/lib/sync/browserStorage';
import {
    AccountDeletionMarkerCorruptError,
    findPendingAccountDeletion,
    isAccountDeletionPending,
    markAccountDeletion,
    readAccountDeletionMarker,
} from '../src/lib/sync/accountGate';
import { readDeviceValue, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import {
    DeletionRecoveryCredentialCorruptError,
    removeDeletionRecoveryCredential,
} from '../src/lib/deletionDeviceRecovery';
import { storageOwner } from '../src/lib/sync/session';
import { localStorageMock } from './setup';

const OWNER = 'user:test-user';
const storageFailure = () => { throw new DOMException('blocked', 'SecurityError'); };

describe('browser storage boundary', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps optional reads best-effort while strict reads expose storage failures', () => {
        localStorageMock.getItem
            .mockImplementationOnce(storageFailure)
            .mockImplementationOnce(storageFailure);

        expect(readBrowserValue('optional')).toBeNull();
        expect(() => readBrowserValueStrict('critical')).toThrow(BrowserStorageError);
    });

    it('does not report a critical write as successful when storage rejects it', () => {
        localStorageMock.setItem.mockImplementationOnce(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });

        expect(() => writeBrowserValue('critical', 'value')).toThrow(BrowserStorageError);
    });

    it('contains JSON serialization failures inside the same storage contract', () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;

        expect(() => writeBrowserJson('cyclic', cyclic)).toThrow(BrowserStorageError);
    });

    it('keeps account deletion fail-closed when its marker cannot be read', () => {
        localStorageMock.getItem.mockImplementationOnce(storageFailure);

        expect(isAccountDeletionPending(OWNER)).toBe(true);
    });

    it('keeps a present but corrupt account-deletion marker fail-closed', () => {
        localStorage.setItem('logbook:v2:' + OWNER + ':account-deletion', '{"startedAt":');

        expect(isAccountDeletionPending(OWNER)).toBe(true);
        expect(() => readAccountDeletionMarker(OWNER)).toThrow(AccountDeletionMarkerCorruptError);
        expect(() => findPendingAccountDeletion()).toThrow(AccountDeletionMarkerCorruptError);
    });

    it('blocks an absent-marker conclusion during cross-tab index compaction and retries safely', () => {
        const unrelated = 'cross-tab:transient';
        localStorage.setItem(unrelated, 'present');
        markAccountDeletion(OWNER, { receiptToken: 'receipt-A' });

        const originalKey = localStorageMock.key.getMockImplementation();
        if (!originalKey) throw new Error('Missing localStorage mock implementation');
        let compacted = false;
        localStorageMock.key.mockImplementation((index: number) => {
            const found = originalKey(index);
            if (!compacted && found === unrelated) {
                compacted = true;
                localStorage.removeItem(unrelated);
            }
            return found;
        });
        try {
            expect(() => findPendingAccountDeletion()).toThrow('Inventario marker cancellazione account');
        } finally {
            localStorageMock.key.mockImplementation(originalKey);
        }

        expect(compacted).toBe(true);
        expect(readAccountDeletionMarker(OWNER)?.receiptToken).toBe('receipt-A');
        expect(findPendingAccountDeletion()?.uid).toBe('test-user');
    });

    it('rejects an account-deletion marker whose UID does not match its owner key', () => {
        localStorage.setItem('logbook:v2:' + OWNER + ':account-deletion', JSON.stringify({
            uid: 'other-user',
            startedAt: Date.now(),
        }));

        expect(() => readAccountDeletionMarker(OWNER)).toThrow(AccountDeletionMarkerCorruptError);
    });

    it('refuses to start account deletion when the durable local marker cannot be written', () => {
        localStorageMock.setItem.mockImplementationOnce(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });

        expect(() => markAccountDeletion(OWNER)).toThrow(BrowserStorageError);
    });

    it('fails closed instead of guessing the storage owner when ownership markers are unreadable', () => {
        localStorageMock.getItem.mockImplementationOnce(storageFailure);

        expect(() => storageOwner()).toThrow(BrowserStorageError);
    });

    it('keeps best-effort device reads non-throwing while owner resolution is unavailable', () => {
        localStorageMock.getItem.mockImplementationOnce(storageFailure);

        expect(readDeviceValue('workout')).toBeNull();
    });

    it('wraps device-storage write and remove failures in BrowserStorageError', () => {
        localStorageMock.setItem.mockImplementationOnce(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });
        expect(() => writeDeviceValue('workout', '{}', OWNER)).toThrow(BrowserStorageError);

        localStorageMock.removeItem.mockImplementationOnce(storageFailure);
        expect(() => writeDeviceValue('workout', null, OWNER)).toThrow(BrowserStorageError);
    });

    it.each([
        { kind: 'plaintext legacy draft', original: '{"weight":"75"}' },
        { kind: 'orphaned sealed legacy draft', original: 'tlb-sealed:v1:unreadable-original' },
    ])('preserves a $kind when the pre-vault target read temporarily fails', ({ original }) => {
        const name = 'draft:measurement:2026-10-20';
        const key = 'logbook:v2:' + OWNER + ':' + name;
        for (const next of ['{"weight":"76"}', null]) {
            localStorage.setItem(key, original);
            const priorSetCalls = localStorageMock.setItem.mock.calls.length;
            const priorRemoveCalls = localStorageMock.removeItem.mock.calls.length;
            const originalGet = localStorageMock.getItem.getMockImplementation();
            if (!originalGet) throw new Error('Missing localStorage mock implementation');
            let failed = false;
            localStorageMock.getItem.mockImplementation((readKey: string) => {
                if (!failed && readKey === key) {
                    failed = true;
                    throw new DOMException('read unavailable', 'SecurityError');
                }
                return originalGet(readKey);
            });
            try {
                expect(() => writeDeviceValue(name, next, OWNER)).toThrow(BrowserStorageError);
                expect(failed).toBe(true);
                expect(localStorageMock.setItem).toHaveBeenCalledTimes(priorSetCalls);
                expect(localStorageMock.removeItem).toHaveBeenCalledTimes(priorRemoveCalls);
            } finally {
                localStorageMock.getItem.mockImplementation(originalGet);
            }
            expect(localStorage.getItem(key)).toBe(original);
        }
    });

    it('keeps deletion-recovery credential reads on the strict browser-storage boundary', () => {
        localStorageMock.getItem.mockImplementationOnce(storageFailure);

        expect(() => removeDeletionRecoveryCredential('test-user')).toThrow(BrowserStorageError);
    });

    it('does not treat corrupt deletion-recovery credentials as an empty registry', () => {
        localStorage.setItem('logbook_deletion_recovery_devices_v1', '{"uid":');

        expect(() => removeDeletionRecoveryCredential('test-user')).toThrow(DeletionRecoveryCredentialCorruptError);
    });

    it('keeps deletion-recovery credential writes on the strict browser-storage boundary', () => {
        localStorage.setItem('logbook_deletion_recovery_devices_v1', JSON.stringify([
            { uid: 'test-user', token: 'A'.repeat(43) },
        ]));
        localStorageMock.removeItem.mockImplementationOnce(storageFailure);

        expect(() => removeDeletionRecoveryCredential('test-user')).toThrow(BrowserStorageError);
    });
});