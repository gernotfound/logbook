import {
  LOCAL_STORAGE_ACTIVE_TAB,
  LOCAL_STORAGE_TRAINING_TAB,
  LOCAL_STORAGE_NUTRITION_TAB,
  LOCAL_STORAGE_DATA_TAB,
} from '../constants';

// Only these non-sensitive navigation/editor visibility flags may remain
// plaintext in the owner namespace; the vault's migration inventory is strict.
export const OWNER_UI_PREFERENCES = [
  LOCAL_STORAGE_ACTIVE_TAB,
  LOCAL_STORAGE_TRAINING_TAB,
  LOCAL_STORAGE_NUTRITION_TAB,
  LOCAL_STORAGE_DATA_TAB,
  'creating-exercise',
  'creating-routine',
] as const;

type OwnerUiPreference = (typeof OWNER_UI_PREFERENCES)[number];

export const ownerUiPreferenceKey = (owner: string, preference: OwnerUiPreference): string =>
  `logbook:v2:${owner}:ui:${preference}`;
