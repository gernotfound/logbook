import { create } from 'zustand';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const APPEARANCE_STORAGE_KEY = 'logbook:appearance:v1';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

function readPreference(): ThemePreference {
  try { return parseThemePreference(localStorage.getItem(APPEARANCE_STORAGE_KEY)); }
  catch { return 'system'; }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === 'system'
    ? (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
}

function applyTheme(preference: ThemePreference, resolvedTheme: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolvedTheme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#000000' : '#f3f4f6');
}

interface AppearanceState {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  /** False means the choice works for this session but could not be persisted. */
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
    } catch { return false; }
  },
}));

let disposeAppearance: (() => void) | undefined;

/** One device preference, independent of authentication and cloud data. */
export function initializeAppearance(): () => void {
  if (disposeAppearance) return disposeAppearance;
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
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
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) refresh(parseThemePreference(event.newValue));
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

/** Call again after resolvedTheme changes; canvas colors do not inherit CSS. */
export function getChartColors() {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: token('--text-main'), muted: token('--text-muted'), grid: token('--border-strong'),
    surface: token('--surface-color'), primary: token('--primary-color'),
    secondary: token('--accent-color'), warning: token('--warning-color'),
    success: token('--success-color'), danger: token('--danger-color'),
  };
}
