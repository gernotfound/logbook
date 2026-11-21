import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../../../src/lib/sync/bufferedDraftEpoch';
import { captureSession } from '../../../src/lib/sync/session';
import { requiredUpdateRecoveryRegistry } from '../../../src/lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../../../src/store/useAppStore';
import { localStorageMock } from '../../setup';
import { field, recoveryKey, editor, initialGetItem, initialSetItem } from './bufferedRecoveryFixtures';

describe.each(['input', 'textarea'] as const)('owner-scoped buffered %s recovery', kind => {
    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        useAppStore.setState({
            localPersistenceBlocked: false,
            syncHealth: 'synced',
            syncPresentation: 'normal',
            saveError: null,
        });
    });

    afterEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });


    it('quarantines an unversioned old buffered draft after erasure without overwriting it', () => {
        const key = recoveryKey(kind);
        const owner = captureSession().owner;
        const raw = 'Previously deleted health detail';
        localStorage.setItem(key, raw);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const onChange = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const view = render(field(kind, onChange, 'current value'));
        expect(editor().value).toBe('current value');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(editor(), { target: { value: 'new edit' } });
        fireEvent.blur(editor());
        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).toBe(raw);
        expect(consoleError).toHaveBeenCalled();
        view.unmount();
    });

    it('rejects encrypted but unversioned account drafts even on the first consent revision', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const name = `draft:buffered:${kind}:stable-draft`;
        const sealedKey = protectedDeviceKey(name, owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '1');
        writeDeviceValue(name, 'old pre-launch draft', owner);
        const original = localStorage.getItem(sealedKey);
        expect(original).toMatch(/^tlb-sealed:v1:/);

        expect(() => readBufferedDraftSnapshot(name, owner)).toThrow(/senza provenienza/);
        expect(() => writeBufferedDraft(name, owner, 'replacement')).toThrow(/senza provenienza/);
        expect(() => writeBufferedDraft(name, owner, null)).toThrow(/senza provenienza/);
        expect(localStorage.getItem(sealedKey)).toBe(original);
    });

    it('does not create an unstamped account draft if the consent-generation marker is missing', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const name = `draft:buffered:${kind}:stable-draft`;
        expect(() => writeBufferedDraft(name, owner, 'unsafe draft')).toThrow(/Generazione consenso/);
        expect(readDeviceValueStrict(name, owner)).toBeNull();
    });

    it('writes a stamped epoch-bound record and never flushes a mounted stale editor', async () => {
        const key = recoveryKey(kind);
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const onChange = vi.fn();
        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: 'private current edit' } });
        const name = `draft:buffered:${kind}:stable-draft`;
        const raw = readBufferedDraftSnapshot(name, owner).raw;
        const sealedKey = protectedDeviceKey(name, owner);
        const ciphertext = localStorage.getItem(sealedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(raw!)).toMatchObject({
            __logbookBufferedDraft: 1, owner,
            name: `draft:buffered:${kind}:stable-draft`,
            consentRevision: 3, value: 'private current edit',
        });

        localStorage.setItem(marker, '5');
        expect(() => requiredUpdateRecoveryRegistry.captureAll()).toThrow(AggregateError);
        fireEvent.blur(editor());
        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(useAppStore.getState().saveError).toMatch(/bozza/i);
        view.unmount();
    });

    it('refuses automatic cleanup of a buffered record from a previous revision', async () => {
        const key = recoveryKey(kind);
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const onChange = vi.fn();
        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: '30' } });
        const name = `draft:buffered:${kind}:stable-draft`;
        const sealedKey = protectedDeviceKey(name, owner);
        const raw = readBufferedDraftSnapshot(name, owner).raw;
        const ciphertext = localStorage.getItem(sealedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(key)).toBeNull();
        fireEvent.blur(editor());
        expect(onChange).toHaveBeenCalledTimes(1);
        localStorage.setItem(marker, '5');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        view.rerender(field(kind, onChange, kind === 'input' ? '30' : '30'));
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(raw!)).toMatchObject({ consentRevision: 3, value: '30' });
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(consoleError).toHaveBeenCalled();
        view.unmount();
    });

    it('preserves a stamped buffered draft with tampered owner metadata', () => {
        const key = recoveryKey(kind);
        const owner = captureSession().owner;
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const raw = JSON.stringify({
            __logbookBufferedDraft: 1, owner: 'user:unrelated',
            name: `draft:buffered:${kind}:stable-draft`,
            consentRevision: 3, value: 'wrong owner secret',
        });
        localStorage.setItem(key, raw);
        const onChange = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const view = render(field(kind, onChange));
        expect(editor().value).toBe('');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(localStorage.getItem(key)).toBe(raw);
        expect(onChange).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
        view.unmount();
    });
});
