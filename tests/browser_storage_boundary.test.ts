import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BrowserStorageError,
    readBrowserValue,
    readBrowserValueStrict,
    writeBrowserJson,
    writeBrowserValue,
} from '../src/lib/sync/browserStorage';
import { isAccountDeletionPending, markAccountDeletion } from '../src/lib/sync/accountGate';
import { readDeviceValue } from '../src/lib/sync/deviceStorage';
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
});
