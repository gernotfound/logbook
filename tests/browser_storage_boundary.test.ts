import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    BrowserStorageError,
    readBrowserValue,
    readBrowserValueStrict,
    writeBrowserJson,
    writeBrowserValue,
} from '../src/lib/sync/browserStorage';
import { isAccountDeletionPending, markAccountDeletion } from '../src/lib/sync/accountGate';

const OWNER = 'user:test-user';

describe('browser storage boundary', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps optional reads best-effort while strict reads expose storage failures', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });

        expect(readBrowserValue('optional')).toBeNull();
        expect(() => readBrowserValueStrict('critical')).toThrow(BrowserStorageError);
    });

    it('does not report a critical write as successful when storage rejects it', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
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
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new DOMException('blocked', 'SecurityError');
        });

        expect(isAccountDeletionPending(OWNER)).toBe(true);
    });

    it('refuses to start account deletion when the durable local marker cannot be written', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new DOMException('full', 'QuotaExceededError');
        });

        expect(() => markAccountDeletion(OWNER)).toThrow(BrowserStorageError);
    });
});
