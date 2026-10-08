import React, { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BufferedInput, BufferedTextarea } from '../src/components/UI/BufferedInput';
import { deviceKey } from '../src/lib/sync/deviceStorage';
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

    it('reads the recovery key at mount, not on unrelated rerenders', () => {
        const onChange = vi.fn();
        const key = recoveryKey(kind);
        const view = render(field(kind, onChange));
        const initialReads = localStorageMock.getItem.mock.calls.filter(([readKey]) => readKey === key).length;
        expect(initialReads).toBe(1);

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
        const unsubscribe = useAppStore.subscribe(state => {
            if (state.localPersistenceBlocked) phaseOfBlock.push(committed);
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
