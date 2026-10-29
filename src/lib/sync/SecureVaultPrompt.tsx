import { useEffect, useRef } from 'react';

type Props = { error: string; retry: () => void };

/**
 * Displayed ONLY if automatic local device-key recovery fails. No password,
 * recovery phrase or PIN is ever requested as part of ordinary access.
 * Never offer a silent reset: offline-only pending journal may be irreplaceable.
 */
export function SecureVaultPrompt({ error, retry }: Props) {
    const retryRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const button = retryRef.current;
        if (!button) return;

        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const mount = Array.from(document.body.children).find(child => child.contains(button));
        const background = Array.from(document.body.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== mount);
        const previousInert = background.map(child => child.inert);
        const previousOverflow = document.body.style.overflow;

        background.forEach(child => { child.inert = true; });
        document.body.style.overflow = 'hidden';
        button.focus();

        const keepFocusInside = (event: KeyboardEvent) => {
            if (event.key === 'Tab') {
                // Recovery has a single safe action; no destructive dismissal.
                event.preventDefault();
                event.stopPropagation();
                button.focus();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
            }
        };
        document.addEventListener('keydown', keepFocusInside, true);

        return () => {
            document.removeEventListener('keydown', keepFocusInside, true);
            background.forEach((child, index) => { child.inert = previousInert[index]; });
            document.body.style.overflow = previousOverflow;
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);

    return (
        <div role="alertdialog" aria-modal="true" aria-labelledby="device-vault-error"
            aria-describedby="device-vault-guidance" style={{
                position: 'fixed', inset: 0, zIndex: 2147483647,
                background: 'var(--bg-color, #10151c)', color: 'var(--text-main, #f3f5f7)',
                display: 'grid', placeItems: 'center', padding: 18,
            }}>
            <div className="auth-panel" style={{
                width: 'min(100%, 440px)', maxHeight: 'calc(100dvh - 36px)',
                overflowY: 'auto', boxSizing: 'border-box', padding: 24, margin: 'auto',
            }}>
                <h1 id="device-vault-error">Archivio locale temporaneamente non disponibile</h1>
                <p>Non è possibile leggere in modo sicuro i dati protetti di questo dispositivo. Nessun dato è stato cancellato.</p>
                <p id="device-vault-guidance">Le modifiche non ancora sincronizzate potrebbero esistere soltanto qui. Non cancellare i dati del browser né reinstallare la PWA prima di aver verificato il recupero.</p>
                <p role="alert">{error}</p>
                <button ref={retryRef} type="button" className="btn btn-primary" onClick={retry}>Riprova</button>
            </div>
        </div>
    );
}
