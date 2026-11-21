import { LEGAL_VERSIONS } from '../../../src/lib/legalVersions';
import React from 'react';
import { registerLegacyGuestHandoffCases } from './legacyGuestHandoffCases';
import { registerLegacyGuestRestartCases } from './legacyGuestRestartCases';
import { registerLegacyGuestOwnerSwitchCases } from './legacyGuestOwnerSwitchCases';
import { afterEach, beforeEach, describe, expect, vi } from 'vitest';
import { get } from 'idb-keyval';

vi.mock('../../../src/components/UI/ErrorBoundary', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('../../../src/components/UI/BottomNav', () => ({ default: () => <nav data-testid="bottom-nav" /> }));
vi.mock('../../../src/components/UI/GlobalDialog', () => ({ GlobalDialog: () => null }));
vi.mock('../../../src/components/UI/ReloadPrompt', () => ({ default: () => null }));
vi.mock('../../../src/components/UI/ConsentOverlay', () => ({ ConsentOverlay: () => null }));
vi.mock('../../../src/components/Home/HomeView', () => ({ default: () => <div>Home view</div> }));
vi.mock('../../../src/components/Training/TrainingView', () => ({ default: () => <div>Training view</div> }));
vi.mock('../../../src/components/Nutrition/NutritionView', () => ({ default: () => <div>Nutrition view</div> }));
vi.mock('../../../src/components/Data/DataView', () => ({ default: () => <div>Data view</div> }));
vi.mock('../../../src/components/SettingsView', () => ({ default: () => <div>Settings view</div> }));

import { runTransaction } from 'firebase/firestore';
import App from '../../../src/App';
import { AuthProvider } from '../../../src/contexts/AuthContext';
import { DB } from '../../../src/lib/db';
import { auth, onAuthStateChanged } from '../../../src/lib/firebase';
import { UserDataSchema } from '../../../src/lib/schema';
import * as localRepository from '../../../src/lib/sync/localRepository';
import { useAppStore } from '../../../src/store/useAppStore';
import type { UserData } from '../../../src/types';
import { beginGuestMigrationIntent } from '../../../src/lib/auth/guestMigrationIntent';
import { bootstrapAuthenticatedSession } from '../../../src/contexts/auth/bootstrapAuthenticatedSession';
import { createAndMigrateVault } from '../../../src/lib/sync/secureArchiveMigration';
import { lockAllVaults } from '../../../src/lib/sync/secureArchiveSession';
import { saveWorkoutDeviceIntent } from '../../../src/lib/sync/workoutDeviceIntent';
import { markGuestMigrationSyncRecovery } from '../../../src/lib/auth/guestMigrationSyncRecovery';
import { activateGuestSession, GUEST_SESSION_KEY } from '../../../src/lib/sync/session';
import { draftRegistry } from '../../../src/lib/utils/draftRegistry';
import { resumePersistedGuestMigration } from '../../../src/contexts/auth/resumePersistedGuestMigration';

const defaultRunTransaction = vi.mocked(runTransaction).getMockImplementation();

const GUEST_KEY = 'logbook_is_guest';
const GUEST_ARCHIVE_KEY = 'logbook:v2:guest';
const OVERLAY_SESSION_KEY = 'logbook_guest_login_overlay';
const parse = (value: unknown) => UserDataSchema.parse(value) as unknown as UserData;
const user = { uid: 'guest-restart-user', email: 'restart@example.com', displayName: 'Guest Restart' } as any;
const SYNC_RECOVERY_KEY = `logbook:v2:user:${user.uid}:guest-migration-sync-recovery`;
let onlineSpy: { mockRestore: () => void; mockReturnValue: (value: boolean) => unknown } | undefined;

function fixtures() {
    const cloud = parse({ profile: { gender: 'M' }, routines: [{ id: 'cloud-routine', name: 'Cloud', exercises: [] }], legalConsent: { hasAcceptedTerms: true, hasAcceptedHealthData: true, acceptedAt: '2026-10-11T10:00:00.000Z', privacyVersion: LEGAL_VERSIONS.privacy, termsVersion: LEGAL_VERSIONS.terms } });
    const guest = parse({ profile: { height: '175' }, routines: [{ id: 'guest-routine', name: 'Guest', exercises: [] }] });
    return { cloud, guest };
}

// The real handoff persists its witness while the guest generation still
// exists, then retires the guest flag/generation before a later restart.
function markPersistedGuestHandoff(): string {
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
    try {
        return markGuestMigrationSyncRecovery(user.uid);
    } finally {
        localStorage.removeItem(GUEST_SESSION_KEY);
    }
}

beforeEach(async () => {
    lockAllVaults();
    vi.clearAllMocks();
    vi.mocked(runTransaction).mockReset();
    if (defaultRunTransaction) vi.mocked(runTransaction).mockImplementation(defaultRunTransaction);
    localStorage.clear();
    sessionStorage.clear();
    useAppStore.getState().resetStore({ force: true });
    (auth as any).currentUser = user;
    vi.mocked(onAuthStateChanged).mockImplementation((_auth, callback: any) => { callback(user); return () => {}; });
    // The fixture is a current-format guest archive, not a pre-vault plaintext envelope.
    // Restore the guest flag only in scenarios that actually exercise a guest session.
    localStorage.setItem(GUEST_KEY, 'true');
    localStorage.setItem(GUEST_SESSION_KEY, 'guest-restart-generation');
    activateGuestSession('guest-restart-generation');
    await createAndMigrateVault('guest');
    const { guest } = fixtures();
    await localRepository.initializeLocal('guest', guest, []);
    expect(await get(GUEST_ARCHIVE_KEY)).toMatch(/^tlb-sealed:v1:/);
    localStorage.removeItem(GUEST_KEY);
    localStorage.removeItem(GUEST_SESSION_KEY);
    await createAndMigrateVault('user:guest-restart-user');
    onlineSpy = vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false) as any;
});

afterEach(() => {
    onlineSpy?.mockRestore();
    vi.restoreAllMocks();
    onlineSpy = undefined;
});


const context = {
    GUEST_KEY, GUEST_ARCHIVE_KEY, OVERLAY_SESSION_KEY, SYNC_RECOVERY_KEY,
    user, fixtures, markPersistedGuestHandoff, parse, getOnlineSpy: () => onlineSpy,
    App, AuthProvider, DB, auth, onAuthStateChanged, runTransaction,
    localRepository, useAppStore, beginGuestMigrationIntent, bootstrapAuthenticatedSession,
    saveWorkoutDeviceIntent, markGuestMigrationSyncRecovery, activateGuestSession,
    GUEST_SESSION_KEY, draftRegistry, resumePersistedGuestMigration, get,
};
export type LegacyGuestRestartTestContext = typeof context;

describe('legacy Firebase AuthProvider guest migration restart recovery (not Kinde-first)', () => {
    registerLegacyGuestHandoffCases(context);
    registerLegacyGuestRestartCases(context);
    registerLegacyGuestOwnerSwitchCases(context);
});
