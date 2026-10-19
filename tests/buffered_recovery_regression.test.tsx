import React, { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BufferedInput, BufferedTextarea } from '../src/components/UI/BufferedInput';
import { BufferedWorkoutScope } from '../src/components/UI/bufferedWorkoutScope';
import type { WorkoutSession } from '../src/types';
import { deviceKey } from '../src/lib/sync/deviceStorage';
import { readBufferedDraftSnapshot, writeBufferedDraft } from '../src/lib/sync/bufferedDraftEpoch';
import {
    clearBufferedWriterIntent, createBufferedWriterIntentName,
    readBufferedWriterEvidence, writeBufferedWriterIntent,
} from '../src/lib/sync/bufferedDraftWriterIntent';
import { captureSession, invalidateSession } from '../src/lib/sync/session';
import { requiredUpdateRecoveryRegistry } from '../src/lib/sync/requiredUpdateRecovery';
import { useAppStore } from '../src/store/useAppStore';
import { localStorageMock } from './setup';

type FieldKind = 'input' | 'textarea';
const initialGetItem = localStorageMock.getItem.getMockImplementation()!;
const initialSetItem = localStorageMock.setItem.getMockImplementation()!;

function field(kind: FieldKind, onChange: (value: string) => void, value = '') {
    return kind === 'input'
        ? <BufferedInput id="stable-draft" type="text" inputMode="decimal" value={value} onChange={onChange} aria-label="Bozza workout" />
        : <BufferedTextarea id="stable-draft" value={value} onChange={onChange} aria-label="Bozza workout" />;
}

function recoveryKey(kind: FieldKind) {
    return deviceKey(`draft:buffered:${kind}:stable-draft`, captureSession().owner);
}

function editor() {
    return screen.getByRole('textbox', { name: 'Bozza workout' }) as HTMLInputElement | HTMLTextAreaElement;
}

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

    it('writes a stamped epoch-bound record and never flushes a mounted stale editor', () => {
        const key = recoveryKey(kind);
        const owner = captureSession().owner;
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const onChange = vi.fn();
        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: 'private current edit' } });
        const raw = localStorage.getItem(key);
        expect(JSON.parse(raw!)).toMatchObject({
            __logbookBufferedDraft: 1, owner,
            name: `draft:buffered:${kind}:stable-draft`,
            consentRevision: 3, value: 'private current edit',
        });

        localStorage.setItem(marker, '5');
        expect(() => requiredUpdateRecoveryRegistry.captureAll()).toThrow(AggregateError);
        fireEvent.blur(editor());
        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).toBe(raw);
        expect(useAppStore.getState().saveError).toMatch(/bozza/i);
        view.unmount();
    });

    it('refuses automatic cleanup of a buffered record from a previous revision', () => {
        const key = recoveryKey(kind);
        const owner = captureSession().owner;
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        localStorage.setItem(marker, '3');
        const onChange = vi.fn();
        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: '30' } });
        const raw = localStorage.getItem(key);
        fireEvent.blur(editor());
        expect(onChange).toHaveBeenCalledTimes(1);
        localStorage.setItem(marker, '5');
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        view.rerender(field(kind, onChange, kind === 'input' ? '30' : '30'));
        expect(localStorage.getItem(key)).toBe(raw);
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

    it('reads the recovery key at mount, not on unrelated rerenders', () => {
        const onChange = vi.fn();
        const key = recoveryKey(kind);
        const previousReads = localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key).length;
        const view = render(field(kind, onChange));
        const initialReads = localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key).length;
        expect(initialReads - previousReads).toBe(1);

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

    it('fails closed after commit when the initial owner-scoped read throws', () => {
        const key = recoveryKey(kind);
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
            view.unmount();
        } finally {
            unsubscribe();
        }
    });

    it('restores a durable draft, then removes it only after the owner confirms the value', () => {
        const key = recoveryKey(kind);
        const stored = kind === 'input' ? '7,5' : 'Nota recuperata dopo riavvio';
        const committed = kind === 'input' ? '7.5' : stored;
        localStorage.setItem(key, stored);
        const onChange = vi.fn();
        const view = render(field(kind, onChange));

        expect(editor().value).toBe(stored);
        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).toBe(stored);

        fireEvent.blur(editor());
        expect(onChange).toHaveBeenCalledExactlyOnceWith(committed);
        expect(localStorage.getItem(key)).toBe(stored);

        view.rerender(field(kind, onChange, committed));
        expect(localStorage.getItem(key)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });

    it('blocks persistence on a device write failure and refuses unsafe update recovery', () => {
        const key = recoveryKey(kind);
        const onChange = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.setItem.mockImplementation((writtenKey: string, value: string) => {
            if (writtenKey === key) throw new DOMException('full', 'QuotaExceededError');
            return initialSetItem(writtenKey, value);
        });

        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: 'Bozza nuova' } });

        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(useAppStore.getState().syncHealth).toBe('failed');
        expect(localStorage.getItem(key)).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
        expect(() => requiredUpdateRecoveryRegistry.captureAll()).toThrow(AggregateError);
        expect(consoleError).toHaveBeenCalled();
        view.unmount();
    });

    it('never moves a mounted guest draft to a newly authenticated owner', () => {
        // An input event may arrive before an old editor unmounts during login.
        localStorage.setItem('logbook_is_guest', 'true');
        expect(captureSession().owner).toBe('guest');
        const guestKey = recoveryKey(kind);
        const onChange = vi.fn();
        const view = render(field(kind, onChange));

        fireEvent.change(editor(), { target: { value: 'guest note' } });
        expect(localStorage.getItem(guestKey)).toBe('guest note');

        localStorage.removeItem('logbook_is_guest');
        invalidateSession();
        const newOwner = captureSession().owner;
        expect(newOwner).toMatch(/^user:/);
        const otherKey = deviceKey(`draft:buffered:${kind}:stable-draft`, newOwner);

        fireEvent.change(editor(), { target: { value: 'late edit' } });
        expect(localStorage.getItem(guestKey)).toBe('guest note');
        expect(localStorage.getItem(otherKey)).toBeNull();
        expect(onChange).not.toHaveBeenCalled();
        expect(useAppStore.getState().saveError).toMatch(/bozza non ancora protetta/i);
        view.unmount();
        expect(onChange).not.toHaveBeenCalled();
    });

    it('keeps the original owner draft and never flushes it after session invalidation', () => {
        const key = recoveryKey(kind);
        const onChange = vi.fn();
        const view = render(field(kind, onChange));
        fireEvent.change(editor(), { target: { value: 'solo per questa sessione' } });

        expect(localStorage.getItem(key)).toBe('solo per questa sessione');
        expect(onChange).not.toHaveBeenCalled();
        invalidateSession();
        view.unmount();

        expect(onChange).not.toHaveBeenCalled();
        expect(localStorage.getItem(key)).toBe('solo per questa sessione');
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
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });

    it('does not replay a prior workout and does not flush its mounted input into the next workout', () => {
        const owner = captureSession().owner;
        const firstKey = deviceKey(name(firstId), owner);
        const secondKey = deviceKey(name(secondId), owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        activate(firstId);
        const firstChange = vi.fn();
        const secondChange = vi.fn();
        const view = render(scoped(firstId, firstChange));
        fireEvent.change(editor(), { target: { value: 'first workout secret' } });
        const firstRaw = localStorage.getItem(firstKey);
        expect(JSON.parse(firstRaw!)).toMatchObject({
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
        expect(JSON.parse(secondRaw!)).toMatchObject({
            name: name(secondId), value: 'second workout value',
        });
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        view.unmount();

        activate(firstId);
        const reopening = render(scoped(firstId, vi.fn()));
        expect(editor().value).toBe('first workout secret');
        expect(localStorage.getItem(firstKey)).toBe(firstRaw);
        expect(localStorage.getItem(secondKey)).toBe(secondRaw);
        reopening.unmount();
    });

    it('removes only the matching workout draft after parent confirms the same value', () => {
        const owner = captureSession().owner;
        const firstKey = deviceKey(name(firstId), owner);
        const secondKey = deviceKey(name(secondId), owner);
        localStorage.setItem(`logbook:v2:${owner}:health-consent-generation`, '3');
        activate(firstId);
        const onChange = vi.fn();
        const view = render(scoped(firstId, onChange));
        fireEvent.change(editor(), { target: { value: '6,5' } });
        const firstRaw = localStorage.getItem(firstKey);
        const otherValue = JSON.stringify({
            __logbookBufferedDraft: 1, owner, name: name(secondId),
            consentRevision: 3, value: 'different workout',
        });
        localStorage.setItem(secondKey, otherValue);
        fireEvent.blur(editor());
        expect(onChange).toHaveBeenCalledExactlyOnceWith(kind === 'input' ? '6.5' : '6,5');
        view.rerender(scoped(firstId, onChange, kind === 'input' ? '6.5' : '6,5'));
        expect(localStorage.getItem(firstKey)).toBeNull();
        expect(localStorage.getItem(secondKey)).toBe(otherValue);
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

    it('rejects a second stale editor before overwriting a newer draft in the same consent revision', () => {
        const owner = captureSession().owner;
        const key = deviceKey(draftName, owner);
        const firstCallback = vi.fn();
        const secondCallback = vi.fn();
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const first = mount(firstCallback);
        const second = mount(secondCallback);
        fireEvent.change(edited(first), { target: { value: 'First author private value' } });
        const original = localStorage.getItem(key);
        expect(JSON.parse(original!)).toMatchObject({
            __logbookBufferedDraft: 1, owner, name: draftName,
            consentRevision: 3, value: 'First author private value',
        });
        fireEvent.change(edited(second), { target: { value: 'Stale author conflicting value' } });
        expect(localStorage.getItem(key)).toBe(original);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        fireEvent.blur(edited(second));
        expect(secondCallback).not.toHaveBeenCalled();
        expect(firstCallback).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
        first.unmount();
        second.unmount();
    });

    it('preserves the newer copy when an old parent acknowledges a previously flushed value', () => {
        const owner = captureSession().owner;
        const key = deviceKey(draftName, owner);
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
        const newerRaw = localStorage.getItem(key);
        expect(JSON.parse(newerRaw!)).toMatchObject({ value: 'Newer value' });
        oldView.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, olderCallback, 'Old value')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(localStorage.getItem(key)).toBe(newerRaw);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(consoleError).toHaveBeenCalled();
        expect(newerCallback).not.toHaveBeenCalled();
        oldView.unmount();
        newView.unmount();
    });

    it('allows one editor to revise its own saved draft repeatedly and clear only on acknowledgement', () => {
        const owner = captureSession().owner;
        const key = deviceKey(draftName, owner);
        const update = vi.fn();
        const view = mount(update);
        fireEvent.change(edited(view), { target: { value: 'A' } });
        fireEvent.change(edited(view), { target: { value: 'B' } });
        const raw = localStorage.getItem(key);
        expect(JSON.parse(raw!)).toMatchObject({ value: 'B' });
        fireEvent.blur(edited(view));
        expect(update).toHaveBeenCalledExactlyOnceWith('B');
        view.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, update, 'B')}
            </BufferedWorkoutScope.Provider>,
        );
        expect(localStorage.getItem(key)).toBeNull();
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });
});

describe.each(['input', 'textarea'] as const)('independent same-workout %s writer evidence', kind => {
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

    it('retains both contenders even if a simultaneous shared overwrite loses one copy', () => {
        const owner = captureSession().owner;
        const a = createBufferedWriterIntentName();
        const b = createBufferedWriterIntentName();
        expect(a).not.toBe(b);
        writeBufferedWriterIntent(a, owner, draftName, 'Writer A private value', null, '3');
        writeBufferedWriterIntent(b, owner, draftName, 'Writer B private value', null, '3');

        // Deliberately force the shared-key lost-update outcome that localStorage
        // cannot prevent without CAS. Independent keys remain the evidence.
        writeBufferedDraft(draftName, owner, 'Writer A private value', '3');
        writeBufferedDraft(draftName, owner, 'Writer B private value', '3');
        expect(readBufferedDraftSnapshot(draftName, owner).value).toBe('Writer B private value');
        expect(readBufferedWriterEvidence(owner, draftName).map(x => x.value).sort()).toEqual([
            'Writer A private value', 'Writer B private value',
        ]);

        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        const restore = mount(vi.fn(), 'new parent value');
        expect(edited(restore).value).toBe('new parent value');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        expect(report).toHaveBeenCalled();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(2);
        restore.unmount();
    });

    it('keeps a successfully written independent draft when canonical storage fails', () => {
        const owner = captureSession().owner;
        const canonicalKey = deviceKey(draftName, owner);
        const report = vi.spyOn(console, 'error').mockImplementation(() => {});
        localStorageMock.setItem.mockImplementation((key: string, value: string) => {
            if (key === canonicalKey) throw new DOMException('quota exceeded', 'QuotaExceededError');
            return initialSetItem(key, value);
        });
        const view = mount(vi.fn());
        fireEvent.change(edited(view), { target: { value: 'Retained private edit' } });
        expect(localStorage.getItem(canonicalKey)).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName).map(x => x.value))
            .toEqual(['Retained private edit']);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(true);
        view.unmount();
        expect(report).toHaveBeenCalled();
    });

    it('restores one matching witness after a simulated reload and clears it only on parent acknowledgement', () => {
        const owner = captureSession().owner;
        const value = 'Unsaved verified draft';
        const first = mount(vi.fn());
        fireEvent.change(edited(first), { target: { value } });
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(1);
        first.unmount();

        const update = vi.fn();
        const second = mount(update);
        expect(edited(second).value).toBe(value);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        fireEvent.blur(edited(second));
        expect(update).toHaveBeenCalledExactlyOnceWith(value);
        second.rerender(
            <BufferedWorkoutScope.Provider value={workoutId}>
                {field(kind, update, value)}
            </BufferedWorkoutScope.Provider>,
        );
        expect(readBufferedDraftSnapshot(draftName, owner).raw).toBeNull();
        expect(readBufferedWriterEvidence(owner, draftName)).toHaveLength(0);
        second.unmount();
    });

    it('does not block an unrelated field because an older-consent witness still exists', () => {
        const owner = captureSession().owner;
        const marker = `logbook:v2:${owner}:health-consent-generation`;
        const oldField = `draft:buffered:${kind}:${workoutId}:historical-field`;
        const historicalName = createBufferedWriterIntentName();
        localStorage.setItem(marker, '2');
        const historicalRaw = writeBufferedWriterIntent(
            historicalName, owner, oldField, 'private historical value', null, '2',
        );
        localStorage.setItem(marker, '3');

        expect(readBufferedWriterEvidence(owner, draftName)).toEqual([]);
        const update = vi.fn();
        const view = mount(update);
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        fireEvent.change(edited(view), { target: { value: 'Current field' } });
        fireEvent.blur(edited(view));
        expect(update).toHaveBeenCalledWith('Current field');
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        expect(localStorage.getItem(deviceKey(historicalName, owner))).toBe(historicalRaw);
        view.unmount();
    });

    it('counts the 64-witness guard per field, not across unrelated fields', () => {
        const owner = captureSession().owner;
        for (let index = 0; index < 65; index++) {
            writeBufferedWriterIntent(
                createBufferedWriterIntentName(), owner,
                `draft:buffered:${kind}:${workoutId}:other-${index}`,
                `Historical note ${index}`, null, '3',
            );
        }
        expect(readBufferedWriterEvidence(owner, draftName)).toEqual([]);
        const view = mount(vi.fn());
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        fireEvent.change(edited(view), { target: { value: 'New private value' } });
        expect(useAppStore.getState().localPersistenceBlocked).toBe(false);
        view.unmount();
    });

    it('does not hide malformed unrelated witnesses whose source field cannot be verified', () => {
        const owner = captureSession().owner;
        const name = createBufferedWriterIntentName();
        localStorage.setItem(deviceKey(name, owner), JSON.stringify({
            __logbookBufferedWriterIntent: 1,
            owner, draftName: 7, value: 'unknown provenance', consentRevision: 2,
        }));
        expect(() => readBufferedWriterEvidence(owner, draftName)).toThrow();
    });

    it('never clears a changed writer slot with a stale acknowledgement', () => {
        const owner = captureSession().owner;
        const name = createBufferedWriterIntentName();
        const raw = writeBufferedWriterIntent(name, owner, draftName, 'version 1', null, '3');
        const newer = writeBufferedWriterIntent(name, owner, draftName, 'version 2', raw, '3');
        expect(() => clearBufferedWriterIntent(name, owner, raw, '3')).toThrow();
        expect(readBufferedWriterEvidence(owner, draftName)).toMatchObject([
            { name, raw: newer, value: 'version 2' },
        ]);
    });
});
