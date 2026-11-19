import React, { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BufferedWorkoutScope } from '../../../src/components/UI/bufferedWorkoutScope';
import type { WorkoutSession } from '../../../src/types';
import { deviceKey, protectedDeviceKey, readDeviceValueStrict, writeDeviceValue } from '../../../src/lib/sync/deviceStorage';
import { prepareUnlockedTestArchive } from '../../secureVaultFixture';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../../../src/lib/sync/bufferedDraftEpoch';
import { createBufferedWriterIntentName, readBufferedWriterEvidence, writeBufferedWriterIntent } from '../../../src/lib/sync/bufferedDraftWriterIntent';
import { activateGuestSession, captureSession, GUEST_SESSION_KEY, invalidateSession } from '../../../src/lib/sync/session';
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

describe.each(['input', 'textarea'] as const)('workout-scoped buffered %s recovery', kind => {
    const firstId = 'workout-first';
    const secondId = 'workout-second';
    const name = (workoutId: string) => `draft:buffered:${kind}:${workoutId}:stable-draft`;
    const scoped = (workoutId: string, onChange: (value: string) => void, value = '') => (
        <BufferedWorkoutScope.Provider key={workoutId} value={workoutId}>
            {field(kind, onChange, value)}
        </BufferedWorkoutScope.Provider>
    );
    const activate = (workoutId: string) => {
        useAppStore.setState({ localWorkout: { id: workoutId } as WorkoutSession });
    };

    beforeEach(() => {
        localStorage.clear();
        useAppStore.setState({
            localWorkout: null,
            localPersistenceBlocked: false,
            syncHealth: 'synced',
            syncPresentation: 'normal',
            saveError: null,
        });
    });

    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        vi.restoreAllMocks();
    });

    it('does not resurrect a same-consent unscoped legacy note in another workout', () => {
        const owner = captureSession().owner;
        const oldKey = deviceKey(`draft:buffered:${kind}:stable-draft`, owner);
        const oldRecord = JSON.stringify({
            __logbookBufferedDraft: 1, owner,
            name: `draft:buffered:${kind}:stable-draft`,
            consentRevision: 3, value: 'private value from a previous workout',
        });
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        localStorage.setItem(oldKey, oldRecord);

        activate(secondId);
        const onChange = vi.fn();
        const view = render(scoped(secondId, onChange, 'new workout value'));
        expect(editor().value).toBe('new workout value');
        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(oldKey)).toBe(oldRecord);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        view.unmount();
    });

    it('does not replay a prior workout and does not flush its mounted input into the next workout', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const firstKey = protectedDeviceKey(name(firstId), owner);
        const secondKey = protectedDeviceKey(name(secondId), owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        activate(firstId);
        const firstChange = vi.fn();
        const secondChange = vi.fn();
        const view = render(scoped(firstId, firstChange));
        fireEvent.change(editor(), { target: { value: 'first workout secret' } });
        const firstRaw = localStorage.getItem(firstKey);
        expect(firstRaw).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        expect(JSON.parse(readDeviceValueStrict(name(firstId), owner)!)).toMatchObject({
            __logbookBufferedDraft: 1, owner,
            name: name(firstId), consentRevision: 3, value: 'first workout secret',
        });

        // The old dirty field unmounts when a new workout takes over the same
        // React parent. Its cleanup must not mutate the next workout.
        activate(secondId);
        view.rerender(scoped(secondId, secondChange, 'fresh second workout'));
        expect(firstChange).not.toHaveBeenCalled();
        expect(secondChange).not.toHaveBeenCalled();
        expect(editor().value).toBe('fresh second workout');
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        expect(localStorage.getItem(secondKey)).toBeNull();

        fireEvent.change(editor(), { target: { value: 'second workout value' } });
        const secondRaw = localStorage.getItem(secondKey);
        expect(secondRaw).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        expect(JSON.parse(readDeviceValueStrict(name(secondId), owner)!)).toMatchObject({
            name: name(secondId), value: 'second workout value',
        });
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        view.unmount();

        activate(firstId);
        const reopening = render(scoped(firstId, vi.fn()));
        expect(editor().value).toBe('first workout secret');
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        expect(localStorage.getItem(secondKey)).toBe(secondRaw);
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        reopening.unmount();
    });

    it('removes only the matching workout draft after parent confirms the same value', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const firstKey = protectedDeviceKey(name(firstId), owner);
        const secondKey = protectedDeviceKey(name(secondId), owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        activate(firstId);
        const onChange = vi.fn();
        const view = render(scoped(firstId, onChange));
        fireEvent.change(editor(), { target: { value: '6,5' } });
        const firstRaw = localStorage.getItem(firstKey);
        expect(firstRaw).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        writeBufferedDraft(name(secondId), owner, 'different workout', '3');
        const otherValue = localStorage.getItem(secondKey);
        expect(otherValue).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        fireEvent.blur(editor());
        expect(onChange).toHaveBeenCalledExactlyOnceWith(kind === 'input' ? '6.5' : '6,5');
        view.rerender(scoped(firstId, onChange, kind === 'input' ? '6.5' : '6,5'));
        expect(localStorage.getItem(firstKey)).toBeNull();
        expect(localStorage.getItem(secondKey)).toBe(otherValue);
        expect(readBufferedDraftSnapshot(name(secondId), owner).value).toBe('different workout');
        expect(localStorage.getItem(deviceKey(name(firstId), owner))).toBeNull();
        expect(localStorage.getItem(deviceKey(name(secondId), owner))).toBeNull();
        expect(firstRaw).not.toBeNull();
        view.unmount();
    });
});

describe.each(['input', 'textarea'] as const)('concurrent same-workout %s drafts', kind => {
    const workoutId = 'same-workout';
    const draftName = `draft:buffered:${kind}:${workoutId}:stable-draft`;
    const mount = (update: (value: string) => void, value = '') => render(
        <BufferedWorkoutScope.Provider value={workoutId}>
            {field(kind, update, value)}
        </BufferedWorkoutScope.Provider>
    );
    const edited = (view: ReturnType<typeof render>) =>
        view.container.querySelector(kind === 'input' ? 'input' : 'textarea') as HTMLInputElement | HTMLTextAreaElement;

    beforeEach(() => {
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        localStorage.clear();
        useAppStore.setState({
            localWorkout: { id: workoutId } as WorkoutSession,
            localPersistenceBlocked: false, syncHealth: 'synced',
            syncPresentation: 'normal', saveError: null,
        });
        const owner = captureSession().owner;
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
    });
    afterEach(() => {
        useAppStore.setState({ localWorkout: null });
        localStorageMock.getItem.mockImplementation(initialGetItem);
        localStorageMock.setItem.mockImplementation(initialSetItem);
        vi.restoreAllMocks();
    });

    it('rejects a new independent buffered witness before business flush or required-update capture', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const onChange = vi.fn();
        const view = mount(onChange);
        fireEvent.change(edited(view), { target: { value: 'Current input' } });
        const original = readBufferedDraftSnapshot(draftName, owner).raw;
        const contender = createBufferedWriterIntentName();
        writeBufferedWriterIntent(contender, owner, draftName, 'Competing private copy', null, '3');
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(2);
        expect(() => requiredUpdateRecoveryRegistry.captureAll()).toThrow(AggregateError);
        fireEvent.blur(edited(view));
        expect(onChange).not.toHaveBeenCalled();
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBe(original);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        view.unmount();
    });

    it('rejects a second stale editor before overwriting a newer draft in the same consent revision', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const key = deviceKey(draftName, owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const first = mount(firstCallback);
        const second = mount(secondCallback);
        fireEvent.change(edited(first), { target: { value: 'First author private value' } });
        const original = readBufferedDraftSnapshot(draftName, owner).raw;
        const ciphertext = localStorage.getItem(sealedKey);
        expect(ciphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(original!)).toMatchObject({
            __logbookBufferedDraft: 1, owner, name: draftName,
            consentRevision: 3, value: 'First author private value',
        });
        fireEvent.change(edited(second), { target: { value: 'Stale author conflicting value' } });
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBe(original);
        expect(localStorage.getItem(sealedKey)).toBe(ciphertext);
        expect(localStorage.getItem(key)).toBeNull();
        const witnesses = readBufferedWriterEvidence(owner, draftName);
        expect(witnesses.map(witness => witness.value).sort()).toEqual([
            'First author private value', 'Stale author conflicting value',
        ]);
        expect(witnesses.every(witness => localStorage.getItem(protectedDeviceKey(witness.name, owner))?.startsWith('tlb-sealed:v1:'))).toBe(true);
        expect(witnesses.every(witness => localStorage.getItem(deviceKey(witness.name, owner)) === null)).toBe(true);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        fireEvent.blur(edited(second));
        expect(secondCallback).not.toHaveBeenCalled();
        expect(firstCallback).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
        first.unmount();
        second.unmount();
    });

    it('preserves the newer copy when an old parent acknowledges a previously flushed value', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const key = deviceKey(draftName, owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const olderCallback = vi.fn();
        const newerCallback = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const oldView = mount(olderCallback);
        fireEvent.change(edited(oldView), { target: { value: 'Old value' } });
        fireEvent.blur(edited(oldView));
        expect(olderCallback).toHaveBeenCalledExactlyOnceWith('Old value');

        // A second tab loads exactly the first tab's durable draft, edits it,
        // then the first tab receives a delayed acknowledgement for OLD data.
        const newView = mount(newerCallback);
        fireEvent.change(edited(newView), { target: { value: 'Newer value' } });
        const newerRaw = readBufferedDraftSnapshot(draftName, owner).raw;
        const newerCiphertext = localStorage.getItem(sealedKey);
        expect(newerCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(newerRaw!)).toMatchObject({ value: 'Newer value' });
        oldView.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, olderCallback, 'Old value')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBe(newerRaw);
        expect(localStorage.getItem(sealedKey)).toBe(newerCiphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(consoleError).toHaveBeenCalled();
        expect(newerCallback).not.toHaveBeenCalled();
        oldView.unmount();
        newView.unmount();
    });

    it('allows one editor to revise its own saved draft repeatedly and clear only on acknowledgement', async () => {
        const owner = captureSession().owner;
        await prepareUnlockedTestArchive(owner);
        const key = deviceKey(draftName, owner);
        const sealedKey = protectedDeviceKey(draftName, owner);
        const update = vi.fn();
        const view = mount(update);
        fireEvent.change(edited(view), { target: { value: 'A' } });
        const firstCiphertext = localStorage.getItem(sealedKey);
        expect(firstCiphertext).toMatch(/^tlb-sealed:v1:/);
        fireEvent.change(edited(view), { target: { value: 'B' } });
        const raw = readBufferedDraftSnapshot(draftName, owner).raw;
        const secondCiphertext = localStorage.getItem(sealedKey);
        expect(secondCiphertext).toMatch(/^tlb-sealed:v1:/);
        expect(secondCiphertext).not.toBe(firstCiphertext);
        expect(localStorage.getItem(key)).toBeNull();
        expect(JSON.parse(raw!)).toMatchObject({ value: 'B' });
        fireEvent.blur(edited(view));
        expect(update).toHaveBeenCalledExactlyOnceWith('B');
        view.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, update, 'B')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(localStorage.getItem(sealedKey)).toBeNull();
        expect(localStorage.getItem(key)).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(0);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });
});
