import React from 'react';
import { render, act } from '@testing-library/react';
import { vi } from 'vitest';
import { AuthProvider } from '../src/contexts/AuthContext';
import { useAppStore } from '../src/store/useAppStore';

// Mock window methods
if (typeof window !== 'undefined') {
  window.scrollTo = vi.fn();
  window.alert = vi.fn();
  window.confirm = vi.fn(() => true);
}

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

export const emptyUserData: any = {
  profile: {},
  library: [],
  routines: [],
  history: [],
  nutrition: {},
  customFoods: [],
  activeWorkout: null,
  nutritionPlanning: {}
};

// Mock HTMLCanvasElement context for Chart.js
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation(() => ({
  fillRect: vi.fn(),
  clearRect: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Array(4) })),
  putImageData: vi.fn(),
  createImageData: vi.fn(),
  setTransform: vi.fn(),
  drawFocusIfNeeded: vi.fn(),
  createRadialGradient: vi.fn(),
  createLinearGradient: vi.fn(),
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
})) as any;

// Mock localStorage
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value.toString();
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    for (const k in localStorageStore) delete localStorageStore[k];
  }),
  length: 0,
  key: vi.fn((_index: number) => null),
};
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock virtual:pwa-register/react
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

// Mock Firebase
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn().mockResolvedValue(null),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn((auth, callback) => {
    callback({
      uid: 'test-user-id',
      email: 'test@example.com',
      displayName: 'Test User',
    });
    return () => {};
  }),
  setPersistence: vi.fn().mockResolvedValue(undefined),
  browserLocalPersistence: {},
  deleteUser: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(),
  initializeFirestore: vi.fn(),
  persistentLocalCache: vi.fn(),
  persistentMultipleTabManager: vi.fn(),
  waitForPendingWrites: vi.fn().mockResolvedValue(undefined),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  setDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  collection: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  deleteField: vi.fn(),
}));

// Mock DB module
vi.mock('../src/lib/db', () => ({
  DB: {
    loadUserData: vi.fn().mockImplementation(() => {
      const state = useAppStore.getState();
      return state.userData;
    }),
    saveUserData: vi.fn().mockResolvedValue(undefined),
    secureLogOut: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
  },
}));

// Default Mock User Data
export const defaultMockUserData = {
  profile: { name: 'Test User', dob: '1995-01-01', height: '175', gender: 'M', weight: 75, bodyFat: 15 },
  library: [
    { id: 'ex1', name: 'Panca Piana', targetMuscle: 'petto', notes: 'Esecuzione controllata' },
    { id: 'ex2', name: 'Squat', targetMuscle: 'gambe', notes: 'Accosciata completa' }
  ],
  routines: [
    {
      id: 'r1',
      name: 'Scheda A - Upper',
      notes: 'Focus petto',
      exercises: [{ exId: 'ex1', setsCount: 3 }]
    }
  ],
  history: [
    {
      id: 'w1',
      date: '2026-07-25',
      routineName: 'Scheda A - Upper',
      duration: '45m',
      mood: 4,
      pump: 4,
      fatigue: 3,
      water: 2,
      exercises: [
        { exId: 'ex1', sets: [{ id: 's1', kg: '80', reps: '10' }], sessionNote: 'Ottimo allenamento' }
      ]
    }
  ],
  nutrition: {
    '2026-07-26': { weight: 75, kcal: 2400, pro: 160, carbs: 280, fat: 65 }
  },
  customFoods: [
    { id: 'cf1', name: 'Proteine Whey', kcal: 380, pro: 80, carbs: 5, fat: 3, unit: '100g' }
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
  }
};

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
