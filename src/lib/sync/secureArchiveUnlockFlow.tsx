import { createRoot, type Root } from 'react-dom/client';
import { SecureVaultPrompt } from './SecureVaultPrompt';
import { isVaultUnlocked, lockVault, readVaultControl, unlockVaultForOwner } from './secureArchiveSession';
import { createAndMigrateVault, resumeVaultMigration } from './secureArchiveMigration';
import { normalizeStorageOwner } from './owner';
import { isLocalPurgePending } from './localPurgeFence';

type PendingReadiness = { promise: Promise<void>; cancel: () => void };
const active = new Map<string, PendingReadiness>();

/**
 * Called only after the guest generation or Firebase UID has been established.
 * No extra user credential is required. The DEK is unwrapped with the local
 * non-extractable Web Crypto device key after ownership has been checked.
 */
export function ensureLocalVaultReady(requestedOwner: string): Promise<void> {
    const owner = normalizeStorageOwner(requestedOwner);
    if (isVaultUnlocked(owner)) return Promise.resolve();
    const existing = active.get(owner);
    if (existing) return existing.promise;

    let root: Root | null = null;
    let container: HTMLElement | null = null;
    let finished = false;
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    const complete = () => {
        if (finished) return;
        finished = true;
        root?.unmount();
        container?.remove();
        active.delete(owner);
        resolve();
    };
    const showFailure = (cause: unknown) => {
        if (finished || typeof document === 'undefined') return;
        if (!root) {
            container = document.createElement('div');
            container.id = 'secure-local-archive-recovery';
            document.body.appendChild(container);
            root = createRoot(container);
        }
        const message = cause instanceof Error ? cause.message : 'Errore sconosciuto dello storage.';
        root.render(<SecureVaultPrompt error={message} retry={() => { void attempt(); }} />);
    };
    let busy = false;
    const attempt = async () => {
        if (finished || busy) return;
        busy = true;
        try {
            if (isLocalPurgePending(owner)) {
                const { resumeInterruptedLocalPurge } = await import('../db/db_account');
                await resumeInterruptedLocalPurge(owner);
            }
            const control = readVaultControl(owner);
            if (!control) await createAndMigrateVault(owner);
            else if (control.phase === 'migrating') {
                if (isLocalPurgePending(owner)) await createAndMigrateVault(owner);
                else await resumeVaultMigration(owner);
            }
            else await unlockVaultForOwner(owner);
            if (finished) { lockVault(owner); return; }
            if (!isVaultUnlocked(owner)) throw new Error('La sessione locale non è più valida.');
            complete();
        } catch (cause) {
            showFailure(cause);
        } finally { busy = false; }
    };
    active.set(owner, { promise, cancel: complete });
    void attempt();
    return promise;
}

/** Cancel a waiting identity without granting it a key or deleting ciphertext. */
export function cancelLocalVaultReadiness(requestedOwner: string): void {
    const owner = normalizeStorageOwner(requestedOwner);
    active.get(owner)?.cancel();
}
