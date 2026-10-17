import { useAuth } from './useAuth';
import { useSettingsAccountActions } from './useSettingsAccountActions';
import { useSettingsProfile } from './useSettingsProfile';
import { useSettingsTransfers } from './useSettingsTransfers';

export function useSettings() {
    const { currentUser, isGuest, logout } = useAuth();
    const profile = useSettingsProfile();
    const transfers = useSettingsTransfers({ currentUser, isGuest });
    const account = useSettingsAccountActions({ currentUser, isGuest, logout });
    return { currentUser, ...account, ...profile, ...transfers };
}
