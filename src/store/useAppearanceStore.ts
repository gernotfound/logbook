import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const APPEARANCE_STORAGE_KEY = 'logbook:appearance:v1';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function readPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(APPEARANCE_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== 'system') return preference;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = resolvedTheme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = resolvedTheme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', resolvedTheme === 'dark' ? '#000000' : '#f3f4f6');
}

interface AppearanceState {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  /** False means the session changed theme but the device could not persist it. */
  setPreference: (preference: ThemePreference) => boolean;
}

const initialPreference = readPreference();

export const useAppearanceStore = create<AppearanceState>((set) => ({
  preference: initialPreference,
  resolvedTheme: resolveTheme(initialPreference),
  setPreference: (value) => {
    const preference = parseThemePreference(value);
    const resolvedTheme = resolveTheme(preference);
    applyTheme(preference, resolvedTheme);
    set({ preference, resolvedTheme });

    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
      return true;
    } catch {
      return false;
    }
  },
}));

let disposeAppearance: (() => void) | undefined;

/** Initializes the device-only preference and its system/cross-tab listeners. */
export function initializeAppearance(): () => void {
  if (disposeAppearance) return disposeAppearance;

  const media = typeof matchMedia === 'function'
    ? matchMedia('(prefers-color-scheme: dark)')
    : null;

  const refresh = (preference = useAppearanceStore.getState().preference) => {
    const resolvedTheme = resolveTheme(preference);
    applyTheme(preference, resolvedTheme);
    useAppearanceStore.setState({ preference, resolvedTheme });
  };

  const onSystemChange = () => {
    if (useAppearanceStore.getState().preference === 'system') refresh();
  };

  const onStorage = (event: StorageEvent) => {
    if (event.storageArea && event.storageArea !== localStorage) return;
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) {
      refresh(parseThemePreference(event.newValue));
    }
  };

  refresh();
  media?.addEventListener('change', onSystemChange);
  window.addEventListener('storage', onStorage);

  disposeAppearance = () => {
    media?.removeEventListener('change', onSystemChange);
    window.removeEventListener('storage', onStorage);
    disposeAppearance = undefined;
  };

  return disposeAppearance;
}

/** Canvas charts cannot inherit CSS variables, so expose their resolved colors. */
export function getChartColors() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();

  return {
    text: token('--text-main'),
    muted: token('--text-muted'),
    grid: token('--chart-grid'),
    surface: token('--surface-color'),
    primary: token('--primary-color'),
    secondary: token('--accent-color'),
    warning: token('--warning-color'),
    success: token('--success-color'),
    danger: token('--danger-color'),
  };
}
