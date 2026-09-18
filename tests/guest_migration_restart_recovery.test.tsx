import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('@vercel/analytics/react', () => ({ Analytics: () => null }));
vi.mock('@vercel/speed-insights/react', () => ({ SpeedInsights: () => null }));
vi.mock('../src/components/UI/ErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../src/components/UI/BottomNav', () => ({ default: () => <nav data-testid="bottom-nav" /> }));
vi.mock('../src/components/UI/GlobalDialog', () => ({ GlobalDialog: () => null }));
vi.mock('../src/components/UI/ReloadPrompt', () => ({ default: () => null }));
vi.mock('../src/components/UI/InstallPrompt', () => ({ InstallPrompt: () => null }));
vi.mock('../src/components/UI/ConsentOverlay', () => ({ ConsentOverlay: () => null }));
vi.mock('../src/components/UI/LoginBox', () => ({ LoginBox: () => <div data-testid="guest-login-box" /> }));
vi.mock('../src/components/Home/HomeView', () => ({ default: () => <div>Home view</div> }));
vi.mock('../src/components/Training/TrainingView', () => ({ default: () => <div>Training view</div> }));
vi.mock('../src/components/Nutrition/NutritionView', () => ({ default: () => <div>Nutrition view</div> }));
vi.mock('../src/components/Data/DataView', () => ({ default: () => <div>Data view</div> }));
vi.mock('../src/components/SettingsView', () => ({ default: () => <div>Settings view</div> }));

import { runTransaction } from 'firebase/firestore';
import App from '../src/App';
import { AuthProvider } from '../src/contexts/AuthContext';
import { DB } from '../src/lib/db';
import { auth, onAuthStateChanged } from '../src/lib/firebase';
import { UserDataSchema } from '../src/lib/schema';
import * as localRepository from '../src/lib/sync/localRepository';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';

const GUEST_KEY = 'logbook_is_guest';
const GUEST_POLICY_KEY = 'guest_migration_policy';
const OVERLAY_SESSION_KEY = 'logbook_guest_login_overlay';
const SYNC_RECOVERY_KEY = 'logbook_guest_migration_sync_recovery';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = { uid: 'guest-restart-user', email: 'restart@example.com', displayName: 'Guest Restart' } as any;
let onlineSpy: { mockRestore: () => void; mockReturnValue: (value: boolean) => unknown } | undefined;

function fixtures() {
    const cloud = parse({ profile: { gender: 'M' }, routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }] });
    const guest = parse({ profile: { height: '175' }, routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }] });
    return { cloud, guest };
}

beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().resetStore({ force: true });
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => { callback(user); return () => {}; });
    const { guest } = fixtures();
    await localRepository.initializeLocal('guest', guest, []);
    onlineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false) as any;
});

afterEach(() => {
    onlineSpy?.mockRestore();
    vi.restoreAllMocks();
    onlineSpy = undefined;
});

describe('guest migration restart recovery', () => {
    it('mounts only the blocking migration UI during automatic guest recovery without a session overlay marker', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_POLICY_KEY, 'merge');
        useAppStore.getState().setUserData(guest);
        let resolveCloud!: (value: any) => void;
        const cloudRequest = new Promise(resolve => { resolveCloud = resolve; });
        vi.mocked(DB.loadCloudPayload).mockImplementationOnce(() => cloudRequest as any);
        render(<AuthProvider><App /></AuthProvider>);
        await waitFor(() => expect(screen.getByText('Preparazione account...')).toBeTruthy());
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(screen.queryByTestId('guest-login-box')).toBeNull();
        expect(screen.queryByText('Home view')).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();
        resolveCloud({ data: cloud, completeMonths: [], cloudDocuments: new Map() });
        await waitFor(() => expect(useAppStore.getState().saveError).toContain('Offline: account preparato sul dispositivo'));
        await waitFor(() => expect(screen.getByTestId('bottom-nav')).toBeTruthy());
        expect(document.getElementById('app-container')).toBeTruthy();
    });

    it('keeps a rejected post-commit migration durable across restarts without sessionStorage, then clears it on local-pending retry', async () => {
        const { cloud, guest } = fixtures();
        const merged = parse({ ...cloud, profile: { ...cloud.profile, ...guest.profile }, routines: [...(cloud.routines || []), ...(guest.routines || [])] });
        await localRepository.initializeLocal(user.uid, cloud, []);
        await localRepository.commitLocal(user.uid, merged, cloud);
        useAppStore.getState().setUserData(merged);
        expect((await localRepository.readLocal(user.uid))?.pending.length).toBeGreaterThan(0);
        localStorage.setItem(SYNC_RECOVERY_KEY, user.uid);
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        onlineSpy?.mockReturnValue(true);
        const permissionDenied = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
        vi.mocked(runTransaction).mockRejectedValueOnce(permissionDenied);
        const firstRender = render(<AuthProvider><App /></AuthProvider>);
        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBe(user.uid);
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();
        expect((await localRepository.readLocal(user.uid))?.pending.length).toBeGreaterThan(0);
        firstRender.unmount();
        vi.mocked(runTransaction).mockRejectedValueOnce(permissionDenied);
        render(<AuthProvider><App /></AuthProvider>);
        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBe(user.uid);
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();
        expect((await localRepository.readLocal(user.uid))?.pending.length).toBeGreaterThan(0);
        onlineSpy?.mockReturnValue(false);
        fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
        await waitFor(() => expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull());
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        expect(document.getElementById('app-container')).toBeTruthy();
        expect(useAppStore.getState().saveError).toContain('Offline: i dati sono salvati sul dispositivo');
    });

    it('invalidates an A migration suspended at local commit before account B can take ownership', async () => {
        const guest = parse({ profile: { height: '175' }, routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }] });
        const cloudA = parse({ profile: { gender: 'M' }, routines: [{ id: 'cloud-a', name: 'Cloud A', exercises: [] }] });
        const cloudB = parse({ profile: { gender: 'F' }, routines: [{ id: 'cloud-b', name: 'Cloud B', exercises: [] }] });
        const userA = { uid: 'account-a', email: 'a@example.com', displayName: 'A' } as any;
        const userB = { uid: 'account-b', email: 'b@example.com', displayName: 'B' } as any;
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_POLICY_KEY, 'merge');
        useAppStore.getState().setUserData(guest);
        let authCallback!: (nextUser: any) => Promise<void>;
        vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => { authCallback = callback; return () => {}; });
        let releaseBCloud!: (value: any) => void;
        const bCloudRequest = new Promise(resolve => { releaseBCloud = resolve; });
        vi.mocked(DB.loadCloudPayload).mockImplementation(() => {
            if ((auth as any).currentUser?.uid === userA.uid) return Promise.resolve({ data: cloudA, completeMonths: [], cloudDocuments: new Map() }) as any;
            if ((auth as any).currentUser?.uid === userB.uid) return bCloudRequest as any;
            return Promise.resolve(null) as any;
        });
        const realCommitLocal = localRepository.commitLocal;
        let releaseACommit!: () => void;
        let markACommitEntered!: () => void;
        const aCommitEntered = new Promise<void>(resolve => { markACommitEntered = resolve; });
        const aCommitGate = new Promise<void>(resolve => { releaseACommit = resolve; });
        vi.spyOn(localRepository, 'commitLocal').mockImplementation(async (owner, data, baseline, guard) => {
            if (owner === userA.uid) { markACommitEntered(); await aCommitGate; }
            return realCommitLocal(owner, data, baseline, guard);
        });
        (auth as any).currentUser = null;
        render(<AuthProvider><App /></AuthProvider>);
        let aRun!: Promise<void>;
        act(() => { (auth as any).currentUser = userA; aRun = authCallback(userA); });
        await aCommitEntered;
        expect(screen.getByText('Preparazione account...')).toBeTruthy();
        let bRun!: Promise<void>;
        act(() => { (auth as any).currentUser = userB; bRun = authCallback(userB); });
        await waitFor(() => expect(DB.loadCloudPayload).toHaveBeenCalledTimes(2));
        releaseACommit();
        await act(async () => { await aRun; });
        expect(localStorage.getItem(GUEST_KEY)).toBe('true');
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull();
        expect(document.getElementById('app-container')).toBeNull();
        const envelopeA = await localRepository.readLocal(userA.uid);
        const envelopeBBefore = await localRepository.readLocal(userB.uid);
        expect(envelopeA?.data.routines?.map(routine => routine.id)).toContain('cloud-a');
        expect(envelopeA?.data.routines?.map(routine => routine.id)).not.toContain('guest-routine');
        expect(envelopeA?.data.routines?.map(routine => routine.id)).not.toContain('cloud-b');
        expect(envelopeBBefore).toBeUndefined();
        expect(useAppStore.getState().userData?.routines?.map(routine => routine.id)).toEqual(['guest-routine']);
        releaseBCloud({ data: cloudB, completeMonths: [], cloudDocuments: new Map() });
        await act(async () => { await bRun; });
        await waitFor(() => expect(document.getElementById('app-container')).toBeTruthy());
        expect(localStorage.getItem(GUEST_KEY)).toBeNull();
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull();
        const envelopeAAfter = await localRepository.readLocal(userA.uid);
        const envelopeB = await localRepository.readLocal(userB.uid);
        expect(envelopeAAfter?.data.routines?.map(routine => routine.id)).toContain('cloud-a');
        expect(envelopeAAfter?.data.routines?.map(routine => routine.id)).not.toContain('guest-routine');
        expect(envelopeAAfter?.data.routines?.map(routine => routine.id)).not.toContain('cloud-b');
        expect(envelopeB?.data.routines?.map(routine => routine.id)).toContain('cloud-b');
        expect(envelopeB?.data.routines?.map(routine => routine.id)).toContain('guest-routine');
        expect(envelopeB?.data.routines?.map(routine => routine.id)).not.toContain('cloud-a');
        expect(useAppStore.getState().userData?.routines?.map(routine => routine.id)).toEqual(expect.arrayContaining(['guest-routine', 'cloud-b']));
        expect(useAppStore.getState().userData?.routines?.map(routine => routine.id)).not.toContain('cloud-a');
    });
});
