import { afterEach, beforeEach, vi } from 'vitest';
import { useAppStore } from '../../../src/store/useAppStore';
import { activateGuestSession, GUEST_SESSION_KEY, GUEST_REVOCATION_KEY, storageOwner } from '../../../src/lib/sync/session';
import { UserDataSchema } from '../../../src/lib/schema';

export const data = (nutrition = {}) => UserDataSchema.parse({ profile: { height: '180', gender: 'M' }, nutrition }) as any;
export const day = (date: string, fields = {}) => ({ date, kcal: 0, pro: 0, carbs: 0, fat: 0, meals: [], ...fields });
export const storeItem = vi.mocked(localStorage.setItem).getMockImplementation()!;
const originalDispatchDomainOperation = useAppStore.getState().dispatchDomainOperation;

export function installDatedDraftFixtures() {
    beforeEach(() => {
        vi.mocked(localStorage.setItem).mockImplementation(storeItem);
        localStorage.clear();
        // A real owner-scoped guest draft can only be written by a live guest session.
        // Preserve this production security contract in the hook fixtures.
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem(GUEST_SESSION_KEY, 'dated-drafts-fixture');
        localStorage.removeItem(GUEST_REVOCATION_KEY);
        activateGuestSession('dated-drafts-fixture');
        useAppStore.getState().resetStore();
        useAppStore.setState({ userData: data(), dataOwner: storageOwner() });
    });
    afterEach(() => {
        useAppStore.setState({ dispatchDomainOperation: originalDispatchDomainOperation });
        vi.useRealTimers();
        vi.restoreAllMocks();
    });
}
