import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useLocalStorage } from './useLocalStorage';
import { ownerUiPreferenceKey } from '../lib/uiPreferenceKeys';
import { LOCAL_STORAGE_ACTIVE_TAB, LOCAL_STORAGE_TRAINING_TAB, LOCAL_STORAGE_NUTRITION_TAB, LOCAL_STORAGE_DATA_TAB } from '../constants';
import { AppTabSchema, TrainingSubTabSchema, NutritionSubTabSchema, DataSubTabSchema } from '../lib/schema';
import type { AppTab, TrainingSubTab, NutritionSubTab, DataSubTab } from '../types';

// Navigation preferences and scroll positions belong to the owner-keyed app tree.
export function useAppNavigation(navigationOwner: string, startupTab: string | null) {
  const parsedStartupTab = AppTabSchema.safeParse(startupTab);
  const initialTabOverride: AppTab | undefined = startupTab === 'settings'
    ? 'home'
    : parsedStartupTab.success ? parsedStartupTab.data : undefined;
  const [activeTab, setActiveTab] = useLocalStorage<AppTab>(ownerUiPreferenceKey(navigationOwner, LOCAL_STORAGE_ACTIVE_TAB), 'home', AppTabSchema, initialTabOverride);
  const [trainingSubTab, setTrainingSubTab] = useLocalStorage<TrainingSubTab>(ownerUiPreferenceKey(navigationOwner, LOCAL_STORAGE_TRAINING_TAB), 'session', TrainingSubTabSchema);
  const [nutritionSubTab, setNutritionSubTab] = useLocalStorage<NutritionSubTab>(ownerUiPreferenceKey(navigationOwner, LOCAL_STORAGE_NUTRITION_TAB), 'meals', NutritionSubTabSchema);
  const [dataSubTab, setDataSubTab] = useLocalStorage<DataSubTab>(ownerUiPreferenceKey(navigationOwner, LOCAL_STORAGE_DATA_TAB), 'measurements', DataSubTabSchema);
  const [settingsOpen, setSettingsOpen] = useState(() => startupTab === 'settings');

  // PWA shortcuts override the saved initial tab during state initialization.
  // Only the URL cleanup belongs in an effect; no extra render is required.
  useEffect(() => {
    if (startupTab === null || typeof window === 'undefined') return;
    // Consume only our one-shot shortcut, preserving independent query/hash
    // parameters and router history state for other application entry flows.
    const url = new URL(window.location.href);
    url.searchParams.delete('tab');
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [startupTab]);

  // Track visited tabs for lazy Keep-Alive rendering
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<AppTab>>(() => new Set([activeTab]));

  // Preserve and restore scroll position across tabs without mutating React state.
  const tabScrollPositions = useRef<Map<AppTab, number>>(new Map());

  const handleOpenSettings = () => {
    tabScrollPositions.current.set('home', window.scrollY);
    setSettingsOpen(true);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };

  const handleCloseSettings = () => {
    setSettingsOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: tabScrollPositions.current.get('home') ?? 0, behavior: 'instant' });
    });
  };

  const handleTabChange = (newTab: string) => {
    const parsed = AppTabSchema.safeParse(newTab);
    if (!parsed.success) return;
    const validTab = parsed.data;
    const wasSettingsOpen = settingsOpen;

    if (wasSettingsOpen) setSettingsOpen(false);

    if (validTab === activeTab) {
      if (validTab === 'training') setTrainingSubTab('session');
      if (validTab === 'nutrition') setNutritionSubTab('meals');
      if (validTab === 'data') setDataSubTab('measurements');

      tabScrollPositions.current.set(activeTab, 0);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (!wasSettingsOpen) tabScrollPositions.current.set(activeTab, window.scrollY);
    setVisitedTabs(prev => prev.has(validTab) ? prev : new Set([...prev, validTab]));
    setActiveTab(validTab);
    requestAnimationFrame(() => {
      const savedPos = tabScrollPositions.current.get(validTab) ?? 0;
      window.scrollTo({ top: savedPos, behavior: 'instant' });
    });
  };

  const handleHomeNavigate = (tab: string) => {
    if (tab === 'settings') {
      handleOpenSettings();
      return;
    }
    if (tab === 'training-history') {
      setTrainingSubTab('history');
      handleTabChange('training');
      return;
    }
    if (tab === 'training') setTrainingSubTab('session');
    if (tab === 'nutrition') setNutritionSubTab('meals');
    handleTabChange(tab);
  };

  // React's effect event reads the latest navigation state without forcing
  // the native event subscription to churn on each UI render.
  const onAppNavigate = useEffectEvent((detail: unknown) => {
    if (detail === 'settings') {
      if (activeTab !== 'home') setActiveTab('home');
      setSettingsOpen(true);
      return;
    }
    const parsed = AppTabSchema.safeParse(detail);
    if (parsed.success) handleTabChange(parsed.data);
  });

  useEffect(() => {
    const handleNavEvent = (e: Event) => {
      onAppNavigate((e as CustomEvent).detail);
    };
    window.addEventListener('app:navigate', handleNavEvent);
    return () => window.removeEventListener('app:navigate', handleNavEvent);
  }, []);

  return {
    activeTab, trainingSubTab, setTrainingSubTab, nutritionSubTab, setNutritionSubTab,
    dataSubTab, setDataSubTab, settingsOpen, visitedTabs,
    handleOpenSettings, handleCloseSettings, handleTabChange, handleHomeNavigate,
  };
}
