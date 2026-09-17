import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('firebase/analytics', () => ({
    logEvent: vi.fn(),
}));

vi.mock('@vercel/analytics/react', () => ({
    Analytics: () => null,
}));

vi.mock('@vercel/speed-insights/react', () => ({
    SpeedInsights: () => null,
}));

vi.mock('../src/components/UI/ErrorBoundary', () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../src/components/UI/BottomNav', () => ({
    default: () => <nav data-testid="bottom-nav" />,
}));

vi.mock('../src/components/UI/GlobalDialog', () => ({
    GlobalDialog: () => null,
}));

vi.mock('../src/components/UI/ReloadPrompt', () => ({
    default: () => null,
}));

vi.mock('../src/components/UI/InstallPrompt', () => ({
    InstallPrompt: () => null,
}));

vi.mock('../src/components/UI/ConsentOverlay', () => ({
    ConsentOverlay: () => null,
}));

vi.mock('../src/components/UI/LoginBox', () => ({
    LoginBox: () => <div data-testid="guest-login-box" />,
}));

vi.mock('../src/components/Home/HomeView', () => ({
    default: () => <div>Home view</div>,
}));
vi.mock('../src/components/Training/TrainingView', () => ({
    default: () => <div>Training view</div>,
}));
vi.mock('../src/components/Nutrition/NutritionView', () => ({
    default: () => <div>Nutrition view</div>,
}));
vi.mock('../src/components/Data/DataView', () => ({
    default: () => <div>Data view</div>,
}));
vi.mock('../src/components/SettingsView', () => ({
    default: () => <div>Settings view</div>,
}));

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
    const cloud = parse({
        profile: { gender: 'M' },
        routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }]
    });
    const guest = parse({
        profile: { height: '175' },
        routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }]
    });
    return { cloud, guest };
}

beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().resetStore({ force: true });
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => {
        callback(user);
        return () => {};
    });

    const { guest } = fixtures();
    await localRepository.initializeLocal('guest', guest, []);
    onlineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false) as any;
});

afterEach(() => {
    onlineSpy?.mockRestore();
    onlineSpy = undefined;
});

describe('guest migration restart recovery', () => {
    it('blocks the app during automatic guest recovery even without the session overlay marker', async () => {
        const { cloud, guest } = fixtures();
        localStorage.setItem(GUEST_KEY, 'true');
        localStorage.setItem(GUEST_POLICY_KEY, 'merge');
        useAppStore.getState().setUserData(guest);

        let resolveCloud!: (value: any) => void;
        const cloudRequest = new Promise(resolve => {
            resolveCloud = resolve;
        });
        vi.mocked(DB.loadCloudPayload).mockImplementationOnce(() => cloudRequest as any);

        render(
            <AuthProvider>
                <App />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByText('Preparazione account...')).toBeTruthy());
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull();
        expect(screen.queryByTestId('bottom-nav')).toBeNull();

        resolveCloud({
            data: cloud,
            completeMonths: [],
            cloudDocuments: new Map()
        });

        await waitFor(() => expect(useAppStore.getState().saveError).toContain('Offline: account preparato sul dispositivo'));
        await waitFor(() => expect(screen.getByTestId('bottom-nav')).toBeTruthy());
    });

    it('keeps a rejected post-commit migration durable across AuthProvider and App restarts, then clears it on local-pending retry', async () => {
        const { cloud, guest } = fixtures();
        const merged = parse({
            ...cloud,
            profile: { ...cloud.profile, ...guest.profile },
            routines: [...(cloud.routines || []), ...(guest.routines || [])]
        });

        await localRepository.initializeLocal(user.uid, cloud, []);
        await localRepository.commitLocal(user.uid, merged, cloud);
        useAppStore.getState().setUserData(merged);

        localStorage.setItem(SYNC_RECOVERY_KEY, user.uid);
        sessionStorage.setItem(OVERLAY_SESSION_KEY, 'true');
        onlineSpy?.mockReturnValue(true);

        const permissionDenied = Object.assign(new Error('permission denied'), { code: 'permission-denied' });
        vi.mocked(runTransaction).mockRejectedValueOnce(permissionDenied);

        const firstRender = render(
            <AuthProvider>
                <App />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBe(user.uid);
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');
        expect(screen.queryByTestId('bottom-nav')).toBeNull();

        firstRender.unmount();
        vi.mocked(runTransaction).mockRejectedValueOnce(permissionDenied);

        render(
            <AuthProvider>
                <App />
            </AuthProvider>
        );

        await waitFor(() => expect(screen.getByText('Accesso non completato')).toBeTruthy());
        expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBe(user.uid);
        expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBe('true');
        expect(screen.queryByTestId('bottom-nav')).toBeNull();

        onlineSpy?.mockReturnValue(false);
        fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));

        await waitFor(() => expect(localStorage.getItem(SYNC_RECOVERY_KEY)).toBeNull());
        await waitFor(() => expect(sessionStorage.getItem(OVERLAY_SESSION_KEY)).toBeNull());
        expect(screen.getByTestId('bottom-nav')).toBeTruthy();
        expect(useAppStore.getState().saveError).toContain('Offline: i dati sono salvati sul dispositivo');
    });
});
