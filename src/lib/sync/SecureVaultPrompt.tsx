type Props = { error: string; retry: () => void };

/**
 * Displayed ONLY if automatic local device-key recovery fails. No password,
 * recovery phrase or PIN is ever requested as part of ordinary access.
 * Never offer a silent reset: offline-only pending journal may be irreplaceable.
 */
export function SecureVaultPrompt({ error, retry }: Props) {
    return (
        <div role="alertdialog" aria-modal="true" aria-labelledby="device-vault-error" style={{
            position: 'fixed', inset: 0, zIndex: 2147483647,
            background: 'var(--bg-color, #10151c)', color: 'var(--text-main, #f3f5f7)',
            display: 'grid', placeItems: 'center', padding: 18,
        }}>
            <div className="auth-panel" style={{ width: 'min(100%, 440px)', padding: 24, margin: 'auto' }}>
                <h1 id="device-vault-error">Archivio locale temporaneamente non disponibile</h1>
                <p>Non è possibile leggere in modo sicuro i dati protetti di questo dispositivo. Nessun dato è stato cancellato.</p>
                <p>Le modifiche non ancora sincronizzate potrebbero esistere soltanto qui. Non cancellare i dati del browser né reinstallare la PWA prima di aver verificato il recupero.</p>
                <p role="alert">{error}</p>
                <button type="button" className="btn btn-primary" onClick={retry}>Riprova</button>
            </div>
        </div>
    );
}
