import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
    profile: { dob: '2000-01-01', height: '170', gender: 'M' },
    dispatch: vi.fn(),
    showAlert: vi.fn(async (_message: string) => {}),
    currentSession: true,
    epoch: 1,
    owner: 'user:test',
    dataOwner: 'user:test',
}));

vi.mock('../../../src/store/useAppStore', () => {
    const getState = () => ({
        userData: { profile: state.profile },
        dataOwner: state.dataOwner,
        dispatchDomainOperation: state.dispatch,
    });
    return {
        useAppStore: Object.assign(
            (select: (store: ReturnType<typeof getState>) => unknown) => select(getState()),
            { getState },
        ),
    };
});
vi.mock('../../../src/store/useDialogStore', () => ({
    useDialogStore: (select: (store: unknown) => unknown) => select({ showAlert: state.showAlert }),
}));
vi.mock('../../../src/lib/sync/session', () => ({
    captureSession: () => ({ owner: state.owner, epoch: state.epoch }),
    isCurrentSession: (snapshot: { owner: string; epoch: number }) =>
        state.currentSession && snapshot.owner === state.owner && snapshot.epoch === state.epoch,
}));

import { useSettingsProfile } from '../../../src/hooks/useSettingsProfile';

beforeEach(() => {
    state.currentSession = true;
    state.epoch = 1;
    state.owner = 'user:test';
    state.dataOwner = 'user:test';
    state.profile = { dob: '2000-01-01', height: '170', gender: 'M' };
    state.dispatch.mockReset();
    state.dispatch.mockResolvedValue({ ok: true, status: 'synced' });
    state.showAlert.mockClear();
});
afterEach(cleanup);

describe('biometric profile draft persistence', () => {
    it('does not write untouched fields and preserves an explicit clear', async () => {
        const { result } = renderHook(() => useSettingsProfile());
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).not.toHaveBeenCalled();

        act(() => result.current.setGender(''));
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
            type: 'profile.patch', patch: { gender: '' },
        });
    });

    it('keeps fields edited during an unresolved durable save and persists them on the next submit', async () => {
        let complete!: (value: { ok: boolean; status: string }) => void;
        state.dispatch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));

        const { result } = renderHook(() => useSettingsProfile());
        act(() => result.current.setHeight('180'));

        let firstSave!: Promise<void>;
        act(() => { firstSave = result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledWith({
            type: 'profile.patch',
            patch: { height: '180' },
        });

        act(() => result.current.setHeight('181'));
        await act(async () => {
            complete({ ok: true, status: 'synced' });
            await firstSave;
        });

        expect(result.current.height).toBe('181');
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenLastCalledWith({
            type: 'profile.patch',
            patch: { height: '181' },
        });
    });

    it('does not carry a field from a completed save into a later edit of a different field', async () => {
        let complete!: (value: { ok: boolean; status: string }) => void;
        state.dispatch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const { result } = renderHook(() => useSettingsProfile());
        act(() => result.current.setHeight('180'));
        let firstSave!: Promise<void>;
        act(() => { firstSave = result.current.handleSaveProfile(); });
        act(() => result.current.setGender('F'));
        await act(async () => {
            complete({ ok: true, status: 'synced' });
            await firstSave;
        });
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenNthCalledWith(1, { type: 'profile.patch', patch: { height: '180' } });
        expect(state.dispatch).toHaveBeenNthCalledWith(2, { type: 'profile.patch', patch: { gender: 'F' } });
    });

    it('keeps a rejected profile patch available for a retry and clears it only after an accepted save', async () => {
        state.dispatch.mockResolvedValueOnce({
            ok: false, status: 'rejected', error: new Error('write denied'),
        });
        const { result } = renderHook(() => useSettingsProfile());
        act(() => result.current.setHeight('180'));

        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
            type: 'profile.patch', patch: { height: '180' },
        });
        expect(result.current.height).toBe('180');
        expect(state.showAlert).toHaveBeenCalledExactlyOnceWith('Errore durante il salvataggio del profilo.');

        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledTimes(2);
        expect(state.dispatch).toHaveBeenLastCalledWith({
            type: 'profile.patch', patch: { height: '180' },
        });
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledTimes(2);
        expect(state.showAlert).toHaveBeenCalledTimes(1);
    });

    it('accepts the dispatch boundary local-pending result without resubmitting an unchanged patch', async () => {
        state.dispatch.mockResolvedValueOnce({
            ok: false, status: 'local-pending', error: new Error('network unavailable'),
        });
        const { result } = renderHook(() => useSettingsProfile());
        act(() => result.current.setGender('F'));

        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledExactlyOnceWith({
            type: 'profile.patch', patch: { gender: 'F' },
        });
        expect(state.showAlert).not.toHaveBeenCalled();
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledTimes(1);
    });

    it('does not carry an in-flight patch across an owner change', async () => {
        let complete!: (value: { ok: true; status: 'synced' }) => void;
        state.dispatch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
        const { result, rerender } = renderHook(() => useSettingsProfile());
        act(() => result.current.setHeight('180'));
        let firstSave!: Promise<void>;
        act(() => { firstSave = result.current.handleSaveProfile(); });

        state.owner = 'user:second';
        state.dataOwner = 'user:second';
        state.epoch++;
        state.profile = { dob: '2002-02-02', height: '164', gender: 'F' };
        rerender();
        expect([result.current.dob, result.current.height, result.current.gender])
            .toEqual(['2002-02-02', '164', 'F']);

        await act(async () => {
            complete({ ok: true, status: 'synced' });
            await firstSave;
        });
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenCalledTimes(1);
        expect(state.showAlert).not.toHaveBeenCalled();

        act(() => result.current.setGender('M'));
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).toHaveBeenNthCalledWith(1, {
            type: 'profile.patch', patch: { height: '180' },
        });
        expect(state.dispatch).toHaveBeenNthCalledWith(2, {
            type: 'profile.patch', patch: { gender: 'M' },
        });
    });

    it('composes multiple field changes made in the same render cycle', () => {
        const { result } = renderHook(() => useSettingsProfile());
        act(() => {
            result.current.setDob('2001-02-03');
            result.current.setHeight('182');
            result.current.setGender('F');
        });
        expect([result.current.dob, result.current.height, result.current.gender])
            .toEqual(['2001-02-03', '182', 'F']);
    });

    it('does not surface or reuse another Auth epoch\'s unsaved biometric fields', () => {
        const { result, rerender } = renderHook(() => useSettingsProfile());
        act(() => result.current.setHeight('188'));
        expect(result.current.height).toBe('188');

        state.owner = 'user:second';
        state.dataOwner = 'user:second';
        state.epoch++;
        state.profile = { dob: '2002-02-02', height: '164', gender: 'F' };
        rerender();
        expect([result.current.dob, result.current.height, result.current.gender])
            .toEqual(['2002-02-02', '164', 'F']);
        act(() => result.current.setGender('M'));
        expect(result.current.height).toBe('164');

        state.owner = 'user:test';
        state.dataOwner = 'user:test';
        state.epoch++;
        state.profile = { dob: '2000-01-01', height: '170', gender: 'M' };
        rerender();
        expect(result.current.height).toBe('170');
    });

    it('hides a previous owner\'s profile while its store data has not been replaced', async () => {
        const { result, rerender } = renderHook(() => useSettingsProfile());
        state.owner = 'user:second';
        state.epoch++;
        rerender();
        expect([result.current.dob, result.current.height, result.current.gender])
            .toEqual(['', '', '']);
        act(() => result.current.setHeight('199'));
        expect(result.current.height).toBe('');
        await act(async () => { await result.current.handleSaveProfile(); });
        expect(state.dispatch).not.toHaveBeenCalled();
        expect(state.showAlert).toHaveBeenCalledWith('Errore durante il salvataggio del profilo.');
    });

    it('does not clear the draft or show an old-session error after the session changes', async () => {
        let reject!: (error: Error) => void;
        state.dispatch.mockImplementationOnce(() => new Promise((_resolve, rejectPromise) => { reject = rejectPromise; }));
        const { result } = renderHook(() => useSettingsProfile());
        act(() => result.current.setHeight('185'));
        let pending!: Promise<void>;
        act(() => { pending = result.current.handleSaveProfile(); });
        state.currentSession = false;
        await act(async () => { reject(new Error('obsolete request')); await pending; });
        expect(result.current.height).toBe('185');
        expect(state.showAlert).not.toHaveBeenCalled();
    });
});
