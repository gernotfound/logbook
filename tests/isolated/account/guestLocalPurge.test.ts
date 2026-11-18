import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeGuestLocalData } from '../../../src/lib/db/guestLocalPurge';
import { purgeOwnerLocalData } from '../../../src/lib/db/ownerLocalPurge';

vi.mock('../../../src/lib/db/ownerLocalPurge', () => ({ purgeOwnerLocalData: vi.fn() }));
vi.mock('../../../src/lib/firebase', () => {
    throw new Error('Guest purge must not import Firebase');
});

const GUEST_FENCE = 'logbook:local-purge-fence:v1:guest';

beforeEach(() => {
    localStorage.clear();
    vi.resetAllMocks();
    vi.mocked(purgeOwnerLocalData).mockImplementation(async (_owner, _resume, guard) => {
        await guard?.preflight();
        await guard?.afterFence();
        guard?.assertStillSafe?.();
    });
});
afterEach(() => vi.restoreAllMocks());

describe('Guest-only purge without account identity SDK', () => {
    it('uses owner-scoped physical purge with all normal preflight and post-lock guards', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        await expect(purgeGuestLocalData()).resolves.toBeUndefined();
        expect(purgeOwnerLocalData).toHaveBeenCalledOnce();
        expect(purgeOwnerLocalData).toHaveBeenCalledWith('guest', false, expect.objectContaining({
            preflight: expect.any(Function), afterFence: expect.any(Function),
            assertStillSafe: expect.any(Function),
        }));
    });

    it('rejects an unresolved guest health withdrawal without purging', async () => {
        localStorage.setItem('logbook_is_guest', 'true');
        localStorage.setItem('logbook:v2:guest:health-consent-withdrawal', 'pending:0');
        await expect(purgeGuestLocalData()).rejects.toThrow('revoca');
        expect(purgeOwnerLocalData).toHaveBeenCalledOnce();
    });

    it('does not erase guest data when a different owner hint remains', async () => {
        localStorage.setItem('logbook_authenticated_owner', 'user:other');
        await expect(purgeGuestLocalData()).rejects.toThrow('Un altro account');
    });

    it('cannot treat an absent guest flag as clearance of a pending account deletion', async () => {
        localStorage.setItem('logbook:v2:user:a:account-deletion', JSON.stringify({
            owner: 'user:a', uid: 'a', startedAt: 12345,
        }));
        await expect(purgeGuestLocalData()).rejects.toThrow('Recupero cancellazione account');
    });

    it('preserves the crash-resume pathway without reading a possibly removed consent record', async () => {
        localStorage.setItem(GUEST_FENCE, 'purge-in-progress:v1');
        localStorage.setItem('logbook:v2:guest:health-consent-withdrawal', 'pending:0');
        await expect(purgeGuestLocalData()).resolves.toBeUndefined();
        expect(purgeOwnerLocalData).toHaveBeenCalledWith('guest', true, expect.any(Object));
    });

    it('refuses to resume a prior purge into a newly active guest generation', async () => {
        localStorage.setItem(GUEST_FENCE, 'purge-in-progress:v1');
        localStorage.setItem('logbook_is_guest', 'true');
        await expect(purgeGuestLocalData()).rejects.toThrow('Un altro account');
    });
});
