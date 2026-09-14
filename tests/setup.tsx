import { vi, beforeEach } from 'vitest';

const storageMocks = vi.hoisted(() => {
  const localStorageStore: Record<string, string> = {};
  const localStorageMock = {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageStore[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageStore[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(localStorageStore)) delete localStorageStore[k];
    }),
    get length() {
      return Object.keys(localStorageStore).length;
    },
    key: vi.fn((index: number) => Object.keys(localStorageStore)[index] ?? null),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageMock,
    configurable: true,
    writable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true,
      writable: true,
    });
  }

  const sessionStorageStore: Record<string, string> = {};
  const sessionStorageMock = {
    getItem: vi.fn((key: string) => sessionStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      sessionStorageStore[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete sessionStorageStore[key];
    }),
    clear: vi.fn(() => {
      for (const k of Object.keys(sessionStorageStore)) delete sessionStorageStore[k];
    }),
    get length() {
      return Object.keys(sessionStorageStore).length;
    },
    key: vi.fn((index: number) => Object.keys(sessionStorageStore)[index] ?? null),
  };

  Object.defineProperty(globalThis, 'sessionStorage', {
    value: sessionStorageMock,
    configurable: true,
    writable: true,
  });
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'sessionStorage', {
      value: sessionStorageMock,
      configurable: true,
      writable: true,
    });
  }

  return { localStorageMock, sessionStorageMock };
});

export const localStorageMock = storageMocks.localStorageMock;
export const sessionStorageMock = storageMocks.sessionStorageMock;

import { deviceKey } from '../src/lib/sync/deviceStorage';
import React from 'react';
import { render, act } from '@testing-library/react';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAppStore } from '../src/store/useAppStore';
import type { UserData } from '../src/types';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock window methods
if (typeof window !== 'undefined') {
  window.scrollTo = vi.fn();
  window.alert = vi.fn();
  window.confirm = vi.fn(() => true);
}

// Global stubs for Vite define constants
vi.stubGlobal('__APP_VERSION__', '1.0.0-test');
vi.stubGlobal('__BUILD_HASH__', 'abcdef1');
vi.stubGlobal('__BUILD_TIME__', '2026-08-26T00:00:00Z');

// Mock ResizeObserver
(globalThis as any).ResizeObserver = class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
} as any;

// Mock useDialogStore
vi.mock('../src/store/useDialogStore', () => {
  const defaultState = {
    isOpen: false,
    type: 'confirm',
    title: '',
    message: '',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    showAlert: vi.fn().mockResolvedValue(undefined),
    showConfirm: vi.fn().mockResolvedValue(true),
    showUnsyncedDataLogout: vi.fn().mockResolvedValue('cancel'),
    closeDialog: vi.fn(),
  };
  const useDialogStore = Object.assign(
    (selector?: any) => (typeof selector === 'function' ? selector(defaultState) : defaultState),
    {
      getState: () => defaultState,
      setState: vi.fn(),
      subscribe: vi.fn(),
    }
  );
  return { useDialogStore };
});

export const emptyUserData: UserData = {
  profile: {},
  library: [],
  routines: [],
  history: [],
  nutrition: {},
  customFoods: [],
  activeWorkout: null,
  nutritionPlanning: {
    weight: 80,
    carbsPerKg: 3.5,
    proPerKg: 2.0,
    fatPerKg: 1.0,
    lockedMacro: null,
    chartPeriod: 7,
    normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
  },
  trainingCycles: [],
  activeCycleId: null,
  supplements: [],
  activePains: [],
  catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
};

// Mock HTMLCanvasElement context for Chart.js
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(function (this: any) { return { canvas: this,
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Array(4) })),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  resetTransform: vi.fn(),
  drawFocusIfNeeded: vi.fn(),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  beginPath: vi.fn(),
  fill: vi.fn(),
  stroke: vi.fn(),
  arc: vi.fn(),
  arcTo: vi.fn(),
  scale: vi.fn(),
  measureText: vi.fn(() => ({ width: 0 })),
  transform: vi.fn(),
  rect: vi.fn(),
  clip: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  closePath: vi.fn(),
  strokeRect: vi.fn(),
  strokeText: vi.fn(),
  fillText: vi.fn(),
}; }) as any;

// Mock idb-keyval
export const idbStore: Record<string, any> = {};
beforeEach(() => {
  for (const key of Object.keys(idbStore)) delete idbStore[key];
  localStorageMock.clear();
  sessionStorageMock.clear();
});
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => idbStore[key] ?? undefined),
  set: vi.fn(async (key: string, value: any) => {
    idbStore[key] = value;
  }),
  update: vi.fn(async (key: string, updater: (value: any) => any) => {
    idbStore[key] = await updater(idbStore[key]);
  }),
  del: vi.fn(async (key: string) => {
    delete idbStore[key];
  }),
  clear: vi.fn(async () => {
    for (const k in idbStore) delete idbStore[k];
  }),
}));

// Mock virtual:pwa-register/react
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: vi.fn(() => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  })),
}));

// Mock Firebase
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: { uid: 'test-user-id', email: 'test@example.com', displayName: 'Test User' } })),
  GoogleAuthProvider: class { setCustomParameters = vi.fn(); },
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn().mockResolvedValue(null),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn((_auth, callback) => {
    _auth.currentUser ??= {
      uid: 'test-user-id',
      email: 'test@example.com',
      displayName: 'Test User',
    };
    callback(_auth.currentUser);
    return () => {};
  }),
  setPersistence: vi.fn().mockResolvedValue(undefined),
  browserLocalPersistence: {},
  indexedDBLocalPersistence: {},
  deleteUser: vi.fn(),
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: vi.fn(() => ({})),
  ReCaptchaEnterpriseProvider: vi.fn(),
  getToken: vi.fn().mockResolvedValue({ token: 'mock-token', expireTimeMillis: Date.now() + 3600000 }),
  isSupported: vi.fn().mockResolvedValue(true),
}));

vi.mock('firebase/firestore', () => {
  const getDoc = vi.fn().mockResolvedValue({ exists: () => false });
  const writeBatch = vi.fn().mockReturnValue({ set: vi.fn(), delete: vi.fn(), commit: vi.fn().mockResolvedValue(undefined) });
  return {
    getFirestore: vi.fn(() => ({})), initializeFirestore: vi.fn(() => ({})),
    persistentLocalCache: vi.fn(), persistentMultipleTabManager: vi.fn(),
    waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
    doc: vi.fn(), getDoc, setDoc: vi.fn().mockResolvedValue(undefined),
    deleteDoc: vi.fn().mockResolvedValue(undefined), collection: vi.fn(),
    getDocs: vi.fn().mockResolvedValue({ docs: [] }), deleteField: vi.fn(), writeBatch,
    // Adapter for UI/contract tests only. Real retries and authorization run in test:rules.
    runTransaction: vi.fn(async (_db, callback) => {
      const batch = writeBatch();
      const result = await callback({ get: getDoc, set: batch.set, delete: batch.delete });
      if (!result?.conflicts?.length) await batch.commit();
      return result;
    }),
  };
});

// Mock DB module
vi.mock('../src/lib/db', () => ({
  DB: {
    resetCache: vi.fn(),
    loadCloudPayload: vi.fn().mockImplementation(() => {
      const state = useAppStore.getState();
      return state.userData ? { data: state.userData, completeMonths: [], cloudDocuments: new Map() } : null;
    }),
    loadUserData: vi.fn().mockImplementation(() => {
      const state = useAppStore.getState();
      return state.userData;
    }),
    saveUserData: vi.fn().mockResolvedValue({ ok: true, status: 'synced' }),
    secureLogOut: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    purgeAllLocalUserData: vi.fn().mockImplementation(async () => {
      delete idbStore['logbook:v2:user:test-user-id'];
      delete idbStore['logbook_cached_user_data'];
      delete idbStore['pending_sync_token'];
      delete idbStore['pending_sync_payload'];
      localStorage.removeItem(deviceKey('workout'));
      localStorage.removeItem('logbook_local_workout');
      localStorage.removeItem('logbook_timer_state');
      localStorage.removeItem('logbook_timer_start');
      localStorage.removeItem('logbook_timer_accumulated');
      localStorage.removeItem('draft_measurement');
      localStorage.removeItem('draft_exercise');
      localStorage.removeItem('draft_routine');
      localStorage.removeItem('logbook_is_guest');
      localStorage.removeItem('logbook_awaiting_redirect');
    }),
  },
}));

// Default Mock User Data
export const defaultMockUserData: UserData = {
  profile: { dob: '1995-01-01', height: '175', gender: 'M' },
  library: [
    { id: 'ex1', name: 'Panca Piana', notes: 'Esecuzione controllata', setsCount: 3, muscles: ['chest'], secondaryMuscles: ['triceps'], trackingType: 'weight_reps', isDefault: false, sets: [] },
    { id: 'ex2', name: 'Squat', notes: 'Accosciata completa', setsCount: 3, muscles: ['legs'], secondaryMuscles: [], trackingType: 'weight_reps', isDefault: false, sets: [] }
  ],
  routines: [
    {
      id: 'r1',
      name: 'Scheda A - Upper',
      exercises: [{ exId: 'ex1', setsCount: 3 }]
    }
  ],
  history: [
    {
      id: 'w1',
      date: '2026-07-25',
      routineName: 'Scheda A - Upper',
      globalDurationStr: '45m',
      moodRating: 4,
      pumpRating: 4,
      fatigueRating: 3,
      waterLiters: 2,
      exercises: [
        { exId: 'ex1', sets: [{ id: 's1', kg: '80', reps: '10' }], sessionNote: 'Ottimo allenamento' }
      ]
    }
  ],
  nutrition: {
    '2026-07-26': { date: '2026-07-26', weight: 75, kcal: 2400, pro: 160, carbs: 280, fat: 65, meals: [], supplementsIntake: [] }
  },
  customFoods: [
    { id: 'cf1', name: 'Proteine Whey', kcal: 380, pro: 80, carbs: 5, fat: 3, unit: '100g', isCustom: true }
  ],
  activeWorkout: null,
  nutritionPlanning: {
    weight: 75,
    carbsPerKg: 3.5,
    proPerKg: 2.0,
    fatPerKg: 1.0,
    lockedMacro: null,
    chartPeriod: 7,
    normocalorica: { kcal: 2500, carbs: 300, pro: 160, fat: 70 }
  },
  trainingCycles: [],
  activeCycleId: null,
  supplements: [],
  activePains: [],
  catalogOverrides: { exercises: {}, foods: {}, hiddenExerciseIds: [], hiddenFoodIds: [] }
};

export function createMockUserData(overrides?: Partial<UserData>): UserData {
  return {
    ...defaultMockUserData,
    ...overrides,
    profile: { ...defaultMockUserData.profile, ...(overrides?.profile || {}) },
    catalogOverrides: {
      ...defaultMockUserData.catalogOverrides,
      ...(overrides?.catalogOverrides || {})
    },
    nutritionPlanning: overrides?.nutritionPlanning !== undefined
      ? overrides.nutritionPlanning
      : defaultMockUserData.nutritionPlanning,
  };
}

vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, itemContent }: any) => (
    <div data-testid="virtuoso-mock">
      {data?.map((item: any, i: number) => (
        <div key={i}>{itemContent(i, item)}</div>
      ))}
    </div>
  )
}));

export interface RenderOptions {
  userData?: any;
  localWorkout?: any;
}

export function renderWithProviders(ui: React.ReactElement, options: RenderOptions = {}) {
  const initialUserData = options.userData !== undefined ? options.userData : defaultMockUserData;
  const initialLocalWorkout = options.localWorkout !== undefined ? options.localWorkout : null;

  useAppStore.setState({
    userData: initialUserData,
    localWorkout: initialLocalWorkout,
    syncing: false,
    saveError: null,
  });

  let result: any;
  act(() => {
    result = render(
      <AuthProvider>
        {ui}
      </AuthProvider>
    );
  });
  return result;
}
