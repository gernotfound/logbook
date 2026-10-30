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
    listPendingAccountDeletions,
    clearAccountDeletion,
    isAccountDeletionPending,
    markAccountDeletion,
    readAccountDeletionMarker,
} from '../src/lib/sync/accountGate';
import { readDeviceValueStrict, writeDeviceValue } from '../src/lib/sync/deviceStorage';
import { LocalVaultLockedError } from '../src/lib/sync/secureArchiveSession';
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

    it.each([
        { label: 'undefined', value: undefined },
        { label: 'function', value: () => 'not JSON' },
        { label: 'symbol', value: Symbol('not JSON') },
        { label: 'custom toJSON returning undefined', value: { toJSON: () => undefined } },
    ])('preserves the stored value when $label has no JSON representation', ({ value }) => {
        const key = 'json-value';
        const original = '{"preserved":true}';
        localStorage.setItem(key, original);
        const writesBefore = localStorageMock.setItem.mock.calls.length;

        expect(() => writeBrowserJson(key, value)).toThrow(BrowserStorageError);
        expect(localStorageMock.setItem).toHaveBeenCalledTimes(writesBefore);
        expect(localStorage.getItem(key)).toBe(original);
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

    it.each([
        { label: 'missing owner', value: { uid: 'test-user', startedAt: 1 } },
        { label: 'another owner', value: { owner: 'user:another', uid: 'test-user', startedAt: 1 } },
        { label: 'missing uid', value: { owner: OWNER, startedAt: 1 } },
        { label: 'coercible timestamp', value: { owner: OWNER, uid: 'test-user', startedAt: '42' } },
        { label: 'boolean timestamp', value: { owner: OWNER, uid: 'test-user', startedAt: true } },
        { label: 'fractional timestamp', value: { owner: OWNER, uid: 'test-user', startedAt: 1.5 } },
        { label: 'coercible acceptance time', value: { owner: OWNER, uid: 'test-user', startedAt: 1, serverAcceptedAt: '2' } },
        { label: 'null receipt', value: { owner: OWNER, uid: 'test-user', startedAt: 1, receiptToken: null } },
        { label: 'null object', value: null },
        { label: 'array object', value: [{ owner: OWNER, uid: 'test-user', startedAt: 1 }] },
    ])('keeps a $label deletion marker fenced without overwriting its bytes', ({ value }) => {
        const storageKey = 'logbook:v2:' + OWNER + ':account-deletion';
        const raw = JSON.stringify(value);
        localStorage.setItem(storageKey, raw);

        expect(isAccountDeletionPending(OWNER)).toBe(true);
        expect(() => readAccountDeletionMarker(OWNER)).toThrow(AccountDeletionMarkerCorruptError);
        expect(() => markAccountDeletion(OWNER, { receiptToken: 'safe-retry' })).toThrow(AccountDeletionMarkerCorruptError);
        const result = listPendingAccountDeletions();
        expect(result.markers).toHaveLength(0);
        expect(result.corrupt).toHaveLength(1);
        expect(() => findPendingAccountDeletion()).toThrow(AccountDeletionMarkerCorruptError);
        expect(localStorage.getItem(storageKey)).toBe(raw);
    });

    it('accepts complete typed markers and optional receipts without weakening identity checks', () => {
        const marker = markAccountDeletion(OWNER);
        expect(readAccountDeletionMarker(OWNER)).toMatchObject({
            owner: OWNER, uid: 'test-user', startedAt: marker.startedAt,
        });
        expect(readAccountDeletionMarker(OWNER)?.receiptToken).toBeUndefined();
        markAccountDeletion(OWNER, { receiptToken: 'receipt-A', serverAcceptedAt: 23 });
        expect(readAccountDeletionMarker(OWNER)).toMatchObject({
            owner: OWNER, uid: 'test-user', startedAt: marker.startedAt,
            receiptToken: 'receipt-A', serverAcceptedAt: 23,
        });
    });

    it('keeps valid receipts recoverable when reading another owner marker fails', () => {
        const otherOwner = 'user:other';
        markAccountDeletion(OWNER, { receiptToken: 'receipt-A' });
        markAccountDeletion(otherOwner, { receiptToken: 'receipt-B' });
        const originalRead = localStorageMock.getItem.getMockImplementation();
        if (!originalRead) throw new Error('Missing localStorage mock read implementation');
        localStorageMock.getItem.mockImplementation((storageKey: string) => {
            if (storageKey === 'logbook:v2:' + otherOwner + ':account-deletion') return storageFailure();
            return originalRead(storageKey);
        });
        try {
            const result = listPendingAccountDeletions();
            expect(result.markers.map(x => x.uid)).toEqual(['test-user']);
            expect(result.corrupt).toHaveLength(1);
            expect(result.corrupt[0]).toMatchObject({ owner: otherOwner });
            expect(() => findPendingAccountDeletion()).toThrow(AccountDeletionMarkerCorruptError);
            expect(isAccountDeletionPending(otherOwner)).toBe(true);
        } finally {
            localStorageMock.getItem.mockImplementation(originalRead);
        }
        expect(readAccountDeletionMarker(otherOwner)?.receiptToken).toBe('receipt-B');
    });

    it('preserves a disappearing indexed marker as corrupt, not silently absent', () => {
        markAccountDeletion(OWNER, { receiptToken: 'receipt-A' });
        const originalRead = localStorageMock.getItem.getMockImplementation();
        if (!originalRead) throw new Error('Missing localStorage mock read implementation');
        localStorageMock.getItem.mockImplementation((storageKey: string) =>
            storageKey === 'logbook:v2:' + OWNER + ':account-deletion' ? null : originalRead(storageKey));
        try {
            const result = listPendingAccountDeletions();
            expect(result.markers).toHaveLength(0);
            expect(result.corrupt).toHaveLength(1);
            expect(() => findPendingAccountDeletion()).toThrow(AccountDeletionMarkerCorruptError);
        } finally {
            localStorageMock.getItem.mockImplementation(originalRead);
        }
        expect(readAccountDeletionMarker(OWNER)?.receiptToken).toBe('receipt-A');
    });

    it('never treats missing localStorage as a recovered deletion or successful cleanup', () => {
        vi.stubGlobal('localStorage', undefined);
        try {
            expect(isAccountDeletionPending(OWNER)).toBe(true);
            expect(() => readAccountDeletionMarker(OWNER)).toThrow(BrowserStorageError);
            expect(() => listPendingAccountDeletions()).toThrow(BrowserStorageError);
            expect(() => findPendingAccountDeletion()).toThrow(BrowserStorageError);
            expect(() => clearAccountDeletion(OWNER)).toThrow(BrowserStorageError);
        } finally {
            vi.unstubAllGlobals();
        }
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

    it('fails closed when the owner cannot be resolved for a device-critical read', () => {
        localStorageMock.getItem.mockImplementationOnce(storageFailure);

        expect(() => readDeviceValueStrict('workout')).toThrow(BrowserStorageError);
    });

    it.each([
        { kind: 'plaintext pre-launch record', original: '{"weight":"75"}' },
        { kind: 'orphaned ciphertext', original: 'tlb-sealed:v1:unreadable-original' },
    ])('never reads, writes or deletes a $kind without an active vault', ({ original }) => {
        const name = 'draft:measurement:2026-10-20';
        const key = 'logbook:v2:' + OWNER + ':' + name;
        localStorage.setItem(key, original);
        const beforeWrites = localStorageMock.setItem.mock.calls.length;
        const beforeRemoves = localStorageMock.removeItem.mock.calls.length;
        expect(() => readDeviceValueStrict(name, OWNER)).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue(name, '{"weight":"76"}', OWNER)).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue(name, null, OWNER)).toThrow(LocalVaultLockedError);
        expect(localStorage.getItem(key)).toBe(original);
        expect(localStorageMock.setItem).toHaveBeenCalledTimes(beforeWrites);
        expect(localStorageMock.removeItem).toHaveBeenCalledTimes(beforeRemoves);
    });

    it('refuses device access before provisioning even if the owner has no records', () => {
        expect(() => readDeviceValueStrict('workout', OWNER)).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue('workout', null, OWNER)).toThrow(LocalVaultLockedError);
        expect(() => writeDeviceValue('workout', '{}', OWNER)).toThrow(LocalVaultLockedError);
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