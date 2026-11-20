import React, { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../../../src/lib/sync/bufferedDraftEpoch';
import { readBufferedWriterEvidence } from '../../../src/lib/sync/bufferedDraftWriterIntent';
import { activateGuestSession, captureSession, GUEST_SESSION_KEY, invalidateSession } from '../../../src/lib/sync/session';
import { requiredUpdateRecoveryRegistry } from '../../../src/lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../../../src/store/useAppStore';
import { localStorageMock } from '../../setup';
import { field, editor, initialGetItem, initialSetItem } from './bufferedRecoveryFixtures';

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


    it('reads the recovery key at mount, not on unrelated rerenders', async () => {
        const onChange = vi.fn();
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const name = `draft:buffered:${kind}:stable-draft`;
        const key = protectedDeviceKey(name, owner);
        const previousReads = localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key).length;
        const view = render(field(kind, onChange));
        const initialReads = localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key).length;
        expect(initialReads - previousReads).toBe(1);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();

        // A transient failure *after* mount must not turn an unrelated React
        // rerender into another strict device-storage read or a global block.
        localStorageMock.getItem.mockImplementation((readKey: string) => {
            if (readKey === key) throw new DOMException('unavailable', 'SecurityError');
            return initialGetItem(readKey);
        });

        expect(() => view.rerender(field(kind, onChange, 'server update'))).not.toThrow();
        expect(localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key)).toHaveLength(initialReads);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(editor().value).toBe('server update');
        view.unmount();
    });

    it('fails closed after commit when the initial owner-scoped read throws', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const name = `draft:buffered:${kind}:stable-draft`;
        const key = protectedDeviceKey(name, owner);
        const onChange = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.getItem.mockImplementation((readKey: string) => {
            if (readKey === key) throw new DOMException('unavailable', 'SecurityError');
            return initialGetItem(readKey);
        });

        let committed = false;
        const phaseOfBlock: boolean[] = [];
        const unsubscribe = useAppStore.subscribe((state, previous) => {
            if (state.localPersistenceBlocked && !previous.localPersistenceBlocked) phaseOfBlock.push(committed);
        });
        function CommitBoundary() {
            useLayoutEffect(() => { committed = true; }, []);
            return field(kind, onChange);
        }

        try {
            const view = render(<CommitBoundary />);
            expect(phaseOfBlock).toEqual([true]);
            expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
            expect(useAppStore.getState().syncHealth).toBe('failed');
            expect(useAppStore.getState().saveError).toMatch(/bozza/i);
            expect(onChange).not.toHaveBeenCalled();
            expect(consoleError.mock.calls.some(args => args.some(arg =>
                typeof arg === 'string' && /Cannot update a component while rendering/i.test(arg),
            ))).toBe(false);
            const reads = localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key).length;
            view.rerender(<CommitBoundary />);
            expect(localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key)).toHaveLength(reads);
            expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
            view.unmount();
        } finally {
            unsubscribe();
        }
    });

    it('restores a durable draft, then removes it only after the owner confirms the value', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const name = `draft:buffered:${kind}:stable-draft`;
        const legacyKey = deviceKey(name, owner);
        const sealedKey = protectedDeviceKey(name, owner);
        const stored = kind === 'input' ? '7,5' : 'Nota recuperata dopo riavvio';
        const committed = kind === 'input' ? '7.5' : stored;
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        writeBufferedDraft(name, owner, stored);
        const ciphertext = localStorage.getItem(sealedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(legacyKey)).toBeNull();
        const onChange = vi.fn();
        const view = render(field(kind, onChange));

        expect(editor().value).toBe(stored);
        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
        expect(readBufferedDraftSnapshot(name, owner).value).toBe(stored);

        fireEvent.blur(editor());
        expect(onChange).toHaveBeenCalledExactlyOnceWith(committed);
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);

        view.rerender(field(kind, onChange, committed));
        expect(localStorage.getItem(sealedKey)).toBeNull();
        expect(readDeviceValueStrict(name, owner)).toBeNull();
        expect(localStorage.getItem(legacyKey)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });

    it.each(['canonical-only', 'all-storage'] as const)('blocks persistence and unsafe update recovery after %s quota failure', async failure => {
        const owner = captureSession().owner;
        localStorage.setItem(deviceKey('health-consent-generation', owner), '1');
        await prepareUnlockedTestArchive(owner);
        const name = `draft:buffered:${kind}:stable-draft`;
        const key = protectedDeviceKey(name, owner);
        const onChange = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.setItem.mockImplementation((writtenKey: string, value: string) => {
            if (failure === 'all-storage' || writtenKey === key) throw new DOMException('full', 'QuotaExceededError');
            return initialSetItem(writtenKey, value);
        });

        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: 'Bozza nuova' } });

        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(localStorage.getItem(key)).toBeNull();
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
        const witnesses = readBufferedWriterEvidence(owner, name);
        if (failure === 'all-storage') {
            expect(witnesses).toEqual([]);
            expect(editor().value).toBe('Bozza nuova');
        } else {
            expect(witnesses).toHaveLength(1);
            const [witness] = witnesses;
            expect(witness.value).toBe('Bozza nuova');
            expect(localStorage.getItem(protectedDeviceKey(witness.name, owner))).toMatch(/^tlb-sealed:v1:/);
            expect(localStorage.getItem(deviceKey(witness.name, owner))).toBeNull();
        }
        expect(onChange).not.toHaveBeenCalled();
        expect(() => requiredUpdateRecoveryRegistry.captureAll()).toThrow(AggregateError);
        expect(consoleError).toHaveBeenCalled();
        view.unmount();
    });

    it('never moves a mounted guest draft to a newly authenticated owner', async () => {
        // An input event may arrive before an old editor unmounts during login.
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'buffered-draft-guest-generation');
        activateGuestSession('buffered-draft-guest-generation');
        await prepareUnlockedTestArchive('guest');
        expect(captureSession().owner).toBe('guest');
        const onChange = vi.fn();
        const view = render(field(kind, onChange));

        fireEvent.change(editor(), { target: { value: 'guest note' } });
        const guestName = `draft:buffered:${kind}:stable-draft`;
        const sealedGuestKey = protectedDeviceKey(guestName, 'guest');
        const sealedOriginal = localStorage.getItem(sealedGuestKey);
        expect(sealedOriginal).toMatch(/^tlb-sealed:v1:/);
        expect(readBufferedDraftSnapshot(guestName, 'guest').value).toBe('guest note');

        localStorage.removeItem('logbook_is_guest');
        invalidateSession();
        const newOwner = captureSession().owner;
        expect(newOwner).toMatch(/^user:/);
        const otherKey = deviceKey(`draft:buffered:${kind}:stable-draft`, newOwner);

        fireEvent.change(editor(), { target: { value: 'late edit' } });
        expect(localStorage.getItem(sealedGuestKey)).toBe(sealedOriginal);
        expect(localStorage.getItem(otherKey)).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
        expect(useAppStore.getState().saveError).toMatch(/bozza non ancora protetta/i);
        view.unmount();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the original owner draft and never flushes it after session invalidation', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const name = `draft:buffered:${kind}:stable-draft`;
        const key = protectedDeviceKey(name, owner);
        const onChange = vi.fn();
        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: 'solo per questa sessione' } });

        const ciphertext = localStorage.getItem(key);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
        expect(readBufferedDraftSnapshot(name, owner).value).toBe('solo per questa sessione');
        expect(onChange).not.toHaveBeenCalled();
        invalidateSession();
        view.unmount();

        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).toBe(ciphertext);
        expect(localStorage.getItem(deviceKey(name, owner))).toBeNull();
    });

    it('preserves input Enter versus textarea blur semantics and clears only acknowledged drafts', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        // Authenticated writers require a current, positive consent revision.
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        const draftName = `draft:buffered:${kind}:stable-draft`;
        const onChange = vi.fn();
        const view = render(field(kind, onChange));

        fireEvent.focus(editor());
        fireEvent.change(editor(), { target: { value: '7,5' } });
        expect(editor().value).toBe('7,5');
        expect(readBufferedDraftSnapshot(draftName, owner).value).toBe('7,5');
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(1);
        expect(onChange).not.toHaveBeenCalled();

        fireEvent.keyDown(editor(), { key: 'Enter' });
        if (kind === 'input') {
            expect(onChange).toHaveBeenCalledExactlyOnceWith('7.5');
        } else {
            // The multiline editor must not inherit the input's Enter-to-commit behavior.
            expect(onChange).not.toHaveBeenCalled();
        }

        fireEvent.blur(editor());
        const acknowledged = kind === 'input' ? '7.5' : '7,5';
        expect(onChange).toHaveBeenCalledExactlyOnceWith(acknowledged);
        expect(readBufferedDraftSnapshot(draftName, owner).value).toBe('7,5');

        view.rerender(field(kind, onChange, acknowledged));
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toEqual([]);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });

});
