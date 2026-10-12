import { createRoot } from 'react-dom/client';
import { SecureVaultPrompt } from './SecureVaultPrompt';
import { isVaultUnlocked } from './secureArchiveSession';
import { normalizeStorageOwner } from './owner';

const activePrompts = new Map<string, Promise<void>>();

/**
 * Blocks every ordinary business-data bootstrap, hydration, and sync until the
 * owner-scoped vault is provisioned or unwrapped. Prompts are shared by calls
 * in the SAME tab, but keys are never shared across tabs.
 */
export function ensureLocalVaultReady(requestedOwner: string): Promise<void> {
    const owner = normalizeStorageOwner(requestedOwner);
    if (isVaultUnlocked(owner)) return Promise.resolve();
    const running = activePrompts.get(owner);
    if (running) return running;
    if (typeof document === 'undefined') return Promise.reject(new Error('Sblocco archivio non disponibile senza interfaccia.'));
    const node = document.createElement('div');
    node.id = 'secure-local-archive-unlock';
    document.body.appendChild(node);
    const root = createRoot(node);
    let resolve!: () => void;
    const promise = new Promise<void>(r => { resolve = r; });
    activePrompts.set(owner, promise);
    const finish = () => {
        if (!isVaultUnlocked(owner)) return;
        root.unmount();
        node.remove();
        activePrompts.delete(owner);
        resolve();
    };
    root.render(<SecureVaultPrompt owner={owner} done={finish} />);
    return promise;
}
