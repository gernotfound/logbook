import type { User } from 'firebase/auth';
import type { UserData } from '../../types';
import { auth } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { loadAuthenticatedData } from './loadAuthenticatedData';

type DrainEnvironment = {
    load: typeof loadAuthenticatedData;
    readLocal: typeof import('../../lib/sync/localRepository')['readLocal'];
    flush: () => Promise<unknown>;
    currentUid: () => string | null;
    isOnline: () => boolean;
};

const productionEnvironment: DrainEnvironment = {
    load: loadAuthenticatedData,
    readLocal: async owner => (await import('../../lib/sync/localRepository')).readLocal(owner),
    flush: () => useAppStore.getState().flushPendingSyncs(),
    currentUid: () => auth.currentUser?.uid ?? null,
    isOnline: () => typeof navigator === 'undefined' || navigator.onLine,
};

type AuthenticatedDataSyncOptions = {
    user: User;
    isGuestActive: () => boolean;
    setUserData: (data: UserData) => void;
    setSyncing: (value: boolean) => void;
    setSaveError: (value: string | null) => void;
};

// Preserve the ordered first hydrate -> checkpointed journal replay -> one
// replica-fenced rehydrate/rebase -> replay. Do not acknowledge the local
// journal unless the underlying replica transport confirms delivery.
export async function loadAndDrainAuthenticatedData({
    user, isGuestActive, setUserData, setSyncing, setSaveError,
}: AuthenticatedDataSyncOptions, environment: DrainEnvironment = productionEnvironment): Promise<void> {
    const outcome = await environment.load({
        user,
        isGuestActive,
        setUserData,
        setSyncing,
        setSaveError,
    });

    const isCurrentOwner = () => environment.currentUid() === user.uid
        && !isGuestActive() && environment.isOnline();
    if (outcome === 'blocked' || !isCurrentOwner()) return;
    const drainCheckpointedJournal = async () => {
        const envelope = await environment.readLocal(user.uid);
        // The global flush uses the current store owner; a delayed IndexedDB
        // read must not flush a later authenticated session.
        if (!isCurrentOwner() || !envelope?.replica || !envelope.pending.length) return;
        await environment.flush();
    };

    // A Protocol 3 checkpoint can be the prerequisite that makes an offline or
    // migrated journal deliverable. Drain it after the checkpoint instead of
    // relying on listener ordering between the global replay and auth refresh.
    try {
        await drainCheckpointedJournal();
    } catch (error) {
        if ((error as { code?: unknown })?.code !== 'replica-fenced') throw error;

        if (!isCurrentOwner()) return;
        // transactionWriter has already marked the durable identity as checkpoint-required.
        // Re-enter the authenticated loader once: it performs a full cloud scan, obtains
        // a current generation, rebases the journal, then the retry can be delivered.
        const retryOutcome = await environment.load({
            user,
            isGuestActive,
            setUserData,
            setSyncing,
            setSaveError,
        });
        if (retryOutcome === 'blocked' || !isCurrentOwner()) return;
        await drainCheckpointedJournal();
    }
}
