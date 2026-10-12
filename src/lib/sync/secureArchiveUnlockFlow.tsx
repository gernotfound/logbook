import { useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { createAndMigrateVault, resumeVaultMigration } from './secureArchiveMigration';
import { isVaultUnlocked, readVaultControl, unlockVaultWithPassphrase, unlockVaultWithRecoveryCode } from './secureArchiveSession';
import { normalizeStorageOwner } from './owner';

type VaultStep = 'setup' | 'unlock' | 'resume' | 'recovery-display';
type UnlockMethod = 'passphrase' | 'recovery';

const activePrompts = new Map<string, Promise<void>>();

function VaultPrompt({ owner, done }: { owner: string; done: () => void }) {
    const [initial] = useState(() => readVaultControl(owner));
    const [step, setStep] = useState<VaultStep>(
        initial === null ? 'setup' : initial.phase === 'migrating' ? 'resume' : 'unlock',
    );
    const [method, setMethod] = useState<UnlockMethod>('passphrase');
    const [secret, setSecret] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError(null);
        try {
            if (step === 'setup') {
                if (secret.length < 16 || secret.length > 1024) throw new Error('La passphrase deve contenere almeno 16 caratteri.');
                if (secret !== confirmation) throw new Error('Le due passphrase non corrispondono.');
                const created = await createAndMigrateVault(owner, secret);
                setRecoveryCode(created.recoveryCode);
                setSecret('');
                setConfirmation('');
                setStep('recovery-display');
                return;
            }
            if (step === 'resume') await resumeVaultMigration(owner, secret, method);
            else if (method === 'passphrase') await unlockVaultWithPassphrase(owner, secret);
            else await unlockVaultWithRecoveryCode(owner, secret);
            setSecret('');
            done();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Sblocco non riuscito. I dati sul dispositivo sono stati conservati.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="vault-heading" style={{
            position: 'fixed', inset: 0, zIndex: 2147483647, background: 'var(--bg-color, #10151c)',
            color: 'var(--text-main, #f3f5f7)', display: 'grid', placeItems: 'center', overflowY: 'auto', padding: 18,
        }}>
            <div className="auth-panel" style={{ width: 'min(100%, 440px)', maxHeight: '95dvh', overflowY: 'auto', padding: 24, margin: 'auto' }}>
                <h1 id="vault-heading" style={{ marginBottom: 16 }}>Archivio protetto TheLogBook</h1>
                {step === 'recovery-display' ? (
                    <>
                        <p>L'archivio locale è stato cifrato. Conserva questo <strong>codice di recupero</strong> fuori dal dispositivo, in un luogo sicuro.</p>
                        <p>Se perdi sia la passphrase sia il codice, le modifiche salvate solo offline non potranno essere recuperate.</p>
                        <output aria-label="Codice di recupero" style={{ display: 'block', fontFamily: 'monospace', overflowWrap: 'anywhere', padding: 12, userSelect: 'text', border: '1px solid currentColor', marginBottom: 14 }}>{recoveryCode}</output>
                        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
                            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
                            Ho salvato il codice di recupero in un luogo sicuro.
                        </label>
                        <button type="button" className="btn btn-primary" disabled={!confirmed} onClick={done}>Continua nella PWA</button>
                    </>
                ) : (
                    <>
                        <p style={{ lineHeight: 1.5 }}>
                            {step === 'setup'
                                ? "Scegli una passphrase locale. I dati salvati sul dispositivo verranno protetti; dopo lo sblocco TheLogBook funzionerà anche offline."
                                : step === 'resume'
                                    ? 'Una precedente protezione è stata interrotta. Riprendi la migrazione con la passphrase o il codice di recupero. I dati originali non saranno cancellati senza verifica.'
                                    : 'Sblocca i dati salvati su questo dispositivo. Non è necessaria una connessione Internet.'}
                        </p>
                        {step !== 'setup' && (
                            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                                <button type="button" className="btn" aria-pressed={method === 'passphrase'} onClick={() => { setMethod('passphrase'); setSecret(''); setError(null); }}>Passphrase</button>
                                <button type="button" className="btn" aria-pressed={method === 'recovery'} onClick={() => { setMethod('recovery'); setSecret(''); setError(null); }}>Codice recupero</button>
                            </div>
                        )}
                        <form onSubmit={e => { void submit(e); }} style={{ display: 'grid', gap: 12 }}>
                            <label htmlFor="vault-secret">{method === 'recovery' && step !== 'setup' ? 'Codice di recupero' : 'Passphrase locale'}</label>
                            <input id="vault-secret" className="form-control" type="password" autoComplete="off" autoFocus required value={secret} onChange={e => setSecret(e.target.value)} minLength={step === 'setup' ? 16 : undefined} />
                            {step === 'setup' && (
                                <>
                                    <label htmlFor="vault-confirm">Conferma la passphrase</label>
                                    <input id="vault-confirm" className="form-control" type="password" autoComplete="off" required value={confirmation} onChange={e => setConfirmation(e.target.value)} minLength={16} />
                                </>
                            )}
                            {error && <p role="alert" style={{ color: 'var(--error-color, #ea7373)' }}>{error}</p>}
                            <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Verifica archivio…' : step === 'setup' ? 'Proteggi questo dispositivo' : step === 'resume' ? 'Riprendi il recupero' : 'Sblocca archivio'}</button>
                        </form>
                    </>
                )}
            </div>
        </div>
    );
}

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
    root.render(<VaultPrompt owner={owner} done={finish} />);
    return promise;
}
